import json
from pathlib import Path

import pytest

from src.config import ConfigError, config_exists, config_file_path, default_replays_dir, load_config, save_config


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    for key in ("HOTS_API_BASE_URL", "HOTS_ACCESS_TOKEN", "HOTS_REPLAYS_DIR", "APPDATA"):
        monkeypatch.delenv(key, raising=False)


def test_load_config_from_env_vars(monkeypatch, tmp_path):
    monkeypatch.setenv("HOTS_API_BASE_URL", "https://api.example.com/")
    monkeypatch.setenv("HOTS_ACCESS_TOKEN", "hots_pat_abc")
    monkeypatch.setenv("HOTS_REPLAYS_DIR", str(tmp_path))

    config = load_config()

    assert config.api_base_url == "https://api.example.com"  # trailing slash stripped
    assert config.access_token == "hots_pat_abc"
    assert config.replays_dir == tmp_path


def test_load_config_missing_token_raises(monkeypatch, tmp_path):
    monkeypatch.setenv("HOTS_API_BASE_URL", "https://api.example.com")
    monkeypatch.setenv("HOTS_REPLAYS_DIR", str(tmp_path))

    with pytest.raises(ConfigError):
        load_config()


def test_load_config_reads_config_file(monkeypatch, tmp_path):
    appdata = tmp_path / "AppData"
    config_dir = appdata / "hots-analytics"
    config_dir.mkdir(parents=True)
    (config_dir / "config.json").write_text(
        json.dumps(
            {
                "apiBaseUrl": "https://api.example.com",
                "accessToken": "hots_pat_from_file",
                "replaysDir": str(tmp_path),
            }
        )
    )
    monkeypatch.setenv("APPDATA", str(appdata))

    config = load_config()

    assert config.access_token == "hots_pat_from_file"


def test_load_config_env_overrides_file(monkeypatch, tmp_path):
    appdata = tmp_path / "AppData"
    config_dir = appdata / "hots-analytics"
    config_dir.mkdir(parents=True)
    (config_dir / "config.json").write_text(
        json.dumps(
            {
                "apiBaseUrl": "https://from-file.example.com",
                "accessToken": "hots_pat_from_file",
                "replaysDir": str(tmp_path),
            }
        )
    )
    monkeypatch.setenv("APPDATA", str(appdata))
    monkeypatch.setenv("HOTS_ACCESS_TOKEN", "hots_pat_from_env")

    config = load_config()

    assert config.access_token == "hots_pat_from_env"
    assert config.api_base_url == "https://from-file.example.com"


def test_default_replays_dir_globs_account_folders(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    replay_dir = tmp_path / "Documents" / "Heroes of the Storm" / "Accounts" / "12345" / "1-Hero-1-1" / "Replays" / "Multiplayer"
    replay_dir.mkdir(parents=True)

    assert default_replays_dir() == replay_dir


def test_default_replays_dir_prefers_account_with_replays(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    accounts = tmp_path / "Documents" / "Heroes of the Storm" / "Accounts"
    empty_dir = accounts / "11111" / "1-Hero-1-1" / "Replays" / "Multiplayer"
    populated_dir = accounts / "99999" / "1-Hero-1-2" / "Replays" / "Multiplayer"
    empty_dir.mkdir(parents=True)
    populated_dir.mkdir(parents=True)
    (populated_dir / "Game.StormReplay").write_bytes(b"")

    assert default_replays_dir() == populated_dir


def test_default_replays_dir_returns_none_when_absent(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    assert default_replays_dir() is None


def test_config_exists_false_before_save_true_after(monkeypatch, tmp_path):
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))

    assert config_exists() is False

    save_config("https://api.example.com", "hots_pat_abc", str(tmp_path))

    assert config_exists() is True
    saved = json.loads(config_file_path().read_text(encoding="utf-8"))
    assert saved == {
        "apiBaseUrl": "https://api.example.com",
        "accessToken": "hots_pat_abc",
        "replaysDir": str(tmp_path),
    }


def test_save_config_strips_trailing_slash_from_api_base_url(monkeypatch, tmp_path):
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))

    save_config("https://api.example.com/", "hots_pat_abc", str(tmp_path))

    saved = json.loads(config_file_path().read_text(encoding="utf-8"))
    assert saved["apiBaseUrl"] == "https://api.example.com"
