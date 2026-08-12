import sys
from unittest.mock import MagicMock

import pytest
from PIL import Image

from src import ocr
from src.ocr import OcrResult, read_player_name, warm_up


@pytest.fixture
def fake_rapidocr(monkeypatch):
    fake_module = MagicMock()
    fake_engine_instance = MagicMock()
    fake_module.RapidOCR.return_value = fake_engine_instance
    monkeypatch.setitem(sys.modules, "rapidocr_onnxruntime", fake_module)
    monkeypatch.setattr("src.ocr._engine", None)
    return fake_engine_instance


def _crop() -> Image.Image:
    return Image.new("RGB", (100, 20), color=(200, 200, 200))


def test_read_player_name_returns_none_for_missing_crop():
    assert read_player_name(None) == OcrResult(None, 0.0)


def test_read_player_name_returns_cleaned_text_above_threshold(fake_rapidocr):
    fake_rapidocr.return_value = ([["Zeratul", 0.92]], 0.05)

    result = read_player_name(_crop())

    assert result.text == "Zeratul"
    assert result.confidence == pytest.approx(0.92)


def test_read_player_name_strips_whitespace_noise(fake_rapidocr):
    fake_rapidocr.return_value = ([[" Ze ratul ", 0.9]], 0.05)

    result = read_player_name(_crop())

    assert result.text == "Zeratul"


def test_read_player_name_below_confidence_threshold_is_unreadable(fake_rapidocr):
    fake_rapidocr.return_value = ([["Zeratul", 0.2]], 0.05)

    result = read_player_name(_crop())

    assert result.text is None
    assert result.confidence == pytest.approx(0.2)


def test_read_player_name_empty_result_is_unreadable(fake_rapidocr):
    fake_rapidocr.return_value = (None, 0.01)

    assert read_player_name(_crop()) == OcrResult(None, 0.0)


def test_read_player_name_picks_highest_confidence_entry(fake_rapidocr):
    fake_rapidocr.return_value = ([["Junk", 0.3], ["Zeratul", 0.85]], 0.05)

    result = read_player_name(_crop())

    assert result.text == "Zeratul"


def test_read_player_name_swallows_engine_errors(fake_rapidocr):
    fake_rapidocr.side_effect = RuntimeError("boom")

    assert read_player_name(_crop()) == OcrResult(None, 0.0)


def test_read_player_name_skips_detection_stage(fake_rapidocr):
    """The crop is already known to contain exactly one line of text (see
    draft_layout.py) -- RapidOCR's detection stage exists to find text
    regions in an arbitrary photo/document, and on a crop this small and
    this tightly cropped it frequently fails to find a box at all, silently
    discarding an otherwise perfectly readable name. use_det=False skips
    straight to recognition instead."""
    fake_rapidocr.return_value = ([["Zeratul", 0.92]], 0.05)

    read_player_name(_crop())

    assert fake_rapidocr.call_args.kwargs["use_det"] is False


def test_read_player_name_upscales_the_crop_before_ocr(fake_rapidocr):
    """A native ~30px-tall crop gives the recognition model far less detail
    to work with than what it's tuned for -- upscaling first (Lanczos, for
    quality) measurably helps small/stylized text recognition."""
    fake_rapidocr.return_value = ([["Zeratul", 0.92]], 0.05)
    crop = _crop()

    read_player_name(crop)

    (passed_array,), _kwargs = fake_rapidocr.call_args
    assert passed_array.shape[0] == crop.height * 3
    assert passed_array.shape[1] == crop.width * 3


def test_warm_up_builds_the_engine_once(fake_rapidocr, monkeypatch):
    """`warm_up` (called from app.py at startup so a real draft's first
    hotkey press doesn't pay the model-load cost) must go through the same
    cached singleton `read_player_name` uses -- otherwise pre-loading here
    wouldn't actually save anything on the first real capture."""
    build_engine = sys.modules["rapidocr_onnxruntime"].RapidOCR

    warm_up()
    warm_up()

    assert ocr._engine is fake_rapidocr
    build_engine.assert_called_once()

    read_player_name(_crop())  # doesn't build a second engine either
    build_engine.assert_called_once()


def test_warm_up_swallows_engine_load_failures(monkeypatch):
    """A packaging/environment issue that breaks engine construction must
    log, not raise -- this runs unattended on a background thread at daemon
    startup (see app.py) with nothing to catch an exception."""
    monkeypatch.setattr(ocr, "_engine", None)
    monkeypatch.setattr(ocr, "_get_engine", MagicMock(side_effect=RuntimeError("boom")))

    warm_up()  # must not raise
