"""Crops the 10 player-name regions off a Heroes of the Storm draft-screen
screenshot.

Coordinates and the crop/rotate pipeline are ported from a reference OpenCV
script whose relative (0.0-1.0) boxes were hand-tuned against a 16:9
draft-screen capture, reimplemented on Pillow (already a dependency, see
tray.py's icon handling) instead of adding an opencv-python dependency just
for this. Being relative fractions makes them resolution-independent for any
capture at the same aspect ratio; an ultrawide monitor would need its own
tuned set (see the module docstring for `screen_capture.py`).
"""

from __future__ import annotations

from dataclasses import dataclass

from PIL import Image


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


LEFT_TEAM = TeamLayout(
    initial_crop=RelBox(0, 0, 0.15, 1),
    rotation_degrees=30,
    player_crops=(
        RelBox(0.12, 0.24, 0.3, 0.26),
        RelBox(0.34, 0.328, 0.53, 0.355),
        RelBox(0.34, 0.51, 0.53, 0.54),
        RelBox(0.57, 0.605, 0.76, 0.635),
        RelBox(0.57, 0.785, 0.76, 0.815),
    ),
)

RIGHT_TEAM = TeamLayout(
    initial_crop=RelBox(0.85, 0, 1, 1),
    rotation_degrees=-30,
    player_crops=(
        RelBox(0.7, 0.24, 0.88, 0.26),
        RelBox(0.47, 0.328, 0.66, 0.355),
        RelBox(0.47, 0.51, 0.66, 0.54),
        RelBox(0.24, 0.605, 0.43, 0.635),
        RelBox(0.24, 0.785, 0.43, 0.815),
    ),
)


def _crop_rel(image: Image.Image, box: RelBox) -> Image.Image:
    x1, y1, x2, y2 = box.to_pixels(*image.size)
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(x2, image.width), min(y2, image.height)
    if x2 <= x1 or y2 <= y1:
        return Image.new("RGB", (0, 0))
    return image.crop((x1, y1, x2, y2))


def _extract_team(screenshot: Image.Image, layout: TeamLayout) -> list[Image.Image | None]:
    strip = _crop_rel(screenshot, layout.initial_crop)
    if strip.width == 0 or strip.height == 0:
        return [None] * 5

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
    return crops


def extract_player_crops(screenshot: Image.Image) -> tuple[list[Image.Image | None], list[Image.Image | None]]:
    """Returns `(left_team_crops, right_team_crops)`, each a list of 5 crops
    in slot order (top to bottom). A slot is `None` when its crop came out
    empty -- a screenshot smaller than expected, or an unexpected aspect
    ratio -- so a bad capture degrades one slot at a time instead of raising."""
    return _extract_team(screenshot, LEFT_TEAM), _extract_team(screenshot, RIGHT_TEAM)
