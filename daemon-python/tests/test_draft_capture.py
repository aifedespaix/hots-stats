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
