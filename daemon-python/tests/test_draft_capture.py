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


def test_capture_and_submit_releases_coordinator_even_on_error():
    """The bug this guards against: forgetting to release the coordinator
    on an error path would leave the Draft Live tab's progress indicator
    stuck showing "capture in progress" forever, same class of bug as the
    sync-thread and update-status ones fixed elsewhere in this daemon."""
    client = _client()
    coordinator = draft_capture.DraftCaptureCoordinator()

    with patch("src.draft_capture.screen_capture.capture_game_window", side_effect=RuntimeError("boom")):
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
