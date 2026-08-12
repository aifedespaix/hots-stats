import logging
from unittest.mock import MagicMock, patch

import pytest

from src import draft_capture, screen_capture
from src.draft_layout import TeamCropResult
from src.ocr import OcrResult


@pytest.fixture(autouse=True)
def _no_debug_log_handler():
    # These tests exercise payload-building only; `draft_debug.py` (the log
    # handler + crop saving) has its own test module with real filesystem
    # isolation -- see test_draft_debug.py.
    with patch("src.draft_capture.draft_debug.install_file_log_handler"):
        yield


def _client() -> MagicMock:
    client = MagicMock()
    client.post_draft_snapshot.return_value = True
    return client


def _team_result(crops: list) -> TeamCropResult:
    return TeamCropResult(layout=MagicMock(), strip=MagicMock(), rotated=MagicMock(), player_crops=crops)


def test_capture_and_submit_builds_expected_payload():
    client = _client()
    left = _team_result(["l1", None, "l3", "l4", "l5"])
    right = _team_result(["r1", "r2", "r3", "r4", "r5"])

    def fake_ocr(crop):
        return OcrResult(None, 0.0) if crop is None else OcrResult(f"Name-{crop}", 0.9)

    with patch("src.draft_capture.screen_capture.capture_game_window", return_value="screenshot"):
        with patch("src.draft_capture.extract_team_crops", return_value=(left, right)):
            with patch("src.draft_capture.ocr.read_player_name", side_effect=fake_ocr):
                with patch("src.draft_capture.draft_debug.save_capture") as save_capture:
                    draft_capture.capture_and_submit(client)

    client.post_draft_snapshot.assert_called_once()
    payload = client.post_draft_snapshot.call_args[0][0]

    assert payload["capturedAt"].endswith("Z")
    assert len(payload["teamLeft"]) == 5
    assert len(payload["teamRight"]) == 5
    assert payload["teamLeft"][0] == {"slot": 1, "rawName": "Name-l1", "status": "ok"}
    assert payload["teamLeft"][1] == {"slot": 2, "rawName": None, "status": "unreadable"}
    assert payload["teamRight"][4] == {"slot": 5, "rawName": "Name-r5", "status": "ok"}
    save_capture.assert_called_once()


def test_capture_and_submit_skips_when_window_not_found(caplog):
    client = _client()
    with patch(
        "src.draft_capture.screen_capture.capture_game_window",
        side_effect=screen_capture.GameWindowNotFoundError("nope"),
    ):
        with caplog.at_level(logging.WARNING):
            draft_capture.capture_and_submit(client)

    client.post_draft_snapshot.assert_not_called()


def test_capture_and_submit_swallows_screenshot_errors():
    client = _client()
    with patch("src.draft_capture.screen_capture.capture_game_window", side_effect=RuntimeError("boom")):
        draft_capture.capture_and_submit(client)

    client.post_draft_snapshot.assert_not_called()


def test_capture_and_submit_swallows_crop_errors():
    client = _client()
    with patch("src.draft_capture.screen_capture.capture_game_window", return_value="screenshot"):
        with patch("src.draft_capture.extract_team_crops", side_effect=RuntimeError("boom")):
            with patch("src.draft_capture.draft_debug.save_capture") as save_capture:
                draft_capture.capture_and_submit(client)

    client.post_draft_snapshot.assert_not_called()
    save_capture.assert_not_called()


# -- DraftCaptureCoordinator --------------------------------------------------


def test_coordinator_generation_increments():
    coordinator = draft_capture.DraftCaptureCoordinator()
    first = coordinator.begin()
    second = coordinator.begin()

    assert second == first + 1
    assert coordinator.is_current(second) is True
    assert coordinator.is_current(first) is False


def test_coordinator_finish_is_a_noop_for_a_stale_generation():
    """A superseded (older) capture finishing after a newer one has already
    started must not reset the newer one's in-progress status back to IDLE
    -- that would make the progress indicator flicker off mid-capture."""
    coordinator = draft_capture.DraftCaptureCoordinator()
    first = coordinator.begin()
    second = coordinator.begin()

    coordinator.finish(first)
    assert coordinator.snapshot().phase is draft_capture.CapturePhase.CAPTURING

    coordinator.finish(second)
    assert coordinator.snapshot().phase is draft_capture.CapturePhase.IDLE


