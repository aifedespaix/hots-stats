"""Local persistence of "this replay is already synced" state.

Without this, `_run_sync_loop` (app.py) re-parses (CPU-heavy `heroprotocol`
decode) and re-POSTs every `.StormReplay` file on disk on every daemon
restart -- the server no-ops the write via `replayHash`, but the daemon
redoes all the work to find that out, every single time. Persisting which
replay hashes are already synced, and at which `constants.PARSER_VERSION`,
lets a restart skip files that are already up to date and only process
files that are new, previously failed, or were synced by an older parser
version (so a daemon update that starts extracting new fields still
reprocesses everything once).
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path

from .config import config_file_path

logger = logging.getLogger(__name__)


def sync_state_file_path() -> Path:
    """Path to the local sync-state cache, next to `config.json`."""
    return config_file_path().with_name("synced.json")


def _version_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(part) if part.isdigit() else 0 for part in version.split("."))


class SyncState:
    """Maps replay content hash -> the parser version it was last
    successfully synced with.

    Loaded once (typically for the lifetime of one daemon run) and
    persisted to disk on every change, so progress survives an unexpected
    exit rather than only being saved on clean shutdown.
    """

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or sync_state_file_path()
        self._lock = threading.Lock()
        self._synced: dict[str, str] = self._load()

    def _load(self) -> dict[str, str]:
        if not self._path.is_file():
            return {}
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as err:
            logger.warning("Failed to read sync state at %s, starting fresh: %s", self._path, err)
            return {}
        if not isinstance(data, dict):
            return {}
        return {str(k): str(v) for k, v in data.items()}

    def is_up_to_date(self, replay_hash: str, parser_version: str) -> bool:
        """True if `replay_hash` was already synced at `parser_version` or newer."""
        with self._lock:
            stored = self._synced.get(replay_hash)
        if stored is None:
            return False
        return _version_tuple(stored) >= _version_tuple(parser_version)

    def mark_synced(self, replay_hash: str, parser_version: str) -> None:
        with self._lock:
            self._synced[replay_hash] = parser_version
            self._save()

    def _save(self) -> None:
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps(self._synced, indent=2), encoding="utf-8")
        except OSError as err:
            logger.warning("Failed to persist sync state to %s: %s", self._path, err)
