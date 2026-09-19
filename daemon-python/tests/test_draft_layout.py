import json

import pytest
from PIL import Image

from src.draft_layout import (
    BATTLEGROUND_CROP,
    LEFT_TEAM,
    RIGHT_TEAM,
    RelBox,
    TeamLayout,
    crop_config_file_path,
    default_crop_config,
    ensure_crop_config_file,
    extract_battleground_crop,
    extract_player_crops,
    extract_team_crops,
    load_team_layouts,
)


@pytest.fixture(autouse=True)
def _isolated_appdata(monkeypatch, tmp_path):
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))


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


# -- built-in tuning pin --------------------------------------------------


def test_left_team_slot_1_matches_the_current_tuning():
    # Pins the built-in default so a future crop retune is a deliberate,
    # visible diff here too.
    assert LEFT_TEAM.player_crops[0] == RelBox(0.143, 0.278, 0.311, 0.294)


def test_team_split_crop_is_unaffected_by_the_player_crop_shift():
    assert LEFT_TEAM.initial_crop == RelBox(0, 0, 0.15, 1)
    assert RIGHT_TEAM.initial_crop == RelBox(0.85, 0, 1, 1)


# -- crop config file (appdata) ------------------------------------------


def test_load_team_layouts_returns_builtin_defaults_when_no_file():
    assert load_team_layouts() == (LEFT_TEAM, RIGHT_TEAM)


def test_ensure_crop_config_file_seeds_defaults():
    path = crop_config_file_path()
    assert not path.is_file()

    ensure_crop_config_file()

    assert path.is_file()
    assert json.loads(path.read_text(encoding="utf-8")) == default_crop_config()


def test_ensure_crop_config_file_does_not_overwrite_an_existing_file():
    path = crop_config_file_path()
    ensure_crop_config_file()
    path.write_text(json.dumps({"custom": True}), encoding="utf-8")

    ensure_crop_config_file()

    assert json.loads(path.read_text(encoding="utf-8")) == {"custom": True}


def test_load_team_layouts_reads_custom_config():
    custom_left = TeamLayout(
        initial_crop=RelBox(0, 0, 0.2, 1),
        rotation_degrees=25,
        player_crops=(RelBox(0.1, 0.1, 0.2, 0.2),) * 5,
        hero_crops=(RelBox(0.1, 0.1, 0.2, 0.2),) * 5,
    )
    path = crop_config_file_path()
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps(
            {
                "left": {
                    "initialCrop": [0, 0, 0.2, 1],
                    "rotationDegrees": 25,
                    "playerCrops": [[0.1, 0.1, 0.2, 0.2]] * 5,
                    "heroCrops": [[0.1, 0.1, 0.2, 0.2]] * 5,
                },
                "right": default_crop_config()["right"],
            }
        ),
        encoding="utf-8",
    )

    left, right = load_team_layouts()

    assert left == custom_left
    assert right == RIGHT_TEAM


def test_load_team_layouts_falls_back_on_malformed_config():
    path = crop_config_file_path()
    path.parent.mkdir(parents=True)
    path.write_text("not json", encoding="utf-8")

    assert load_team_layouts() == (LEFT_TEAM, RIGHT_TEAM)


def test_load_team_layouts_falls_back_per_team_on_invalid_shape():
    path = crop_config_file_path()
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps({"left": {"initialCrop": [0, 0, 0.2, 1], "rotationDegrees": 25, "playerCrops": []}, "right": default_crop_config()["right"]}),
        encoding="utf-8",
    )

    left, right = load_team_layouts()

    assert left == LEFT_TEAM  # invalid (only 5 playerCrops allowed) -> default
    assert right == RIGHT_TEAM


def test_extract_team_crops_uses_custom_config_when_present():
    ensure_crop_config_file()
    data = json.loads(crop_config_file_path().read_text(encoding="utf-8"))
    data["left"]["playerCrops"][0] = [0.0, 0.0, 0.1, 0.1]
    crop_config_file_path().write_text(json.dumps(data), encoding="utf-8")

    left, _right = extract_team_crops(_synthetic_screenshot())

    assert left.layout.player_crops[0] == RelBox(0.0, 0.0, 0.1, 0.1)

# -- battleground + hero crops ------------------------------------------------


def test_extract_team_crops_exposes_five_hero_crops_per_team():
    left, right = extract_team_crops(_synthetic_screenshot())

    for result in (left, right):
        assert len(result.hero_crops) == 5
        for crop in result.hero_crops:
            assert crop is not None
            assert crop.width > 0 and crop.height > 0


def test_hero_crops_sit_above_their_player_name_crop():
    left, _right = extract_team_crops(_synthetic_screenshot())

    for hero_box, player_box in zip(left.layout.hero_crops, left.layout.player_crops):
        assert hero_box.y2 <= player_box.y1


def test_extract_team_crops_degrades_hero_crops_on_a_tiny_screenshot():
    left, right = extract_team_crops(_synthetic_screenshot(10, 10))

    for result in (left, right):
        for crop in result.hero_crops:
            assert crop is None or (crop.width > 0 and crop.height > 0)


def test_default_crop_config_includes_the_battleground_and_hero_crops():
    data = default_crop_config()

    assert data["battlegroundCrop"] == [0.30, 0.005, 0.70, 0.045]
    assert len(data["left"]["heroCrops"]) == 5
    assert len(data["right"]["heroCrops"]) == 5


def test_battleground_crop_matches_the_current_tuning():
    assert BATTLEGROUND_CROP == RelBox(0.30, 0.005, 0.70, 0.045)


def test_extract_battleground_crop_returns_the_configured_region():
    crop = extract_battleground_crop(_synthetic_screenshot())

    assert crop is not None
    x1, y1, x2, y2 = BATTLEGROUND_CROP.to_pixels(1920, 1080)
    assert crop.size == (x2 - x1, y2 - y1)


def test_extract_battleground_crop_is_none_on_a_tiny_screenshot():
    assert extract_battleground_crop(_synthetic_screenshot(10, 10)) is None


def test_left_team_hero_slot_1_matches_the_current_tuning():
    assert LEFT_TEAM.hero_crops[0] == RelBox(0.100, 0.246, 0.300, 0.278)


def test_load_team_layouts_reads_custom_hero_crops():
    path = crop_config_file_path()
    path.parent.mkdir(parents=True)
    data = default_crop_config()
    data["left"]["heroCrops"][0] = [0.0, 0.0, 0.1, 0.1]
    path.write_text(json.dumps(data), encoding="utf-8")

    left, _right = load_team_layouts()

    assert left.hero_crops[0] == RelBox(0.0, 0.0, 0.1, 0.1)


def test_load_team_layouts_keeps_builtin_hero_crops_when_config_omits_them():
    # An appdata config written before the hero crops existed must keep
    # working, falling back to the built-in hero tuning rather than to none.
    path = crop_config_file_path()
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps(
            {
                "left": {"initialCrop": [0, 0, 0.2, 1], "rotationDegrees": 25, "playerCrops": [[0.1, 0.1, 0.2, 0.2]] * 5},
                "right": {"initialCrop": [0.8, 0, 1, 1], "rotationDegrees": -25, "playerCrops": [[0.1, 0.1, 0.2, 0.2]] * 5},
            }
        ),
        encoding="utf-8",
    )

    left, right = load_team_layouts()

    assert left.hero_crops == LEFT_TEAM.hero_crops
    assert right.hero_crops == RIGHT_TEAM.hero_crops

