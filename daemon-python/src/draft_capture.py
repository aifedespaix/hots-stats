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
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

from . import api_client, draft_debug, ocr, screen_capture
from .draft_layout import ensure_crop_config_file, extract_team_crops
from .ocr import OcrResult

logger = logging.getLogger(__name__)


class CapturePhase(str, Enum):
    IDLE = "idle"
    CAPTURING = "capturing"  # screenshotting, cropping, OCR
    SUBMITTING = "submitting"  # POSTing the result to the API


@dataclass(frozen=True)
class CaptureStatus:
    phase: CapturePhase = CapturePhase.IDLE


class DraftCaptureCoordinator:
    """Thread-safe, shared across every hotkey-triggered capture for the
    daemon's lifetime (see app.py's `_DaemonRunner`). Two things:

    1. Drives the settings window's Draft Live tab progress indicator (see
       gui.py) -- `snapshot()` is polled while the window is open so a
       capture in flight is visible instead of the hotkey silently doing
       something for a fraction of a second with no feedback.
    2. Makes a second hotkey press supersede a still-running capture rather
       than let both run to completion: `begin()` hands out a strictly
       increasing generation number, and `capture_and_submit` checks
       `is_current()` at its two natural checkpoints (after screenshotting,
       and right before committing the result) to notice it's stale and
       bail. Python can't forcibly kill a running thread, so this is
       cooperative, not preemptive -- but since every checkpoint bails
       *before* doing more work or writing anything, the practical result
       is the same one that matters: a superseded capture never overwrites
       a newer capture's debug snapshot or submits stale data to the API
       after fresher data already arrived.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._generation = 0
        self._status = CaptureStatus()

    def begin(self) -> int:
        with self._lock:
            self._generation += 1
            self._status = CaptureStatus(phase=CapturePhase.CAPTURING)
            return self._generation

    def is_current(self, generation: int) -> bool:
        with self._lock:
            return generation == self._generation

    def set_phase(self, generation: int, phase: CapturePhase) -> None:
        """No-ops if `generation` has since been superseded, so a stale
        run's phase update can never clobber what a newer, current capture
        already set."""
        with self._lock:
            if generation == self._generation:
                self._status = CaptureStatus(phase=phase)

    def finish(self, generation: int) -> None:
        with self._lock:
            if generation == self._generation:
                self._status = CaptureStatus(phase=CapturePhase.IDLE)

    def snapshot(self) -> CaptureStatus:
        with self._lock:
            return self._status


def _build_team_payload(crops: list) -> tuple[list[dict], list[OcrResult]]:
    slots = []
    results = []
    for index, crop in enumerate(crops, start=1):
        result = ocr.read_player_name(crop)
        slots.append({"slot": index, "rawName": result.text, "status": "ok" if result.text else "unreadable"})
        results.append(result)
    return slots, results


def capture_and_submit(client: api_client.ApiClient, coordinator: DraftCaptureCoordinator | None = None) -> None:
    """Runs one full capture. Never raises: this is called directly from
    the global hotkey's callback (see hotkey.py), which has no caller to
    surface an exception to -- any failure is logged and swallowed so a bad
    capture can't take the keyboard hook, or the daemon, down with it.

    `coordinator`, when given, is what makes pressing the hotkey again
    while a capture is still running supersede it instead of letting both
    finish -- see `DraftCaptureCoordinator`'s docstring. Wrapped in
    `finally` so its status always gets released back to IDLE on every exit
    path (an error, a skip, a normal finish, or being superseded);
    forgetting one would leave the Draft Live tab's progress indicator
    showing "capture in progress" forever, the exact class of bug this
    codebase has repeatedly had to fix elsewhere (see sync_state's
    finish_syncing / updater's UpdateStatusTracker).
    """
    generation = coordinator.begin() if coordinator is not None else 0
    try:
        draft_debug.install_file_log_handler()
        ensure_crop_config_file()

        try:
            screenshot = screen_capture.capture_game_window()
        except screen_capture.GameWindowNotFoundError as err:
            logger.warning("Live-draft capture skipped: %s", err)
            return
        except Exception:
            logger.exception("Live-draft capture failed while screenshotting the game window")
            return

        if coordinator is not None and not coordinator.is_current(generation):
            logger.info("Live-draft capture superseded by a newer hotkey press, discarding.")
            return

        try:
            left, right = extract_team_crops(screenshot)
            captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            team_left, left_results = _build_team_payload(left.player_crops)
            team_right, right_results = _build_team_payload(right.player_crops)
        except Exception:
            logger.exception("Live-draft capture failed while reading player names")
            return

        if coordinator is not None:
            if not coordinator.is_current(generation):
                logger.info("Live-draft capture superseded by a newer hotkey press, discarding.")
                return
            coordinator.set_phase(generation, CapturePhase.SUBMITTING)

        # Saved on every attempt, not just successful ones -- a capture that
        # came back empty or wrong is exactly what these crops are for
        # debugging (see draft_debug.py).
        draft_debug.save_capture(screenshot, captured_at, left, right, left_results, right_results)

        payload = {"capturedAt": captured_at, "teamLeft": team_left, "teamRight": team_right}
        if client.post_draft_snapshot(payload):
            logger.info("Live-draft snapshot submitted")
    finally:
        if coordinator is not None:
            coordinator.finish(generation)
