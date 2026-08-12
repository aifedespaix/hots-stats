import sys
from unittest.mock import MagicMock

import pytest
from PIL import Image

from src import ocr
from src.ocr import OcrResult, _choose_reading, read_player_name, warm_up

_LATIN_CHARSET = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?'ÉéÀàÈèÙùÂâÊêÎîÔôÛûËëÏïÜü")


@pytest.fixture
def fake_engines(monkeypatch):
    """Two independent fake engines, distinguished by whether RapidOCR was
    constructed with `rec_model_path` (the Latin engine) or not (the
    multilingual/default engine) -- see `ocr._get_latin_engine` /
    `_get_multilingual_engine`."""
    multilingual_engine = MagicMock(name="multilingual_engine")
    latin_engine = MagicMock(name="latin_engine")
    latin_engine.text_rec.postprocess_op.character = list(_LATIN_CHARSET)

    def build(*_args, **kwargs):
        return latin_engine if "rec_model_path" in kwargs else multilingual_engine

    fake_module = MagicMock()
    fake_module.RapidOCR.side_effect = build
    monkeypatch.setitem(sys.modules, "rapidocr_onnxruntime", fake_module)
    monkeypatch.setattr(ocr, "_multilingual_engine", None)
    monkeypatch.setattr(ocr, "_multilingual_engine_load_failed", False)
    monkeypatch.setattr(ocr, "_latin_engine", None)
    monkeypatch.setattr(ocr, "_latin_charset", None)
    monkeypatch.setattr(ocr, "_latin_engine_load_failed", False)

    return multilingual_engine, latin_engine


def _crop() -> Image.Image:
    return Image.new("RGB", (100, 20), color=(200, 200, 200))


def test_read_player_name_returns_none_for_missing_crop():
    assert read_player_name(None) == OcrResult(None, 0.0)


def test_read_player_name_prefers_the_latin_engine(fake_engines):
    multilingual_engine, latin_engine = fake_engines
    multilingual_engine.return_value = ([["L.A.Elite", 0.6]], 0.05)
    latin_engine.return_value = ([["I.A.Élite", 0.92]], 0.05)

    result = read_player_name(_crop())

    assert result == OcrResult("I.A.Élite", pytest.approx(0.92))


def test_read_player_name_falls_back_to_multilingual_when_latin_is_empty(fake_engines):
    multilingual_engine, latin_engine = fake_engines
    multilingual_engine.return_value = ([["Zeratul", 0.7]], 0.05)
    latin_engine.return_value = (None, 0.01)

    result = read_player_name(_crop())

    assert result == OcrResult("Zeratul", pytest.approx(0.7))


def test_read_player_name_strips_whitespace_noise(fake_engines):
    multilingual_engine, latin_engine = fake_engines
    multilingual_engine.return_value = (None, 0.01)
    latin_engine.return_value = ([[" Ze ratul ", 0.9]], 0.05)

    result = read_player_name(_crop())

    assert result.text == "Zeratul"


def test_read_player_name_below_confidence_threshold_is_unreadable(fake_engines):
    multilingual_engine, latin_engine = fake_engines
    multilingual_engine.return_value = ([["Zeratul", 0.2]], 0.05)
    latin_engine.return_value = ([["Zeratul", 0.3]], 0.05)

    result = read_player_name(_crop())

    assert result.text is None
    assert result.confidence == pytest.approx(0.3)


def test_read_player_name_empty_result_is_unreadable(fake_engines):
    multilingual_engine, latin_engine = fake_engines
    multilingual_engine.return_value = (None, 0.01)
    latin_engine.return_value = (None, 0.01)

    assert read_player_name(_crop()) == OcrResult(None, 0.0)


def test_read_player_name_picks_highest_confidence_entry(fake_engines):
    multilingual_engine, latin_engine = fake_engines
    multilingual_engine.return_value = (None, 0.01)
    latin_engine.return_value = ([["Junk", 0.3], ["Zeratul", 0.85]], 0.05)

    result = read_player_name(_crop())

    assert result.text == "Zeratul"


def test_read_player_name_swallows_engine_errors(fake_engines):
    multilingual_engine, latin_engine = fake_engines
    multilingual_engine.side_effect = RuntimeError("boom")
    latin_engine.side_effect = RuntimeError("boom")

    assert read_player_name(_crop()) == OcrResult(None, 0.0)


def test_read_player_name_degrades_to_latin_when_multilingual_engine_fails_to_load(fake_engines, monkeypatch):
    """The multilingual engine failing to build (a corrupted install, a bad
    Nuitka bundle) must not take live-draft capture down with it either --
    `_get_multilingual_engine` mirrors `_get_latin_engine`'s own
    fail-safe-to-None behavior for exactly this reason."""
    _multilingual_engine, latin_engine = fake_engines
    latin_engine.return_value = ([["Zeratul", 0.8]], 0.05)
    monkeypatch.setattr(ocr, "_get_multilingual_engine", lambda: None)

    result = read_player_name(_crop())

    assert result == OcrResult("Zeratul", pytest.approx(0.8))


def test_read_player_name_degrades_to_multilingual_when_latin_model_missing(fake_engines, monkeypatch):
    """A packaging mistake that drops `src/models/en_PP-OCRv5_rec_mobile.onnx`
    must not take live-draft capture down with it -- see `_get_latin_engine`'s
    docstring."""
    multilingual_engine, _latin_engine = fake_engines
    multilingual_engine.return_value = ([["Zeratul", 0.8]], 0.05)
    monkeypatch.setattr(ocr, "_get_latin_engine", lambda: None)

    result = read_player_name(_crop())

    assert result == OcrResult("Zeratul", pytest.approx(0.8))