def test_coordinator_set_phase_is_a_noop_for_a_stale_generation():
    coordinator = draft_capture.DraftCaptureCoordinator()
    first = coordinator.begin()
    coordinator.begin()  # supersedes `first`

    coordinator.set_phase(first, draft_capture.CapturePhase.SUBMITTING)

    assert coordinator.snapshot().phase is draft_capture.CapturePhase.CAPTURING


# -- capture_and_submit + DraftCaptureCoordinator -----------------------------


def test_capture_and_submit_reports_phases_via_coordinator():
    client = _client()
    coordinator = draft_capture.DraftCaptureCoordinator()
    left = _team_result(["l1", None, "l3", "l4", "l5"])
    right = _team_result(["r1", "r2", "r3", "r4", "r5"])
    phase_during_submit = []

    def fake_post(_payload):
        phase_during_submit.append(coordinator.snapshot().phase)
        return True

    client.post_draft_snapshot.side_effect = fake_post

    with patch("src.draft_capture.screen_capture.capture_game_window", return_value="screenshot"):
        with patch("src.draft_capture.extract_team_crops", return_value=(left, right)):
            with patch("src.draft_capture.ocr.read_player_name", return_value=OcrResult("X", 0.9)):
                with patch("src.draft_capture.draft_debug.save_capture"):
                    draft_capture.capture_and_submit(client, coordinator=coordinator)

    assert phase_during_submit == [draft_capture.CapturePhase.SUBMITTING]
    # Released back to IDLE once the capture is fully done -- see the
    # `finally` block, added specifically so no exit path can leave this
    # stuck (mirrors the same guarantee added elsewhere in this codebase
    # for sync status / update status).
    assert coordinator.snapshot().phase is draft_capture.CapturePhase.IDLE


def test_capture_and_submit_reports_error_instead_of_getting_stuck():
    """The bug this guards against: forgetting to release the coordinator
    on an error path would leave the Draft Live tab's progress indicator
    stuck showing "capture in progress" forever, same class of bug as the
    sync-thread and update-status ones fixed elsewhere in this daemon. It
    must resolve to ERROR (visible, with a message), not silently back to
    IDLE -- a capture that fails and shows nothing at all is exactly the
    "hotkey is fine but nothing happens" symptom this exists to fix."""
    client = _client()
    coordinator = draft_capture.DraftCaptureCoordinator()

    with patch("src.draft_capture.screen_capture.capture_game_window", side_effect=RuntimeError("boom")):
        draft_capture.capture_and_submit(client, coordinator=coordinator)

    status = coordinator.snapshot()
    assert status.phase is draft_capture.CapturePhase.ERROR
    assert status.message


def test_capture_and_submit_reports_window_not_found_as_a_clear_error():
    client = _client()
    coordinator = draft_capture.DraftCaptureCoordinator()

    with patch(
        "src.draft_capture.screen_capture.capture_game_window",
        side_effect=screen_capture.GameWindowNotFoundError("nope"),
    ):
        draft_capture.capture_and_submit(client, coordinator=coordinator)

    status = coordinator.snapshot()
    assert status.phase is draft_capture.CapturePhase.ERROR
    assert "introuvable" in status.message


def test_capture_and_submit_reports_crop_ocr_errors():
    client = _client()
    coordinator = draft_capture.DraftCaptureCoordinator()

    with patch("src.draft_capture.screen_capture.capture_game_window", return_value="screenshot"):
        with patch("src.draft_capture.extract_team_crops", side_effect=RuntimeError("boom")):
            with patch("src.draft_capture.draft_debug.save_capture"):
                draft_capture.capture_and_submit(client, coordinator=coordinator)

    status = coordinator.snapshot()
    assert status.phase is draft_capture.CapturePhase.ERROR
    assert status.message


def test_capture_and_submit_next_attempt_clears_a_previous_error():
    """A fresh `begin()` (the next hotkey press) resets the status before
    doing anything else, so a stale error from a previous failed attempt
    doesn't linger forever once the underlying problem (e.g. the game
    window) is fixed and a new capture actually succeeds."""
    client = _client()
    coordinator = draft_capture.DraftCaptureCoordinator()
    with patch("src.draft_capture.screen_capture.capture_game_window", side_effect=RuntimeError("boom")):
        draft_capture.capture_and_submit(client, coordinator=coordinator)
    assert coordinator.snapshot().phase is draft_capture.CapturePhase.ERROR

    left = _team_result(["l1", None, "l3", "l4", "l5"])
    right = _team_result(["r1", "r2", "r3", "r4", "r5"])
    with patch("src.draft_capture.screen_capture.capture_game_window", return_value="screenshot"):
        with patch("src.draft_capture.extract_team_crops", return_value=(left, right)):
            with patch("src.draft_capture.ocr.read_player_name", return_value=OcrResult("X", 0.9)):
                with patch("src.draft_capture.draft_debug.save_capture"):
                    draft_capture.capture_and_submit(client, coordinator=coordinator)

    assert coordinator.snapshot().phase is draft_capture.CapturePhase.IDLE


