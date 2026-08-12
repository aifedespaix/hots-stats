import json
import logging
import logging.handlers

import pytest
from PIL import Image

from src import draft_debug
from src.draft_layout import LEFT_TEAM, RIGHT_TEAM, TeamCropResult
from src.ocr import OcrResult


@pytest.fixture(autouse=True)
def _isolated_appdata(monkeypatch, tmp_path):
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    # `install_file_log_handler` only ever runs its body once per process;
    # reset that between tests so each one gets a fresh handler pointed at
    # its own tmp_path, and remove whatever handlers a previous test (or this
    # one) attached so they don't pile up on the shared module loggers.
    monkeypatch.setattr(draft_debug, "_log_handler_installed", False)
    loggers = [logging.getLogger(f"src.{name}") for name in draft_debug._LOGGED_MODULES]
    original_handlers = [list(logger.handlers) for logger in loggers]
    yield
    for logger, handlers in zip(loggers, original_handlers):
        for handler in list(logger.handlers):
            if handler not in handlers:
                logger.removeHandler(handler)
                handler.close()


def _team_result(has_crops: bool = True) -> TeamCropResult:
    strip = Image.new("RGB", (200, 800), color=(1, 2, 3))
    rotated = strip.rotate(30, expand=True)
    crops = [Image.new("RGB", (60, 20), color=(4, 5, 6)) for _ in range(5)] if has_crops else [None] * 5
    return TeamCropResult(layout=LEFT_TEAM, strip=strip, rotated=rotated, player_crops=crops)


def _ocr_results(texts: list[str | None]) -> list[OcrResult]:
    return [OcrResult(text, 0.9 if text else 0.0) for text in texts]


def test_debug_dir_is_under_appdata_live_draft(monkeypatch, tmp_path):
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))

    assert draft_debug.debug_dir() == tmp_path / "AppData" / "hots-analytics" / "live-draft"


def test_save_capture_writes_images_and_json():
    screenshot = Image.new("RGB", (1920, 1080), color=(9, 9, 9))
    left = _team_result()
    right = TeamCropResult(layout=RIGHT_TEAM, strip=left.strip, rotated=left.rotated, player_crops=left.player_crops)
    left_results = _ocr_results(["Alice", None, "Carl", "Dave", "Eve"])
    right_results = _ocr_results(["Foo", "Bar", "Baz", None, "Quux"])

    draft_debug.save_capture(screenshot, "2026-08-12T10:00:00Z", left, right, left_results, right_results)

    captures = list((draft_debug.debug_dir() / "captures").iterdir())
    assert len(captures) == 1
    capture_dir = captures[0]

    assert (capture_dir / "screenshot.png").is_file()
    assert (capture_dir / "left-strip.png").is_file()
    assert (capture_dir / "left-rotated.png").is_file()
    assert (capture_dir / "left-slot-1.png").is_file()
    assert (capture_dir / "right-slot-5.png").is_file()

    info = json.loads((capture_dir / "crop-info.json").read_text(encoding="utf-8"))
    assert info["capturedAt"] == "2026-08-12T10:00:00Z"
    assert info["screenshotSize"] == [1920, 1080]
    assert len(info["teamLeft"]["slots"]) == 5
    assert info["teamLeft"]["slots"][0]["ocrText"] == "Alice"
    assert info["teamLeft"]["slots"][0]["status"] == "ok"
    assert info["teamLeft"]["slots"][1]["ocrText"] is None
    assert info["teamLeft"]["slots"][1]["status"] == "unreadable"
    assert info["teamRight"]["slots"][4]["ocrText"] == "Quux"


def test_save_capture_skips_missing_slot_images():
    screenshot = Image.new("RGB", (1920, 1080), color=(9, 9, 9))
    left = _team_result(has_crops=False)
    right = _team_result(has_crops=False)

    draft_debug.save_capture(screenshot, "2026-08-12T10:00:01Z", left, right, _ocr_results([None] * 5), _ocr_results([None] * 5))

    capture_dir = next((draft_debug.debug_dir() / "captures").iterdir())
    assert not (capture_dir / "left-slot-1.png").exists()
    info = json.loads((capture_dir / "crop-info.json").read_text(encoding="utf-8"))
    assert info["teamLeft"]["slots"][0]["cropSize"] is None


def test_save_capture_prunes_captures_beyond_the_kept_limit(monkeypatch):
    monkeypatch.setattr(draft_debug, "_MAX_KEPT_CAPTURES", 3)
    screenshot = Image.new("RGB", (100, 100), color=(0, 0, 0))
    left = _team_result()
    right = _team_result()
    results = _ocr_results(["A"] * 5)

    for i in range(5):
        draft_debug.save_capture(screenshot, f"2026-08-12T10:00:{i:02d}Z", left, right, results, results)

    captures_dir = draft_debug.debug_dir() / "captures"
    assert len(list(captures_dir.iterdir())) == 3


def test_install_file_log_handler_writes_warnings_to_log_file():
    draft_debug.install_file_log_handler()

    logging.getLogger("src.ocr").warning("something went sideways during OCR")

    log_path = draft_debug.debug_dir() / "live-draft.log"
    assert log_path.is_file()
    assert "something went sideways during OCR" in log_path.read_text(encoding="utf-8")


def test_install_file_log_handler_is_idempotent():
    draft_debug.install_file_log_handler()
    draft_debug.install_file_log_handler()

    logger = logging.getLogger("src.ocr")
    file_handlers = [h for h in logger.handlers if isinstance(h, logging.handlers.RotatingFileHandler)]
    assert len(file_handlers) == 1
