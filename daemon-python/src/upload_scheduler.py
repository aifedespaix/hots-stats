"""Uploads replays one at a time, so syncing never competes with a game being played.

Replaces the 4-thread pool the initial backlog used to run through (`app._run_sync_loop`):
one worker thread, one HTTP session (the one inside `ApiClient`), two queues.

- **new** replays (a game just ended, seen by `watch_replays`) always go first and are never
  held back -- one file is cheap and the player wants it on the dashboard.
- the **backlog** (everything already on disk at startup) drains slowly, `backlog_pause`
  seconds apart, and is held back while Heroes of the Storm is running (unless the player
  turned on "Synchroniser pendant le jeu"), while the player paused it, or while the
  `backlog_gate` says no (daemon's `heroprotocol` too old, see dependency_guard.py).
- an auth failure stops *everything* (every later request would fail the same way, and
  `ingest_file` would mark each file as an error); a network/5xx failure backs off
  exponentially and re-queues the file at most `max_requeues` times.

`step()` does one unit of work and is what the tests drive; the thread just loops over it.
"""

from __future__ import annotations

import logging
import threading
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .ingestion import IngestOutcome

logger = logging.getLogger(__name__)

MODE_AUTO = "auto"
MODE_PAUSED = "paused"
# `SyncState` meta key behind the "Synchroniser pendant le jeu" checkbox ("1" / "0"). Stored
# there rather than in config.json so toggling it needs no daemon restart.
SYNC_DURING_GAME_META_KEY = "sync_during_game"


@dataclass
class _Item:
    path: Path
    toon: str | None
    backlog: bool
    attempts: int = 0


@dataclass(frozen=True)
class SchedulerSnapshot:
    live: dict[str, str]  # file path -> "pending" | "uploading"
    mode: str
    blocked: str | None  # "auth" | "paused" | "game" | "dependency" | None


class UploadScheduler:
    def __init__(
        self,
        ingest: Callable[[Path, str | None], IngestOutcome],
        *,
        stop_event: threading.Event,
        is_game_running: Callable[[], bool],
        sync_during_game: Callable[[], bool] = lambda: False,
        backlog_gate: Callable[[], bool] = lambda: True,
        backlog_pause: float = 1.0,
        on_idle: Callable[[], None] | None = None,
        on_auth_blocked: Callable[[], None] | None = None,
        on_thread_start: Callable[[], None] | None = None,
        wait: Callable[[float], object] | None = None,
        poll_seconds: float = 1.0,
        backoff_base: float = 2.0,
        backoff_max: float = 300.0,
        max_requeues: int = 2,
    ) -> None:
        self._ingest = ingest
        self._stop = stop_event
        self._is_game_running = is_game_running
        self._sync_during_game = sync_during_game
        self._backlog_gate = backlog_gate
        self._backlog_pause = backlog_pause
        self._on_idle = on_idle
        self._on_auth_blocked = on_auth_blocked
        self._on_thread_start = on_thread_start
        self._wait = wait if wait is not None else stop_event.wait
        self._poll = poll_seconds
        self._backoff_base = backoff_base
        self._backoff_max = backoff_max
        self._max_requeues = max_requeues
        self._cond = threading.Condition()
        self._new: deque[_Item] = deque()
        self._backlog: deque[_Item] = deque()
        self._live: dict[str, str] = {}
        self._mode = MODE_AUTO
        self._auth_blocked = False
        self._consecutive_server_errors = 0
        self._thread: threading.Thread | None = None

    # -- public ---------------------------------------------------------

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="hots-upload-scheduler", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 10.0) -> None:
        self._stop.set()
        with self._cond:
            self._cond.notify_all()
        if self._thread is not None:
            self._thread.join(timeout=timeout)

    def enqueue_new(self, path: Path, toon: str | None) -> None:
        with self._cond:
            self._new.append(_Item(path, toon, backlog=False))
            self._live[str(path)] = "pending"
            self._cond.notify_all()

    def enqueue_backlog(self, items: list[tuple[Path, str | None]]) -> None:
        with self._cond:
            for path, toon in items:
                self._backlog.append(_Item(path, toon, backlog=True))
                self._live[str(path)] = "pending"
            self._cond.notify_all()

    @property
    def mode(self) -> str:
        return self._mode

    def set_mode(self, mode: str) -> None:
        with self._cond:
            self._mode = mode
            self._cond.notify_all()

    def snapshot(self) -> SchedulerSnapshot:
        with self._cond:
            return SchedulerSnapshot(dict(self._live), self._mode, self._blocked_reason())

    def step(self) -> bool:
        item = self._take()
        if item is None:
            if self._on_idle is not None:
                try:
                    self._on_idle()
                except Exception:  # noqa: BLE001 -- an idle hook must never kill the worker
                    logger.debug("Scheduler idle hook failed", exc_info=True)
            return False
        self._handle(item)
        return True

    # -- internals ------------------------------------------------------

    def _run(self) -> None:
        if self._on_thread_start is not None:
            self._on_thread_start()
        while not self._stop.is_set():
            self.step()

    def _backlog_allowed(self) -> bool:
        if not self._backlog_gate() or self._mode == MODE_PAUSED:
            return False
        return self._sync_during_game() or not self._is_game_running()

    def _blocked_reason(self) -> str | None:
        if self._auth_blocked:
            return "auth"
        if not self._backlog:
            return None
        if self._mode == MODE_PAUSED:
            return "paused"
        if not self._backlog_gate():
            return "dependency"
        if not self._sync_during_game() and self._is_game_running():
            return "game"
        return None

    def _take(self) -> _Item | None:
        with self._cond:
            if not self._auth_blocked:
                item = None
                if self._new:
                    item = self._new.popleft()
                elif self._backlog and self._backlog_allowed():
                    item = self._backlog.popleft()
                if item is not None:
                    self._live[str(item.path)] = "uploading"
                    return item
            self._cond.wait(self._poll)
            return None

    def _handle(self, item: _Item) -> None:
        try:
            outcome = self._ingest(item.path, item.toon)
        except Exception as err:  # noqa: BLE001 -- ingest_file never raises; belt and braces
            logger.exception("Unexpected failure ingesting %s", item.path)
            outcome = IngestOutcome("error", f"{type(err).__name__}: {err}")

        requeue = False
        if outcome.error_kind == "auth":
            with self._cond:
                self._auth_blocked = True
                self._live.pop(str(item.path), None)
            logger.error("Upload paused: the access token was rejected.")
            if self._on_auth_blocked is not None:
                self._on_auth_blocked()
            return
        if outcome.error_kind == "server":
            delay = min(self._backoff_max, self._backoff_base * (2 ** self._consecutive_server_errors))
            self._consecutive_server_errors += 1
            self._wait(delay)
            requeue = item.attempts < self._max_requeues
        else:
            self._consecutive_server_errors = 0

        with self._cond:
            if requeue:
                item.attempts += 1
                (self._backlog if item.backlog else self._new).append(item)
                self._live[str(item.path)] = "pending"
            else:
                self._live.pop(str(item.path), None)
        # A cheap skip ("already synced", "parse retry budget exhausted") costs no network or
        # CPU, so pacing it only slows the drain down for nothing.
        cheap_skip = outcome.status == "skipped" and outcome.skip_reason is None
        if item.backlog and not requeue and not cheap_skip:
            self._wait(self._backlog_pause)
