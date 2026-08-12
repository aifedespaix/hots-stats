"""Daemon configuration: API endpoint, access token, and replays folder.

Resolution order (highest priority first):
1. Environment variables (`HOTS_API_BASE_URL`, `HOTS_ACCESS_TOKEN`, `HOTS_REPLAYS_DIR`).
2. A local JSON config file (`%APPDATA%/hots-analytics/config.json` on
   Windows, `~/.config/hots-analytics/config.json` elsewhere).
3. For the replays folder only: an autodetected default under the user's
   Documents folder. There is no safe default for the API URL or token.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)


class ConfigError(Exception):
    """Raised when required configuration is missing or invalid."""


# Default global hotkey for the live-draft capture feature, in the
# `keyboard` package's hotkey syntax (see src/hotkey.py). Chosen because
# it's free in HotS's own default keybinds and not claimed by Windows,
# Discord, OBS or streaming software's own defaults.
DEFAULT_DRAFT_HOTKEY = "ctrl+shift+d"


@dataclass(frozen=True)
class Config:
    api_base_url: str
    access_token: str
    replays_dir: Path
    draft_feature_enabled: bool = True
    draft_hotkey: str = DEFAULT_DRAFT_HOTKEY
    auto_update_enabled: bool = True


def config_file_path() -> Path:
    """Path to the JSON config file, e.g. `%APPDATA%\\hots-analytics\\config.json`."""
    appdata = os.environ.get("APPDATA")
    base = Path(appdata) if appdata else Path.home() / ".config"
    return base / "hots-analytics" / "config.json"


def config_exists() -> bool:
    return config_file_path().is_file()


def open_path(path: Path) -> None:
    """Opens `path` (a file or a folder) with whatever the OS considers its
    default handler -- Explorer for a folder, the default text editor for a
    log file, etc. Best-effort: used from the settings window's "Ouvrir le
    dossier de données" and "Voir le journal" buttons, neither of which
    should be able to crash the window over a missing file or an
    unavailable opener command."""
    try:
        if sys.platform == "win32":
            os.startfile(str(path))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
    except OSError:
        logger.warning("Could not open %s", path, exc_info=True)


def open_config_folder() -> None:
    """Opens `%APPDATA%\\hots-analytics\\` (config.json, sync_state.db,
    update.log, live-draft/) in the OS file explorer -- what the settings
    window's "Ouvrir le dossier de données" button calls. Creates the folder
    first if it doesn't exist yet (e.g. clicked before ever saving a
    config)."""
    path = config_file_path().parent
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        logger.warning("Could not create the data folder at %s", path, exc_info=True)
        return
    open_path(path)


def read_config_file() -> dict:
    """Returns the raw JSON config as a dict, or `{}` if it doesn't exist yet.

    Used both by `load_config()` and by the settings window to prefill its
    fields when reopened.
    """
    path = config_file_path()
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as err:
        raise ConfigError(f"Failed to read config file at {path}: {err}") from err


def save_config(
    api_base_url: str,
    access_token: str,
    replays_dir: str,
    draft_feature_enabled: bool = True,
    draft_hotkey: str = DEFAULT_DRAFT_HOTKEY,
    auto_update_enabled: bool = True,
) -> None:
    """Writes the user-provided fields to the JSON config file, creating its
    parent directory (`%APPDATA%\\hots-analytics\\`) if needed."""
    path = config_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "apiBaseUrl": api_base_url.rstrip("/"),
        "accessToken": access_token,
        "replaysDir": replays_dir,
        "draftFeatureEnabled": draft_feature_enabled,
        "draftHotkey": draft_hotkey,
        "autoUpdateEnabled": auto_update_enabled,
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def default_replays_dir() -> Path | None:
    """Best-effort guess at the default HotS replays folder, e.g.
    `C:\\Users\\<account>\\Documents\\Heroes of the Storm\\Accounts\\<account-id>\\<region-id>\\Replays\\Multiplayer`.

    `Path.home()` already resolves to the real Windows account name (there's
    no separate lookup needed for that). The account-id/region-id segments
    vary per installation -- and a player can have several, e.g. smurf
    accounts -- so we glob for all of them and prefer, in order: one that
    already has replays in it, then the most recently modified, then
    whichever sorts first. Returns None if none exist, so callers (the
    settings window) can leave the field empty rather than prefill a guess
    that doesn't exist on disk.
    """
    documents = Path.home() / "Documents"
    matches = list(documents.glob("Heroes of the Storm/Accounts/*/*/Replays/Multiplayer"))
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]

    def _rank(folder: Path) -> tuple[bool, float, str]:
        has_replays = next(folder.glob("*.StormReplay"), None) is not None
        try:
            mtime = folder.stat().st_mtime
        except OSError:
            mtime = 0.0
        return (has_replays, mtime, str(folder))

    return max(matches, key=_rank)


def load_config() -> Config:
    file_values = read_config_file()

    api_base_url = os.environ.get("HOTS_API_BASE_URL") or file_values.get("apiBaseUrl")
    access_token = os.environ.get("HOTS_ACCESS_TOKEN") or file_values.get("accessToken")
    replays_dir_value = os.environ.get("HOTS_REPLAYS_DIR") or file_values.get("replaysDir")

    if not api_base_url:
        raise ConfigError(
            "Missing API base URL. Set HOTS_API_BASE_URL or `apiBaseUrl` in "
            f"{config_file_path()}."
        )
    if not access_token:
        raise ConfigError(
            "Missing access token. Set HOTS_ACCESS_TOKEN or `accessToken` in "
            f"{config_file_path()} (generate one from the dashboard's Settings page)."
        )

    if replays_dir_value:
        replays_dir = Path(replays_dir_value)
    else:
        replays_dir = default_replays_dir()
        if replays_dir is None:
            raise ConfigError(
                "Could not autodetect the HotS replays folder. Set HOTS_REPLAYS_DIR or "
                f"`replaysDir` in {config_file_path()}."
            )

    draft_feature_enabled = file_values.get("draftFeatureEnabled")
    draft_hotkey = os.environ.get("HOTS_DRAFT_HOTKEY") or file_values.get("draftHotkey") or DEFAULT_DRAFT_HOTKEY
    auto_update_enabled = file_values.get("autoUpdateEnabled")

    return Config(
        api_base_url=api_base_url.rstrip("/"),
        access_token=access_token,
        replays_dir=replays_dir,
        draft_feature_enabled=True if draft_feature_enabled is None else bool(draft_feature_enabled),
        draft_hotkey=draft_hotkey,
        auto_update_enabled=True if auto_update_enabled is None else bool(auto_update_enabled),
    )


def is_auto_update_enabled() -> bool:
    """Reads just the `autoUpdateEnabled` preference, independent of the
    rest of `load_config()` -- used by the update-checker background thread
    (`updater.watch_for_updates`), which must keep working even if the
    config file is otherwise unreadable (defaulting to "on", matching the
    field's own default) rather than raising `ConfigError` over a field
    that's unrelated to the API/token/replays-dir it validates."""
    try:
        return bool(read_config_file().get("autoUpdateEnabled", True))
    except ConfigError:
        return True
