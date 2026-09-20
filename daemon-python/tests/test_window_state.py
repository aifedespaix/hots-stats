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
