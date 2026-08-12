"""Persists debug artifacts for the live-draft capture feature -- every crop
the pipeline produces (the per-team strip/rotated images and the 10
player-name crops) plus a JSON describing exactly how each was cropped and
what OCR read from it -- under `%APPDATA%/hots-analytics/live-draft/`, next
to `config.json` (see config.py's `config_file_path`).

This exists purely to debug why a capture comes back empty or wrong: the
crop coordinates in draft_layout.py were hand-tuned against one reference
capture, so a different resolution, aspect ratio, or UI scale can silently
shift every box off target. Looking at the console/log alone can't show
that; seeing the actual crops next to their coordinates can. Best-effort
throughout -- a disk error here must never take down a live-draft capture,
only leave it undocumented.

Only the *most recent* capture is kept on disk (a fixed `captures/latest/`
folder, cleared and rewritten on every hotkey press) rather than one folder
per press: this is a live debugging aid, not a history, and a folder that
grows by ~10 images every draft would otherwise slowly bloat the user's
`%APPDATA%` for no benefit.
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import shutil
from pathlib import Path

from PIL import Image

from .config import config_file_path
from .draft_layout import TeamCropResult
from .ocr import OcrResult

logger = logging.getLogger(__name__)

_MAX_LOG_BYTES = 2 * 1024 * 1024
_LOG_BACKUP_COUNT = 3

# Loggers whose records are worth keeping on disk for live-draft debugging,
# beyond whatever's scrolled off the console -- everything on the
# capture-hotkey -> screenshot -> crop -> OCR path.
_LOGGED_MODULES = ("draft_capture", "draft_layout", "ocr", "screen_capture")

_log_handler_installed = False


def debug_dir() -> Path:
    """`%APPDATA%/hots-analytics/live-draft/`."""
    return config_file_path().parent / "live-draft"


def install_file_log_handler() -> None:
    """Mirrors WARNING+ records from the live-draft modules into
    `live-draft/live-draft.log`, once per process. Called from
    `draft_capture.capture_and_submit` (not at import time) so daemon
    startups with the feature never used don't create the folder."""
    global _log_handler_installed
    if _log_handler_installed:
        return
    _log_handler_installed = True

    try:
        directory = debug_dir()
        directory.mkdir(parents=True, exist_ok=True)
        handler = logging.handlers.RotatingFileHandler(
            directory / "live-draft.log",
            maxBytes=_MAX_LOG_BYTES,
            backupCount=_LOG_BACKUP_COUNT,
            encoding="utf-8",
        )
        handler.setLevel(logging.WARNING)
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        for name in _LOGGED_MODULES:
            logging.getLogger(f"{__package__}.{name}").addHandler(handler)
    except OSError:
        logger.exception("Could not set up live-draft.log")


def _save_image(image: Image.Image, path: Path) -> None:
    if image.width == 0 or image.height == 0:
        return
    image.save(path)


def _team_debug_info(result: TeamCropResult, ocr_results: list[OcrResult]) -> dict:
    strip_size = result.strip.size
    rotated_size = result.rotated.size
    slots = []
    for index, (box, crop, read) in enumerate(zip(result.layout.player_crops, result.player_crops, ocr_results), 1):
        slots.append(
            {
                "slot": index,
                "cropBoxRelative": [box.x1, box.y1, box.x2, box.y2],
                "cropBoxPixels": list(box.to_pixels(*rotated_size)),
                "cropSize": list(crop.size) if crop is not None else None,
                "ocrText": read.text,
                "ocrConfidence": read.confidence,
                "status": "ok" if read.text else "unreadable",
            }
        )
    initial = result.layout.initial_crop
    return {
        "initialCropRelative": [initial.x1, initial.y1, initial.x2, initial.y2],
        "stripSize": list(strip_size),
        "rotationDegrees": result.layout.rotation_degrees,
        "rotatedSize": list(rotated_size),
        "slots": slots,
    }


def _save_team_images(result: TeamCropResult, directory: Path, prefix: str) -> None:
    _save_image(result.strip, directory / f"{prefix}-strip.png")
    _save_image(result.rotated, directory / f"{prefix}-rotated.png")
    for index, crop in enumerate(result.player_crops, 1):
        if crop is not None:
            _save_image(crop, directory / f"{prefix}-slot-{index}.png")


def save_capture(
    screenshot: Image.Image,
    captured_at: str,
    left: TeamCropResult,
    right: TeamCropResult,
    left_results: list[OcrResult],
    right_results: list[OcrResult],
) -> None:
    """Saves the full screenshot, every team/rotation/player-name crop, and a
    `crop-info.json` describing each crop's box and OCR read, to
    `debug_dir()/captures/latest/` -- replacing whatever was there from the
    previous capture. Called on every live-draft capture attempt (see
    draft_capture.py) regardless of whether OCR or the API submit succeeds,
    since a failed capture is exactly what needs debugging. Never raises.
    """
    try:
        capture_dir = debug_dir() / "captures" / "latest"
        if capture_dir.exists():
            # Cleared (not just overwritten) first: a slot that had a crop
            # last time but comes out empty this time would otherwise leave
            # behind a stale image implying a crop that no longer exists.
            shutil.rmtree(capture_dir)
        capture_dir.mkdir(parents=True, exist_ok=True)

        _save_image(screenshot, capture_dir / "screenshot.png")
        _save_team_images(left, capture_dir, "left")
        _save_team_images(right, capture_dir, "right")

        info = {
            "capturedAt": captured_at,
            "screenshotSize": list(screenshot.size),
            "teamLeft": _team_debug_info(left, left_results),
            "teamRight": _team_debug_info(right, right_results),
        }
        (capture_dir / "crop-info.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    except OSError:
        logger.exception("Could not save live-draft debug capture")
