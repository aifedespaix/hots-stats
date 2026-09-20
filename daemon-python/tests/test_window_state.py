import json

from src import window_state


def test_window_state_path_defaults_to_appdata(monkeypatch, tmp_path):
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    assert window_state.window_state_path() == (
        tmp_path / "AppData" / "hots-analytics" / "window.json"
    )


def test_load_window_geometry_returns_none_when_file_is_missing(tmp_path):
    assert window_state.load_window_geometry(tmp_path / "window.json") is None


def test_save_then_load_round_trips(tmp_path):
    path = tmp_path / "hots-analytics" / "window.json"
    geometry = window_state.WindowGeometry(width=1024, height=768, x=100, y=50, maximized=False)

    window_state.save_window_geometry(geometry, path)
    loaded = window_state.load_window_geometry(path)

    assert loaded == geometry


def test_save_creates_parent_directory(tmp_path):
    path = tmp_path / "does" / "not" / "exist" / "window.json"
    window_state.save_window_geometry(
        window_state.WindowGeometry(width=800, height=600, x=0, y=0), path
    )
    assert path.is_file()


def test_load_window_geometry_returns_none_on_corrupt_json(tmp_path):
    path = tmp_path / "window.json"
    path.write_text("not json", encoding="utf-8")
    assert window_state.load_window_geometry(path) is None


def test_load_window_geometry_returns_none_when_a_required_field_is_missing(tmp_path):
    path = tmp_path / "window.json"
    path.write_text(json.dumps({"width": 800}), encoding="utf-8")
    assert window_state.load_window_geometry(path) is None


def test_load_window_geometry_defaults_maximized_to_false_when_absent(tmp_path):
    path = tmp_path / "window.json"
    path.write_text(
        json.dumps({"width": 800, "height": 600, "x": 0, "y": 0}), encoding="utf-8"
    )
    assert window_state.load_window_geometry(path).maximized is False


def test_clamp_to_screen_leaves_a_fully_visible_geometry_unchanged():
    geometry = window_state.WindowGeometry(width=1000, height=700, x=100, y=100)
    result = window_state.clamp_to_screen(
        geometry, screen_width=1920, screen_height=1080, min_width=640, min_height=480
    )
    assert result == geometry


def test_clamp_to_screen_pulls_a_partially_off_left_window_back_on_screen():
    geometry = window_state.WindowGeometry(width=1000, height=700, x=-200, y=50)
    result = window_state.clamp_to_screen(
        geometry, screen_width=1920, screen_height=1080, min_width=640, min_height=480
    )
    assert result.x == 0
    assert (result.width, result.height, result.y) == (1000, 700, 50)


def test_clamp_to_screen_pulls_a_window_off_the_right_edge_back_on_screen():
    geometry = window_state.WindowGeometry(width=1000, height=700, x=1800, y=50)
    result = window_state.clamp_to_screen(
        geometry, screen_width=1920, screen_height=1080, min_width=640, min_height=480
    )
    assert result.x == 920  # 1920 - 1000


def test_clamp_to_screen_returns_none_when_the_screen_is_now_too_small():
    """Simulates an undocked laptop: the geometry was saved on a bigger
    external monitor that isn't connected anymore."""
    geometry = window_state.WindowGeometry(width=2400, height=1400, x=100, y=100)
    result = window_state.clamp_to_screen(
        geometry, screen_width=1366, screen_height=768, min_width=640, min_height=480
    )
    assert result is None


def test_clamp_to_screen_returns_none_when_geometry_is_smaller_than_the_minimum():
    geometry = window_state.WindowGeometry(width=300, height=200, x=0, y=0)
    result = window_state.clamp_to_screen(
        geometry, screen_width=1920, screen_height=1080, min_width=640, min_height=480
    )
    assert result is None


def test_clamp_to_screen_preserves_maximized_flag():
    geometry = window_state.WindowGeometry(width=1000, height=700, x=100, y=100, maximized=True)
    result = window_state.clamp_to_screen(
        geometry, screen_width=1920, screen_height=1080, min_width=640, min_height=480
    )
    assert result.maximized is True
