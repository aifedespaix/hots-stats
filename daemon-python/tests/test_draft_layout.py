from PIL import Image

from src.draft_layout import extract_player_crops


def _synthetic_screenshot(width: int = 1920, height: int = 1080) -> Image.Image:
    return Image.new("RGB", (width, height), color=(10, 20, 30))


def test_extract_player_crops_returns_five_slots_per_team():
    left, right = extract_player_crops(_synthetic_screenshot())

    assert len(left) == 5
    assert len(right) == 5


def test_extract_player_crops_slots_are_non_empty_images_at_full_hd():
    left, right = extract_player_crops(_synthetic_screenshot())

    for crop in [*left, *right]:
        assert crop is not None
        assert crop.width > 0
        assert crop.height > 0


def test_extract_player_crops_degrades_to_none_on_tiny_screenshot():
    # Relative crops can round down to zero pixels on a screenshot far
    # smaller than a real capture -- must degrade per-slot, not raise.
    left, right = extract_player_crops(_synthetic_screenshot(10, 10))

    for crop in [*left, *right]:
        assert crop is None or (crop.width > 0 and crop.height > 0)
