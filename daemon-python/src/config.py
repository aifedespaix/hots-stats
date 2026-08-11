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
import os
from dataclasses import dataclass
from pathlib import Path


class ConfigError(Exception):
    """Raised when required configuration is missing or invalid."""


@dataclass(frozen=True)
class Config:
    api_base_url: str
    access_token: str
    replays_dir: Path


def config_file_path() -> Path:
    """Path to the JSON config file, e.g. `%APPDATA%\\hots-analytics\\config.json`."""
    appdata = os.environ.get("APPDATA")
    base = Path(appdata) if appdata else Path.home() / ".config"
    return base / "hots-analytics" / "config.json"


def config_exists() -> bool:
    return config_file_path().is_file()


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


def save_config(api_base_url: str, access_token: str, replays_dir: str) -> None:
    """Writes the 3 user-provided fields to the JSON config file, creating
    its parent directory (`%APPDATA%\\hots-analytics\\`) if needed."""
    path = config_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "apiBaseUrl": api_base_url.rstrip("/"),
        "accessToken": access_token,
        "replaysDir": replays_dir,
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def default_replays_dir() -> Path | None:
    """Best-effort guess at the default HotS replays folder.

    The real path includes account-id and region-id segments that vary per
    installation (`Documents/Heroes of the Storm/Accounts/<id>/<region>/Replays/Multiplayer`),
    so we glob for it and return the first match.
    """
    documents = Path.home() / "Documents"
    matches = sorted(documents.glob("Heroes of the Storm/Accounts/*/*/Replays/Multiplayer"))
    return matches[0] if matches else None


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

    return Config(api_base_url=api_base_url.rstrip("/"), access_token=access_token, replays_dir=replays_dir)