def test_read_player_name_skips_detection_stage(fake_engines):
    multilingual_engine, latin_engine = fake_engines
    multilingual_engine.return_value = ([["Zeratul", 0.6]], 0.05)
    latin_engine.return_value = ([["Zeratul", 0.92]], 0.05)

    read_player_name(_crop())

    assert multilingual_engine.call_args.kwargs["use_det"] is False
    assert latin_engine.call_args.kwargs["use_det"] is False


def test_read_player_name_upscales_and_pads_the_crop_before_ocr(fake_engines):
    """A native ~30px-tall crop gives the recognition models far less detail
    to work with than what they're tuned for -- upscaling first (Lanczos,
    for quality) measurably helps small/stylized text recognition, and
    padding with the crop's own background color afterwards brings its
    width:height ratio back within what the models were trained on (see
    `_UPSCALE_FACTOR` / `_PAD_PX` in ocr.py)."""
    multilingual_engine, latin_engine = fake_engines
    multilingual_engine.return_value = ([["Zeratul", 0.6]], 0.05)
    latin_engine.return_value = ([["Zeratul", 0.92]], 0.05)
    crop = _crop()

    read_player_name(crop)

    (passed_array,), _kwargs = latin_engine.call_args
    expected_h = crop.height * ocr._UPSCALE_FACTOR + 2 * ocr._PAD_PX
    expected_w = crop.width * ocr._UPSCALE_FACTOR + 2 * ocr._PAD_PX
    assert passed_array.shape[0] == expected_h
    assert passed_array.shape[1] == expected_w
    # Both engines must see the exact same prepared image.
    (multilingual_array,), _ = multilingual_engine.call_args
    assert (multilingual_array == passed_array).all()


def test_warm_up_builds_both_engines_once(fake_engines):
    """`warm_up` (called from app.py at startup so a real draft's first
    hotkey press doesn't pay the model-load cost) must go through the same
    cached singletons `read_player_name` uses -- otherwise pre-loading here
    wouldn't actually save anything on the first real capture."""
    build_engine = sys.modules["rapidocr_onnxruntime"].RapidOCR

    warm_up()
    warm_up()

    assert build_engine.call_count == 2  # one multilingual + one Latin build, not re-built on the second warm_up

    read_player_name(_crop())  # doesn't build either engine a second time
    assert build_engine.call_count == 2


def test_warm_up_swallows_engine_load_failures(monkeypatch):
    """Covers both engines independently: a packaging/environment issue
    breaking either one's construction must log, not raise -- this runs
    unattended on a background thread at daemon startup (see app.py) with
    nothing to catch an exception, and one engine failing must not stop the
    other from loading (see `_get_latin_engine`'s own try/except and
    `warm_up`'s docstring)."""
    fake_module = MagicMock()
    fake_module.RapidOCR.side_effect = RuntimeError("boom")
    monkeypatch.setitem(sys.modules, "rapidocr_onnxruntime", fake_module)
    monkeypatch.setattr(ocr, "_multilingual_engine", None)
    monkeypatch.setattr(ocr, "_multilingual_engine_load_failed", False)
    monkeypatch.setattr(ocr, "_latin_engine", None)
    monkeypatch.setattr(ocr, "_latin_engine_load_failed", False)

    warm_up()  # must not raise

    assert ocr._multilingual_engine is None
    assert ocr._multilingual_engine_load_failed is True
    assert ocr._latin_engine is None
    assert ocr._latin_engine_load_failed is True


class TestChooseReading:
    """`_choose_reading` is the pure decision function reconciling the two
    engines' votes -- see its docstring in ocr.py -- exercised directly here
    since it's the part of this module with real branching logic."""

    def setup_method(self):
        ocr._latin_charset = _LATIN_CHARSET

    def teardown_method(self):
        ocr._latin_charset = None

    def test_prefers_latin_when_it_clears_the_threshold(self):
        result = _choose_reading(("L.A.Elite", 0.6), ("I.A.Élite", 0.85))
        assert result == ("I.A.Élite", 0.85)

    def test_falls_back_to_multilingual_when_latin_is_empty(self):
        result = _choose_reading(("Zeratul", 0.7), (None, 0.0))
        assert result == ("Zeratul", 0.7)

    def test_falls_back_to_multilingual_when_latin_is_below_threshold(self):
        result = _choose_reading(("Zeratul", 0.7), ("Zera7ul", 0.3))
        assert result == ("Zeratul", 0.7)

    def test_prefers_multilingual_when_it_reads_a_non_latin_character(self):
        # A Chinese name: the Latin engine's dictionary structurally cannot
        # represent "龙", no matter how confident its (necessarily wrong)
        # guess looks -- this reproduces a real failure seen against a
        # synthetic Chinese-name crop during manual testing.
        result = _choose_reading(("龙战士", 0.95), ("I", 0.53))
        assert result == ("龙战士", 0.95)

    def test_does_not_prefer_multilingual_over_latin_when_both_are_pure_latin(self):
        # Regression guard: a low-confidence *Latin* multilingual guess must
        # never win just because it happens to differ from the Latin
        # engine's answer -- only a genuinely non-Latin character should.
        result = _choose_reading(("L.A.Elite", 0.9), ("I.A.Elite", 0.7))
        assert result == ("I.A.Elite", 0.7)

    def test_unreadable_when_both_are_below_threshold(self):
        result = _choose_reading(("Zera7ul", 0.4), ("Zera7ul", 0.3))
        assert result == (None, 0.4)

    def test_unreadable_when_both_are_empty(self):
        result = _choose_reading((None, 0.0), (None, 0.0))
        assert result == (None, 0.0)
