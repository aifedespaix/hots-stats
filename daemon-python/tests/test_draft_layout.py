from PIL import Image

from src.draft_layout import extract_player_crops, extract_team_crops


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


def test_extract_team_crops_exposes_intermediate_strip_and_rotated_images():
    left, right = extract_team_crops(_synthetic_screenshot())
    expected_left, expected_right = extract_player_crops(_synthetic_screenshot())

    for result, expected in ((left, expected_left), (right, expected_right)):
        assert result.strip.width > 0 and result.strip.height > 0
        assert result.rotated.width > 0 and result.rotated.height > 0
        assert len(result.player_crops) == 5
        assert [crop.size if crop else None for crop in result.player_crops] == [
            crop.size if crop else None for crop in expected
        ]
