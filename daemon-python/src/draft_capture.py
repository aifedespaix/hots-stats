"""Orchestrates one live-draft capture: hotkey press -> find the game window
-> screenshot -> crop the 10 player-name regions -> OCR each -> POST to the
API.

Runs synchronously on the `keyboard` package's own hotkey-callback thread
(see hotkey.py) -- screenshotting + OCR together take a fraction of a
second, well within what that thread can absorb without falling behind the
next keystroke, and it's the only thing using it.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from . import api_client, ocr, screen_capture
from .draft_layout import extract_player_crops

logger = logging.getLogger(__name__)


def _build_team_payload(crops: list) -> list[dict]:
    slots = []
    for index, crop in enumerate(crops, start=1):
        result = ocr.read_player_name(crop)
        slots.append({"slot": index, "rawName": result.text, "status": "ok" if result.text else "unreadable"})
    return slots


def capture_and_submit(client: api_client.ApiClient) -> None:
    """Runs one full capture. Never raises: this is called directly from
    the global hotkey's callback (see hotkey.py), which has no caller to
    surface an exception to -- any failure is logged and swallowed so a bad
    capture can't take the keyboard hook, or the daemon, down with it."""
    try:
        screenshot = screen_capture.capture_game_window()
    except screen_capture.GameWindowNotFoundError as err:
        logger.warning("Live-draft capture skipped: %s", err)
        return
    except Exception:
        logger.exception("Live-draft capture failed while screenshotting the game window")
        return

    try:
        left_crops, right_crops = extract_player_crops(screenshot)
        captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        payload = {
            "capturedAt": captured_at,
            "teamLeft": _build_team_payload(left_crops),
            "teamRight": _build_team_payload(right_crops),
        }
    except Exception:
        logger.exception("Live-draft capture failed while reading player names")
        return

    if client.post_draft_snapshot(payload):
        logger.info("Live-draft snapshot submitted")
