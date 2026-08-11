"""Thread-safe snapshot of the background daemon's live state: how many
replays it found on disk, how many it has synced with the API, which one (if
any) it's syncing right now, and the last error it hit -- all so the
settings window can show live progress when reopened while the daemon is
running (see gui.py's `_build_stats` / `_refresh_live_stats`).

One `StatusTracker` instance is owned by `app._DaemonRunner` for the
lifetime of one watcher-thread run; `.start()`ing a new run replaces it with
a fresh one so counters don't carry over a config change.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, replace


@dataclass(frozen=True)
class DaemonStatus:
    found: int = 0
    synced: int = 0
    failed: int = 0
    currently_syncing: str | None = None
    last_error: str | None = None


class StatusTracker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._status = DaemonStatus()

    def snapshot(self) -> DaemonStatus:
        with self._lock:
            return self._status

    def set_found(self, found: int) -> None:
        self._update(found=found)

    def bump_found(self, by: int = 1) -> None:
        with self._lock:
            self._status = replace(self._status, found=self._status.found + by)

    def start_syncing(self, name: str) -> None:
        self._update(currently_syncing=name)

    def finish_syncing(self, *, ok: bool, error: str | None = None) -> None:
        with self._lock:
            self._status = replace(
                self._status,
                currently_syncing=None,
                synced=self._status.synced + (1 if ok else 0),
                failed=self._status.failed + (0 if ok else 1),
                last_error=error if error is not None else self._status.last_error,
            )

    def _update(self, **kwargs: object) -> None:
        with self._lock:
            self._status = replace(self._status, **kwargs)
