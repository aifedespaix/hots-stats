"""Daemon configuration: API endpoint, access token, and HotS install folder.

Resolution order (highest priority first):
1. Environment variables (`HOTS_API_BASE_URL`, `HOTS_ACCESS_TOKEN`,
   `HOTS_DIR`, and the legacy `HOTS_REPLAYS_DIR`).
2. A local JSON config file (`%APPDATA%/hots-analytics/config.json` on
   Windows, `~/.config/hots-analytics/config.json` elsewhere).
3. For the HotS folder only: an autodetected default under the user's
   Documents folder. There is no safe default for the API URL or token.

`hotsDir` is the `Documents/Heroes of the Storm` *root*: every account found
under `Accounts/<id>/<toon>/Replays/<queue>` is watched (see
accounts_discovery.py). A pre-multi-account config only had `replaysDir`
(one account's `Replays/<queue>`); it is still honoured as an extra folder and
the root is derived from it when possible, so an existing install keeps
uploading with no user action.
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
    # Documents/Heroes of the Storm, or None when the install only ever
    # configured a legacy single Replays folder (see extra_replay_dirs).
    hots_dir: Path | None
    # Folders watched verbatim, each with no known account (see WatchDir).
    extra_replay_dirs: tuple[Path, ...] = ()
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
    hots_dir: str,
    extra_replay_dirs: tuple[str, ...] = (),
    draft_feature_enabled: bool = True,
    draft_hotkey: str = DEFAULT_DRAFT_HOTKEY,
    auto_update_enabled: bool = True,
) -> None:
    """Writes the user-provided fields to the JSON config file, creating its
    parent directory (`%APPDATA%\\hots-analytics\\`) if needed."""
    path = config_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, object] = {
        "apiBaseUrl": api_base_url.rstrip("/"),
        "accessToken": access_token,
        "hotsDir": hots_dir,
        "draftFeatureEnabled": draft_feature_enabled,
        "draftHotkey": draft_hotkey,
        "autoUpdateEnabled": auto_update_enabled,
    }
    if extra_replay_dirs:
        payload["extraReplayDirs"] = list(extra_replay_dirs)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def default_hots_dir() -> Path | None:
    """`~/Documents/Heroes of the Storm` when it exists, else None.

    The whole root is returned, not one account's replays folder: every
    account under it is watched (see accounts_discovery.py), which is what
    makes a smurf's replays show up without configuring anything extra.
    Returns None when absent, so the settings window can leave the field
    empty rather than prefill a guess that doesn't exist on disk.
    """
    candidate = Path.home() / "Documents" / "Heroes of the Storm"
    return candidate if candidate.is_dir() else None


def derive_hots_dir_from_replays_dir(replays_dir: Path) -> Path | None:
    """Walks up from a legacy `.../Replays/<queue>` path to the HotS root.

    A pre-multi-account config stored one account's `Replays/<queue>` folder
    as `replaysDir`; the root is the parent of the folder named `Accounts`.
    Returns None when the path has no `Accounts` segment, so the caller falls
    back to autodetection.
    """
    for parent in [replays_dir, *replays_dir.parents]:
        if parent.name == "Accounts":
            return parent.parent
    return None


def load_config() -> Config:
    file_values = read_config_file()

    api_base_url = os.environ.get("HOTS_API_BASE_URL") or file_values.get("apiBaseUrl")
    access_token = os.environ.get("HOTS_ACCESS_TOKEN") or file_values.get("accessToken")
    hots_dir_value = os.environ.get("HOTS_DIR") or file_values.get("hotsDir")
    legacy_value = os.environ.get("HOTS_REPLAYS_DIR") or file_values.get("replaysDir")

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

    if hots_dir_value:
        hots_dir: Path | None = Path(hots_dir_value)
    elif legacy_value:
        # Migration: a config saved before hotsDir existed pointed at one
        # account's Replays/<queue>; derive the root from it so every other
        # account (the smurf's, notably) starts being watched too.
        hots_dir = derive_hots_dir_from_replays_dir(Path(legacy_value)) or default_hots_dir()
    else:
        hots_dir = default_hots_dir()

    # The legacy folder keeps being watched, so an install that only ever had
    # replaysDir configured does not silently stop uploading.
    extra_replay_dirs: list[Path] = []
    if legacy_value:
        legacy_path = Path(legacy_value)
        if legacy_path.is_dir() and (hots_dir is None or not legacy_path.is_relative_to(hots_dir)):
            extra_replay_dirs.append(legacy_path)

    # Manually configured extra folders (Settings' "dossiers supplémentaires"),
    # kept in sync with save_config's `extraReplayDirs` key.
    configured_extra = file_values.get("extraReplayDirs")
    if isinstance(configured_extra, list):
        for value in configured_extra:
            extra_path = Path(str(value))
            if not extra_path.is_dir() or extra_path in extra_replay_dirs:
                continue
            if hots_dir is not None and extra_path.is_relative_to(hots_dir):
                continue
            extra_replay_dirs.append(extra_path)

    if hots_dir is None and not extra_replay_dirs:
        raise ConfigError(
            "Could not autodetect the Heroes of the Storm folder. Set HOTS_DIR or "
            f"`hotsDir` in {config_file_path()}."
        )

    draft_feature_enabled = file_values.get("draftFeatureEnabled")
    draft_hotkey = os.environ.get("HOTS_DRAFT_HOTKEY") or file_values.get("draftHotkey") or DEFAULT_DRAFT_HOTKEY
    auto_update_enabled = file_values.get("autoUpdateEnabled")

    return Config(
        api_base_url=api_base_url.rstrip("/"),
        access_token=access_token,
        hots_dir=hots_dir,
        extra_replay_dirs=tuple(extra_replay_dirs),
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
