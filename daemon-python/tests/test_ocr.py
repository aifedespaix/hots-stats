import sys
from unittest.mock import MagicMock

import pytest
from PIL import Image

from src.ocr import OcrResult, read_player_name


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
    fake_rapidocr.return_value = ([["box", "Zeratul", 0.92]], 0.05)

    result = read_player_name(_crop())

    assert result.text == "Zeratul"
    assert result.confidence == pytest.approx(0.92)


def test_read_player_name_strips_whitespace_noise(fake_rapidocr):
    fake_rapidocr.return_value = ([["box", " Ze ratul ", 0.9]], 0.05)

    result = read_player_name(_crop())

    assert result.text == "Zeratul"


def test_read_player_name_below_confidence_threshold_is_unreadable(fake_rapidocr):
    fake_rapidocr.return_value = ([["box", "Zeratul", 0.2]], 0.05)

    result = read_player_name(_crop())

    assert result.text is None
    assert result.confidence == pytest.approx(0.2)


def test_read_player_name_empty_result_is_unreadable(fake_rapidocr):
    fake_rapidocr.return_value = (None, 0.01)

    assert read_player_name(_crop()) == OcrResult(None, 0.0)


def test_read_player_name_picks_highest_confidence_entry(fake_rapidocr):
    fake_rapidocr.return_value = ([["box1", "Junk", 0.3], ["box2", "Zeratul", 0.85]], 0.05)

    result = read_player_name(_crop())

    assert result.text == "Zeratul"


def test_read_player_name_swallows_engine_errors(fake_rapidocr):
    fake_rapidocr.side_effect = RuntimeError("boom")

    assert read_player_name(_crop()) == OcrResult(None, 0.0)
