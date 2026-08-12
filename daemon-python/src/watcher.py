"""Watches the replays folder for newly-written `.StormReplay` files."""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Callable, Iterable

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

logger = logging.getLogger(__name__)

# The game can still be writing the file when the `on_created` event fires;
# we wait for its size to stop changing before treating it as ready.
_STABILITY_POLL_SECONDS = 1.0
_STABILITY_MAX_POLLS = 30

# Belt-and-suspenders re-scan of the folder, on top of the `watchdog` event
# above: a filesystem-change notification can be dropped by the OS (seen in
# practice on Windows -- a `ReadDirectoryChangesW` buffer overflow, or an
# antivirus/cloud-sync tool briefly locking the folder), which would
# otherwise leave a replay sitting unsynced until the daemon's next restart.
_POLL_INTERVAL_SECONDS = 60.0


def _wait_until_stable(path: Path) -> bool:
    """Polls the file size until it stops changing. Returns False if the
    file disappeared or never stabilized within the poll budget."""
    last_size = -1
    for _ in range(_STABILITY_MAX_POLLS):
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            return False
        if size == last_size and size > 0:
            return True
        last_size = size
        time.sleep(_STABILITY_POLL_SECONDS)
    return False


class _ReplayHandler(FileSystemEventHandler):
    def __init__(
        self,
        on_replay_ready: Callable[[Path], None],
        seen: set[str],
        seen_lock: threading.Lock,
    ) -> None:
        self._on_replay_ready = on_replay_ready
        self._seen = seen
        self._seen_lock = seen_lock

    def on_created(self, event: FileSystemEvent) -> None:
        if event.is_directory or not event.src_path.endswith(".StormReplay"):
            return
        path = Path(event.src_path)
        with self._seen_lock:
            if str(path) in self._seen:
                return  # already handled by the periodic poll below
            self._seen.add(str(path))
        logger.info("New replay detected: %s", path)
        if not _wait_until_stable(path):
            logger.warning("Replay file never stabilized, skipping: %s", path)
            return
        self._on_replay_ready(path)


def _scan_for_new_replays(replays_dir: Path, seen: set[str]) -> list[Path]:
    """Lists `.StormReplay` files in `replays_dir` not already in `seen`,
    marks them seen, and returns them (sorted, for a deterministic order).

    Callers sharing `seen` with other threads (i.e. `watch_replays`, below)
    are responsible for locking around this call.
    """
    try:
        current = {str(p) for p in replays_dir.glob("*.StormReplay")}
    except OSError as err:
        logger.warning("Could not scan %s for missed replays: %s", replays_dir, err)
        return []
    new_paths = sorted(current - seen)
    seen.update(new_paths)
    return [Path(p) for p in new_paths]


def watch_replays(
    replays_dir: Path,
    on_replay_ready: Callable[[Path], None],
    stop_event: threading.Event | None = None,
    known_paths: Iterable[str] | None = None,
) -> None:
    """Blocks, calling `on_replay_ready(path)` for each new stable `.StormReplay` file.

    Detection is primarily event-driven (via `watchdog`), backed by a
    re-scan of `replays_dir` every `_POLL_INTERVAL_SECONDS` in case a
    filesystem event was ever dropped -- see that constant's comment.
    `known_paths` should be every path the caller already accounted for
    (typically `_run_sync_loop`'s own startup scan, in app.py) so the first
    periodic re-scan doesn't immediately re-report every pre-existing
    replay as newly found.

    Returns once `stop_event` is set (or on Ctrl+C, when run without one),
    stopping the underlying observer thread cleanly first. Passing a
    `stop_event` lets a caller running this on a background thread (e.g. the
    tray app) request a clean shutdown instead of relying on a signal.
    """
    seen_lock = threading.Lock()
    seen: set[str] = set(known_paths) if known_paths else set()
    handler = _ReplayHandler(on_replay_ready, seen, seen_lock)
    observer = Observer()
    observer.schedule(handler, str(replays_dir), recursive=False)
    observer.start()
    logger.info(
        "Watching %s for new replays (re-scanning every %.0fs as a fallback)...",
        replays_dir,
        _POLL_INTERVAL_SECONDS,
    )
    event = stop_event or threading.Event()
    next_poll = time.monotonic() + _POLL_INTERVAL_SECONDS
    try:
        while not event.is_set():
            event.wait(1)
            if event.is_set() or time.monotonic() < next_poll:
                continue
            next_poll = time.monotonic() + _POLL_INTERVAL_SECONDS
            with seen_lock:
                missed = _scan_for_new_replays(replays_dir, seen)
            for path in missed:
                if event.is_set():
                    break
                logger.info("Periodic scan found a replay the watcher missed: %s", path)
                if not _wait_until_stable(path):
                    logger.warning("Replay file never stabilized, skipping: %s", path)
                    continue
                on_replay_ready(path)
    except KeyboardInterrupt:
        pass
    finally:
        observer.stop()
        observer.join()
        logger.info("Stopped watching %s", replays_dir)
