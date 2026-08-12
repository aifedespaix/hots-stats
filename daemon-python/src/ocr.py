"""OCR for the tiny player-name crops off the draft screen.

Backed by RapidOCR (`rapidocr-onnxruntime`): ONNX-based, CPU-only, and fast
on small single-line crops -- chosen over Tesseract specifically to avoid
bundling and locating an external `tesseract.exe` + language data inside the
daemon's Nuitka `.exe`; RapidOCR ships its models as regular Python package
data.

The engine is loaded lazily and cached as a module-level singleton: building
it loads its ONNX models from disk, which takes real time (over a second),
so every other daemon startup path -- including with the live-draft feature
disabled entirely -- shouldn't have to pay for it.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from PIL import Image

logger = logging.getLogger(__name__)

# Below this confidence, treat the read as unreliable rather than risk
# resolving to the wrong player. Tuned generously low on purpose: a false
# "unreadable" just leaves one slot blank (see draft_capture.py), but a
# false-confident misread could silently attribute another player's stats.
_MIN_CONFIDENCE = 0.5

_engine = None


def _get_engine():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR

        _engine = RapidOCR()
    return _engine


@dataclass(frozen=True)
class OcrResult:
    text: str | None
    confidence: float


def _clean_text(raw: str) -> str:
    # HotS display names don't contain spaces; OCR on the game's stylized
    # font occasionally picks up stray whitespace from the crop's edges.
    return re.sub(r"\s+", "", raw).strip()


def read_player_name(crop: Image.Image | None) -> OcrResult:
    """Reads a single player-name crop. Returns `OcrResult(None, 0.0)` for a
    missing crop, an empty read, an engine failure, or a read below
    `_MIN_CONFIDENCE` -- never raises, so one bad slot degrades gracefully
    instead of failing the whole capture (see draft_capture.py)."""
    if crop is None:
        return OcrResult(None, 0.0)

    try:
        import numpy as np

        engine = _get_engine()
        result, _elapse = engine(np.array(crop.convert("RGB")))
    except Exception:
        logger.exception("OCR failed on a player-name crop")
        return OcrResult(None, 0.0)

    if not result:
        return OcrResult(None, 0.0)

    # One crop is one line of text; take the highest-confidence read in
    # case the engine splits it into more than one detected box.
    _box, best_text, best_score = max(result, key=lambda entry: entry[2])
    best_score = float(best_score)
    cleaned = _clean_text(best_text)
    if not cleaned or best_score < _MIN_CONFIDENCE:
        return OcrResult(None, best_score)
    return OcrResult(cleaned, best_score)