def test_capture_and_submit_bails_when_superseded_after_screenshot():
    """A second hotkey press starting a newer capture while this one is
    still working must make this one give up before doing the expensive
    crop/OCR work, instead of finishing and possibly submitting stale data
    after (or racing with) the newer one."""
    client = _client()
    coordinator = draft_capture.DraftCaptureCoordinator()

    def fake_capture_window():
        coordinator.begin()  # simulates a second hotkey press mid-capture
        return "screenshot"

    with patch("src.draft_capture.screen_capture.capture_game_window", side_effect=fake_capture_window):
        with patch("src.draft_capture.extract_team_crops") as extract_crops:
            with patch("src.draft_capture.draft_debug.save_capture") as save_capture:
                draft_capture.capture_and_submit(client, coordinator=coordinator)

    extract_crops.assert_not_called()
    save_capture.assert_not_called()
    client.post_draft_snapshot.assert_not_called()


# -- run_test_capture (tasks/daemon-audit-2026-08-12.md, 2.2) ----------------


def test_run_test_capture_never_posts_to_the_api():
    left = _team_result(["l1", None, "l3", "l4", "l5"])
    right = _team_result(["r1", "r2", "r3", "r4", "r5"])

    with patch("src.draft_capture.screen_capture.capture_foreground_window", return_value="screenshot"):
        with patch("src.draft_capture.extract_team_crops", return_value=(left, right)):
            with patch("src.draft_capture.ocr.read_player_name", return_value=OcrResult("X", 0.9)):
                with patch("src.draft_capture.draft_debug.save_capture") as save_capture:
                    result = draft_capture.run_test_capture()

    assert result.left is left
    assert result.right is right
    assert len(result.left_results) == 5
    assert all(r.text == "X" for r in result.left_results)
    save_capture.assert_called_once()


def test_run_test_capture_uses_the_foreground_window_not_the_game_window():
    """The whole point of the test-capture button is working against
    whatever window is focused, not requiring a live HotS window -- see
    `screen_capture.find_foreground_window`."""
    left = _team_result([None] * 5)
    right = _team_result([None] * 5)

    with patch("src.draft_capture.screen_capture.capture_foreground_window", return_value="s") as capture_fg:
        with patch("src.draft_capture.screen_capture.capture_game_window") as capture_game:
            with patch("src.draft_capture.extract_team_crops", return_value=(left, right)):
                with patch("src.draft_capture.draft_debug.save_capture"):
                    draft_capture.run_test_capture()

    capture_fg.assert_called_once()
    capture_game.assert_not_called()


def test_run_test_capture_raises_when_no_window_has_focus():
    """Unlike `capture_and_submit`, this has a real caller (the settings
    window) that can show the error -- it must propagate, not be swallowed."""
    with patch(
        "src.draft_capture.screen_capture.capture_foreground_window",
        side_effect=screen_capture.GameWindowNotFoundError("no active window"),
    ):
        with pytest.raises(screen_capture.GameWindowNotFoundError):
            draft_capture.run_test_capture()


def test_capture_and_submit_bails_when_superseded_before_submit():
    client = _client()
    coordinator = draft_capture.DraftCaptureCoordinator()
    left = _team_result(["l1", None, "l3", "l4", "l5"])
    right = _team_result(["r1", "r2", "r3", "r4", "r5"])

    def fake_extract(_screenshot):
        coordinator.begin()  # simulates a second hotkey press mid-capture
        return left, right

    with patch("src.draft_capture.screen_capture.capture_game_window", return_value="screenshot"):
        with patch("src.draft_capture.extract_team_crops", side_effect=fake_extract):
            with patch("src.draft_capture.ocr.read_player_name", return_value=OcrResult("X", 0.9)):
                with patch("src.draft_capture.draft_debug.save_capture") as save_capture:
                    draft_capture.capture_and_submit(client, coordinator=coordinator)

    save_capture.assert_not_called()
    client.post_draft_snapshot.assert_not_called()
