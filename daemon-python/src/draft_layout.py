"""Crops the 10 player-name regions off a Heroes of the Storm draft-screen
screenshot.

Coordinates and the crop/rotate pipeline are ported from a reference OpenCV
script whose relative (0.0-1.0) boxes were hand-tuned against a 16:9
draft-screen capture, reimplemented on Pillow (already a dependency, see
tray.py's icon handling) instead of adding an opencv-python dependency just
for this. Being relative fractions makes them resolution-independent for any
capture at the same aspect ratio; an ultrawide monitor would need its own
tuned set (see the module docstring for `screen_capture.py`).

The layouts below (`LEFT_TEAM` / `RIGHT_TEAM`) are also the *defaults*: the
actual values used at capture time live in a JSON file under
`%APPDATA%/hots-analytics/draft-crop-config.json` (see `load_team_layouts` /
`ensure_crop_config_file`), seeded from these constants the first time the
feature runs. Keeping the tuning in a plain, appdata-editable file -- rather
than baked into the compiled .exe -- means a miscalibrated crop (a new game
UI scale, a different aspect ratio) can be fixed by editing that file and
pressing the hotkey again, no rebuild needed.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

logger = logging.getLogger(__name__)

CROP_CONFIG_FILENAME = "draft-crop-config.json"


@dataclass(frozen=True)
class RelBox:
    x1: float
    y1: float
    x2: float
    y2: float

    def to_pixels(self, width: int, height: int) -> tuple[int, int, int, int]:
        return (
            round(self.x1 * width),
            round(self.y1 * height),
            round(self.x2 * width),
            round(self.y2 * height),
        )


@dataclass(frozen=True)
class TeamLayout:
    # Relative to the full screenshot.
    initial_crop: RelBox
    rotation_degrees: float
    # Relative to the *rotated* strip; slot order 1-5, top to bottom on screen.
    player_crops: tuple[RelBox, RelBox, RelBox, RelBox, RelBox]


# Player-name crop boxes only (not `initial_crop`, the left/right team
# split) are shifted down by their own height from the original hand-tuned
# values: y1,y2 -> y2,y2+(y2-y1). The original boxes sat a touch too high
# against the name text; shifting each one down by exactly its own height
# re-centers it without changing its size or the (unrelated) team-split crop.
LEFT_TEAM = TeamLayout(
    initial_crop=RelBox(0, 0, 0.15, 1),
    rotation_degrees=30,
    player_crops=(
        RelBox(0.12, 0.26, 0.3, 0.28),
        RelBox(0.34, 0.355, 0.53, 0.382),
        RelBox(0.34, 0.54, 0.53, 0.57),
        RelBox(0.57, 0.635, 0.76, 0.665),
        RelBox(0.57, 0.815, 0.76, 0.845),
    ),
)

RIGHT_TEAM = TeamLayout(
    initial_crop=RelBox(0.85, 0, 1, 1),
    rotation_degrees=-30,
    player_crops=(
        RelBox(0.7, 0.26, 0.88, 0.28),
        RelBox(0.47, 0.355, 0.66, 0.382),
        RelBox(0.47, 0.54, 0.66, 0.57),
        RelBox(0.24, 0.635, 0.43, 0.665),
        RelBox(0.24, 0.815, 0.43, 0.845),
    ),
)


def crop_config_file_path() -> Path:
    """`%APPDATA%/hots-analytics/draft-crop-config.json` -- next to
    `config.json` (see config.py's `config_file_path`). Imported lazily to
    avoid a module-level circular import (config.py has no reason to know
    about draft_layout.py)."""
    from .config import config_file_path

    return config_file_path().parent / CROP_CONFIG_FILENAME


def _box_to_list(box: RelBox) -> list[float]:
    return [box.x1, box.y1, box.x2, box.y2]


def _box_from_list(values: object) -> RelBox:
    x1, y1, x2, y2 = values  # type: ignore[misc]
    return RelBox(float(x1), float(y1), float(x2), float(y2))


def _team_layout_to_dict(layout: TeamLayout) -> dict:
    return {
        "initialCrop": _box_to_list(layout.initial_crop),
        "rotationDegrees": layout.rotation_degrees,
        "playerCrops": [_box_to_list(box) for box in layout.player_crops],
    }


def _team_layout_from_dict(data: dict, default: TeamLayout) -> TeamLayout:
    """Parses one team's entry from the crop config JSON, falling back to
    `default` (with a warning) on any malformed shape -- a hand-edited file
    with a typo must degrade to the built-in tuning, never crash a capture."""
    try:
        initial_crop = _box_from_list(data["initialCrop"])
        rotation_degrees = float(data["rotationDegrees"])
        player_crops_raw = data["playerCrops"]
        if len(player_crops_raw) != 5:
            raise ValueError(f"expected 5 playerCrops, got {len(player_crops_raw)}")
        player_crops = tuple(_box_from_list(box) for box in player_crops_raw)
        return TeamLayout(initial_crop=initial_crop, rotation_degrees=rotation_degrees, player_crops=player_crops)  # type: ignore[arg-type]
    except (KeyError, TypeError, ValueError) as err:
        logger.warning("Invalid draft crop config entry (%s), falling back to the built-in default.", err)
        return default


def default_crop_config() -> dict:
    """The JSON-serializable form of the built-in `LEFT_TEAM`/`RIGHT_TEAM`
    defaults -- what gets written to disk the first time the crop config
    file is created (see `ensure_crop_config_file`)."""
    return {"left": _team_layout_to_dict(LEFT_TEAM), "right": _team_layout_to_dict(RIGHT_TEAM)}


def load_team_layouts() -> tuple[TeamLayout, TeamLayout]:
    """Reads `(left, right)` `TeamLayout`s from the appdata crop config file,
    falling back to the built-in `LEFT_TEAM`/`RIGHT_TEAM` defaults when the
    file is missing or malformed. A pure read -- never writes -- so it's
    safe to call on every capture (and in tests) without side effects; use
    `ensure_crop_config_file` to seed the file itself.
    """
    path = crop_config_file_path()
    if not path.is_file():
        return LEFT_TEAM, RIGHT_TEAM
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        left = _team_layout_from_dict(data["left"], LEFT_TEAM)
        right = _team_layout_from_dict(data["right"], RIGHT_TEAM)
        return left, right
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as err:
        logger.warning("Could not read draft crop config at %s (%s), using built-in defaults.", path, err)
        return LEFT_TEAM, RIGHT_TEAM


def ensure_crop_config_file() -> None:
    """Writes the default crop config to disk the first time it's called and
    the file doesn't exist yet, so the tuning actually in use is visible and
    hand-editable under `%APPDATA%/hots-analytics/` without waiting for a
    live-draft capture to trigger it. Best-effort: called at daemon startup
    and again before every capture (see app.py / draft_capture.py); a write
    failure here must never block anything else.
    """
    path = crop_config_file_path()
    if path.is_file():
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(default_crop_config(), indent=2), encoding="utf-8")
    except OSError:
        logger.warning("Could not create default draft crop config at %s", path, exc_info=True)


def _crop_rel(image: Image.Image, box: RelBox) -> Image.Image:
    x1, y1, x2, y2 = box.to_pixels(*image.size)
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(x2, image.width), min(y2, image.height)
    if x2 <= x1 or y2 <= y1:
        return Image.new("RGB", (0, 0))
    return image.crop((x1, y1, x2, y2))


@dataclass(frozen=True)
class TeamCropResult:
    """Every image the crop pipeline produces for one team, not just the
    final 5 player-name crops -- kept around so live-draft debug snapshots
    (see draft_debug.py) can show the intermediate strip/rotation steps,
    which is what makes a bad tuning (vs. a bad OCR read) obvious to spot."""

    layout: TeamLayout
    strip: Image.Image
    rotated: Image.Image
    player_crops: list[Image.Image | None]


def _extract_team(screenshot: Image.Image, layout: TeamLayout) -> TeamCropResult:
    strip = _crop_rel(screenshot, layout.initial_crop)
    if strip.width == 0 or strip.height == 0:
        return TeamCropResult(layout=layout, strip=strip, rotated=strip, player_crops=[None] * 5)

    # `expand=True` recomputes the bounding box so the rotated strip isn't
    # clipped -- the Pillow equivalent of the reference script's
    # `getRotationMatrix2D` + recentered translation. Both libraries treat a
    # positive angle as counter-clockwise, so the tuned +30/-30 values carry
    # over unchanged.
    rotated = strip.rotate(layout.rotation_degrees, expand=True, resample=Image.BICUBIC)

    crops: list[Image.Image | None] = []
    for box in layout.player_crops:
        crop = _crop_rel(rotated, box)
        crops.append(crop if crop.width > 0 and crop.height > 0 else None)
    return TeamCropResult(layout=layout, strip=strip, rotated=rotated, player_crops=crops)


def extract_team_crops(screenshot: Image.Image) -> tuple[TeamCropResult, TeamCropResult]:
    """Like `extract_player_crops`, but also returns the intermediate
    strip/rotated images and the layout each team was cropped with -- used by
    `draft_capture.py` so its debug snapshot (draft_debug.py) can save every
    step of the pipeline, not just the final 10 crops.

    The layouts used are whatever `load_team_layouts()` currently resolves
    to -- the appdata crop config file when present and valid, the built-in
    `LEFT_TEAM`/`RIGHT_TEAM` defaults otherwise -- read fresh on every call
    so a hand-edited config file takes effect on the very next capture, no
    restart needed.
    """
    left_layout, right_layout = load_team_layouts()
    return _extract_team(screenshot, left_layout), _extract_team(screenshot, right_layout)


def extract_player_crops(screenshot: Image.Image) -> tuple[list[Image.Image | None], list[Image.Image | None]]:
    """Returns `(left_team_crops, right_team_crops)`, each a list of 5 crops
    in slot order (top to bottom). A slot is `None` when its crop came out
    empty -- a screenshot smaller than expected, or an unexpected aspect
    ratio -- so a bad capture degrades one slot at a time instead of raising."""
    left, right = extract_team_crops(screenshot)
    return left.player_crops, right.player_crops
