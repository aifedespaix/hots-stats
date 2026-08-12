import logging
from unittest.mock import MagicMock, patch

from src import draft_capture, screen_capture
from src.ocr import OcrResult


def _client() -> MagicMock:
    client = MagicMock()
    client.post_draft_snapshot.return_value = True
    return client


def test_capture_and_submit_builds_expected_payload():
    client = _client()
    left_crops = ["l1", None, "l3", "l4", "l5"]
    right_crops = ["r1", "r2", "r3", "r4", "r5"]

    def fake_ocr(crop):
        return OcrResult(None, 0.0) if crop is None else OcrResult(f"Name-{crop}", 0.9)

    with patch("src.draft_capture.screen_capture.capture_game_window", return_value="screenshot"):
        with patch("src.draft_capture.extract_player_crops", return_value=(left_crops, right_crops)):
            with patch("src.draft_capture.ocr.read_player_name", side_effect=fake_ocr):
                draft_capture.capture_and_submit(client)

    client.post_draft_snapshot.assert_called_once()
    payload = client.post_draft_snapshot.call_args[0][0]

    assert payload["capturedAt"].endswith("Z")
    assert len(payload["teamLeft"]) == 5
    assert len(payload["teamRight"]) == 5
    assert payload["teamLeft"][0] == {"slot": 1, "rawName": "Name-l1", "status": "ok"}
    assert payload["teamLeft"][1] == {"slot": 2, "rawName": None, "status": "unreadable"}
    assert payload["teamRight"][4] == {"slot": 5, "rawName": "Name-r5", "status": "ok"}


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
        with patch("src.draft_capture.extract_player_crops", side_effect=RuntimeError("boom")):
            draft_capture.capture_and_submit(client)

    client.post_draft_snapshot.assert_not_called()
