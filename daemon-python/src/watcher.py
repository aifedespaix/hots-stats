"""Watches the replays folder for newly-written `.StormReplay` files."""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Callable

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

logger = logging.getLogger(__name__)

# The game can still be writing the file when the `on_created` event fires;
# we wait for its size to stop changing before treating it as ready.
_STABILITY_POLL_SECONDS = 1.0
_STABILITY_MAX_POLLS = 30


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
    def __init__(self, on_replay_ready: Callable[[Path], None]) -> None:
        self._on_replay_ready = on_replay_ready

    def on_created(self, event: FileSystemEvent) -> None:
        if event.is_directory or not event.src_path.endswith(".StormReplay"):
            return
        path = Path(event.src_path)
        logger.info("New replay detected: %s", path)
        if not _wait_until_stable(path):
            logger.warning("Replay file never stabilized, skipping: %s", path)
            return
        self._on_replay_ready(path)


def watch_replays(
    replays_dir: Path,
    on_replay_ready: Callable[[Path], None],
    stop_event: threading.Event | None = None,
) -> None:
    """Blocks, calling `on_replay_ready(path)` for each new stable `.StormReplay` file.

    Returns once `stop_event` is set (or on Ctrl+C, when run without one),
    stopping the underlying observer thread cleanly first. Passing a
    `stop_event` lets a caller running this on a background thread (e.g. the
    tray app) request a clean shutdown instead of relying on a signal.
    """
    handler = _ReplayHandler(on_replay_ready)
    observer = Observer()
    observer.schedule(handler, str(replays_dir), recursive=False)
    observer.start()
    logger.info("Watching %s for new replays...", replays_dir)
    event = stop_event or threading.Event()
    try:
        while not event.is_set():
            event.wait(1)
    except KeyboardInterrupt:
        pass
    finally:
        observer.stop()
        observer.join()
        logger.info("Stopped watching %s", replays_dir)
