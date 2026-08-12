"""OCR for the tiny player-name crops off the draft screen.

Backed by RapidOCR (`rapidocr-onnxruntime`): ONNX-based, CPU-only, and fast
on small single-line crops -- chosen over Tesseract specifically to avoid
bundling and locating an external `tesseract.exe` + language data inside the
daemon's Nuitka `.exe`; RapidOCR ships its models as regular Python package
data.

Two recognition models run per crop, not one:

- `_latin_engine`: not RapidOCR's bundled default -- `en_PP-OCRv5_rec_mobile.onnx`
  (bundled under `src/models/`; see that file's own note below), a model
  trained specifically on Latin-script text. HotS display names are
  overwhelmingly Latin-script (this app's UI is French), and RapidOCR's
  bundled default's 6000+ character dictionary spends most of its capacity
  on Chinese glyphs, which measurably hurts it on exactly the two things
  that matter most here: telling a capital "I" apart from "L"/"1", and
  reading accented letters (the game's own "I.A. Élite" bot label was the
  clearest reproduction -- the bundled default read it as "L.A.Elite" or
  similar almost every time; this model reads it correctly).
- `_multilingual_engine`: RapidOCR's own bundled default, kept running
  alongside the Latin engine (not replaced by it) as a fallback so a
  genuinely non-Latin pseudo (Cyrillic, CJK) -- which the Latin engine's
  character set cannot represent at all -- still gets read using whatever
  support already existed before this file started preferring the Latin
  engine. See `_choose_reading` for how the two votes are reconciled.

The engines are loaded lazily and cached as module-level singletons:
building either loads its ONNX models from disk, which takes real time
(a fraction of a second each, see `warm_up`'s docstring), so every other
daemon startup path -- including with the live-draft feature disabled
entirely -- shouldn't have to pay for it.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

# Below this confidence, treat the read as unreliable rather than risk
# resolving to the wrong player. Tuned generously low on purpose: a false
# "unreadable" just leaves one slot blank (see draft_capture.py), but a
# false-confident misread could silently attribute another player's stats.
_MIN_CONFIDENCE = 0.5

# Each crop is already known to contain exactly one line of text and
# nothing else (see draft_layout.py -- these are hand-tuned player-name
# boxes, not an arbitrary photo/document). RapidOCR's default pipeline
# runs a *detection* stage first to find where text sits in the image
# before ever reading it; on a crop this size and aspect ratio that stage
# frequently fails to find a box at all (trained for full photos/documents,
# not a razor-tight ~30px-tall strip), which silently discards the crop
# before the model that actually reads characters ever runs -- a plausible
# explanation for the engine doing far worse on our crops than a generic
# "throw the whole image at it" OCR tool. Skipping detection entirely and
# going straight to recognition avoids that failure mode: see
# `_read_with_engine`'s `use_det=False`, and `_UPSCALE_FACTOR`/`_PAD_PX`
# below for the rest of what feeds that recognition step a better-shaped
# image to work with.
_UPSCALE_FACTOR = 3

# Padding (in pixels, added on all four sides post-upscale) with a solid
# border matching the crop's own background color. Sounds cosmetic, isn't:
# our crops are naturally very wide relative to their height (a short name
# in a ~20px-tall strip easily reads width:height 7:1 or more), which
# already exceeds the recognition model's trained width:height envelope
# (PP-OCR's default is 320:48, i.e. 6.67:1) before any upscaling. Padding
# grows the crop's height faster (proportionally) than its width, pulling
# the ratio back down toward what the model expects, and empirically fixes
# exactly the failures that plain upscaling alone didn't: verified against
# a reference capture (see draft-live-test/screenshot.png), sweeping this
# value from 0-30px, 0 wrong-but-accepted reads and the most correct reads
# land in a wide, stable 12-17px plateau -- 14 sits in the middle of it,
# not at either edge. Below ~10px the plateau hasn't kicked in yet; above
# ~18px the padding starts dominating the frame and accuracy collapses.
_PAD_PX = 14

# Rows (in the *upscaled* crop) sampled from the very top to estimate the
# crop's background color for `_PAD_PX`'s border. Not the full crop, and not
# all four corners: `draft_layout.py`'s boxes leave a couple of rows of
# background above the text but hug its left/right/bottom edges closely (see
# a saved slot crop under `live-draft/captures/latest/` -- draft_debug.py),
# so a corner or bottom-row sample risks landing on a glyph stroke on some
# slots. The top rows are the one place background is reliably guaranteed.
_BACKGROUND_SAMPLE_ROWS = 2

_LATIN_REC_MODEL_PATH = Path(__file__).resolve().parent / "models" / "en_PP-OCRv5_rec_mobile.onnx"

_multilingual_engine = None
_multilingual_engine_load_failed = False
_latin_engine = None
_latin_charset: frozenset[str] | None = None
_latin_engine_load_failed = False


def _get_multilingual_engine():
    """Builds (and caches) RapidOCR's own default (multilingual) engine.
    Returns `None`, once, on failure -- mirrors `_get_latin_engine` below, for
    the same reason: `read_player_name` calls both of these unguarded (see
    its own try/except only covers crop preparation), so each getter must be
    safe to call on its own rather than relying on a caller-side try/except,
    or a broken engine here would crash live-draft capture instead of
    degrading to the Latin engine alone."""
    global _multilingual_engine, _multilingual_engine_load_failed
    if _multilingual_engine is not None:
        return _multilingual_engine
    if _multilingual_engine_load_failed:
        return None

    try:
        from rapidocr_onnxruntime import RapidOCR

        _multilingual_engine = RapidOCR()
    except Exception:
        logger.exception("Failed to load the multilingual OCR engine (falling back to the Latin engine only)")
        _multilingual_engine_load_failed = True
        return None
    return _multilingual_engine


def _get_latin_engine():
    """Builds (and caches) the Latin-specialized engine -- see the module
    docstring. Returns `None`, once, if the bundled model file is missing or
    fails to load (a packaging mistake, not something a player can fix), so
    `read_player_name` degrades to the multilingual engine alone rather than
    breaking live-draft capture entirely; logged so it's visible in
    live-draft.log (see draft_debug.py) instead of silently reducing
    accuracy with no trace."""
    global _latin_engine, _latin_charset, _latin_engine_load_failed
    if _latin_engine is not None:
        return _latin_engine
    if _latin_engine_load_failed:
        return None

    try:
        from rapidocr_onnxruntime import RapidOCR

        _latin_engine = RapidOCR(rec_model_path=str(_LATIN_REC_MODEL_PATH))
        _latin_charset = frozenset(_latin_engine.text_rec.postprocess_op.character)
    except Exception:
        logger.exception("Failed to load the Latin OCR model at %s (falling back to the multilingual engine only)", _LATIN_REC_MODEL_PATH)
        _latin_engine_load_failed = True
        return None
    return _latin_engine


def warm_up() -> None:
    """Eagerly loads and caches both OCR engines (see `_get_multilingual_engine`
    / `_get_latin_engine`) instead of waiting for the first real
    `read_player_name` call to pay that cost. Meant to be called once, on a
    background thread, right after daemon startup when the live-draft
    feature is enabled (see app.py) -- without this, that model-load time
    (a fraction of a second per engine) is paid inline during the player's
    *first actual draft* of the session, stacked on top of the
    screenshot/crop/OCR work `capture_and_submit` already has to do before
    it can show any result. Idempotent and safe to call more than once:
    each `_get_*_engine` only ever builds its engine the first time.

    Best-effort, with no try/except needed here: both `_get_*_engine`
    functions already swallow and log their own failures (see their
    docstrings) so one engine failing to load can't stop the other from
    warming up.
    """
    _get_multilingual_engine()
    _get_latin_engine()


@dataclass(frozen=True)
class OcrResult:
    text: str | None
    confidence: float


def _clean_text(raw: str) -> str:
    # HotS display names don't contain spaces; OCR on the game's stylized
    # font occasionally picks up stray whitespace from the crop's edges.
    return re.sub(r"\s+", "", raw).strip()


def _background_color(arr: "np.ndarray") -> tuple[int, int, int]:
    import numpy as np

    rows = min(_BACKGROUND_SAMPLE_ROWS, arr.shape[0])
    return tuple(int(v) for v in np.median(arr[0:rows, :, :].reshape(-1, 3), axis=0))


def _prepare_crop(crop: Image.Image) -> "np.ndarray":
    """Upscales a player-name crop (Lanczos, for quality) and pads it with a
    border matching its own background color -- see `_UPSCALE_FACTOR` and
    `_PAD_PX` above for why each step earns its place.

    `numpy` is imported here rather than at module level, same as (and for
    the same reason as) the `rapidocr_onnxruntime` import in
    `_get_multilingual_engine`/`_get_latin_engine`: `ocr.py` is imported
    unconditionally at daemon startup (see app.py), live-draft enabled or
    not, so a missing/broken numpy install must only take down OCR --
    caught by `read_player_name`'s `except Exception` -- not the whole
    daemon.
    """
    import numpy as np

    prepared = crop.convert("RGB")
    prepared = prepared.resize(
        (prepared.width * _UPSCALE_FACTOR, prepared.height * _UPSCALE_FACTOR), Image.LANCZOS
    )
    arr = np.array(prepared)
    background = _background_color(arr)
    padded = ImageOps.expand(prepared, border=_PAD_PX, fill=background)
    return np.array(padded)


def _read_with_engine(engine, prepared: np.ndarray) -> tuple[str | None, float]:
    """Runs one engine against an already-prepared (upscaled + padded) crop.
    use_det=False: see `_UPSCALE_FACTOR`'s comment. This also changes each
    result entry's shape from RapidOCR's usual `[box, text, score]` to
    `[text, score]` -- there's no detected box to report when detection
    never ran (see RapidOCR's `get_final_res`, the `dt_boxes is None`
    branches)."""
    try:
        result, _elapse = engine(prepared, use_det=False)
    except Exception:
        logger.exception("OCR failed on a player-name crop")
        return None, 0.0

    if not result:
        return None, 0.0

    # One crop is one line of text; take the highest-confidence read in
    # case the engine still returns more than one candidate.
    best_text, best_score = max(result, key=lambda entry: entry[1])
    cleaned = _clean_text(best_text)
    if not cleaned:
        return None, float(best_score)
    return cleaned, float(best_score)


def _choose_reading(
    multilingual: tuple[str | None, float], latin: tuple[str | None, float]
) -> tuple[str | None, float]:
    """Reconciles the two engines' votes for one crop.

    The multilingual engine wins outright when its reading contains a
    character the Latin engine's dictionary cannot represent at all
    (Cyrillic, CJK, ...) at a confidence worth trusting: that's a signal
    the Latin engine structurally cannot act on, no matter how confident
    its own (necessarily Latin-only) guess looks -- the failure mode this
    guards against is a real one, not hypothetical: a Chinese name was
    misread by the Latin engine as a single stray Latin letter at just
    above the confidence floor, while the multilingual engine read it
    correctly at high confidence.

    Otherwise the Latin engine wins whenever it clears the confidence floor
    -- the common case, and the one this whole module exists to get right
    (see the module docstring) -- falling back to the multilingual engine's
    own reading only when the Latin engine has nothing usable.
    """
    multilingual_text, multilingual_score = multilingual
    latin_text, latin_score = latin

    if (
        multilingual_text
        and multilingual_score >= _MIN_CONFIDENCE
        and _latin_charset is not None
        and any(char not in _latin_charset for char in multilingual_text)
    ):
        return multilingual_text, multilingual_score

    if latin_text and latin_score >= _MIN_CONFIDENCE:
        return latin_text, latin_score

    if multilingual_text and multilingual_score >= _MIN_CONFIDENCE:
        return multilingual_text, multilingual_score

    return None, max(multilingual_score, latin_score)


def read_player_name(crop: Image.Image | None) -> OcrResult:
    """Reads a single player-name crop. Returns `OcrResult(None, 0.0)` for a
    missing crop or an engine failure, and `OcrResult(None, confidence)` for
    an empty read or one below `_MIN_CONFIDENCE` -- never raises, so one bad
    slot degrades gracefully instead of failing the whole capture (see
    draft_capture.py)."""
    if crop is None:
        return OcrResult(None, 0.0)

    try:
        prepared = _prepare_crop(crop)
    except Exception:
        logger.exception("OCR failed on a player-name crop")
        return OcrResult(None, 0.0)

    multilingual_engine = _get_multilingual_engine()
    multilingual = _read_with_engine(multilingual_engine, prepared) if multilingual_engine is not None else (None, 0.0)

    latin_engine = _get_latin_engine()
    latin = _read_with_engine(latin_engine, prepared) if latin_engine is not None else (None, 0.0)

    text, score = _choose_reading(multilingual, latin)
    return OcrResult(text, score)
