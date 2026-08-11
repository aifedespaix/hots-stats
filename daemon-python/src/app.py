"""Wires together first-run setup, the tray icon, and the background sync
daemon. This is what `python -m src.main` runs by default (no `--resync`).

Threading model:
- Main thread: the tray icon's message loop (`TrayController.run()`), for
  as long as the app is configured and running.
- Daemon thread ("hots-replay-watcher"): `watch_replays`, watching the
  replays folder and uploading new files as they appear. Stopped cleanly via
  a `threading.Event` when the user quits, or restarted when settings change.
- Settings window: see gui.py / tray.py for why it gets its own thread.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Callable

from . import api_client
from .config import Config, ConfigError, config_exists, load_config
from .ingestion import ingest_file
from .status import StatusTracker
from .sync_state import SyncState
from .updater import watch_for_updates
from .watcher import watch_replays

# gui/tray need tkinter/pystray (a display), same as main.py's lazy `from
# .app import run_app` for `--resync`: importing them only inside run_app()
# keeps the rest of this module (in particular `_DaemonRunner` /
# `_run_sync_loop`, which is where the actual sync logic lives) importable
# and unit-testable headlessly.

logger = logging.getLogger(__name__)


def _run_sync_loop(
    replays_dir: Path,
    ingest: Callable[[Path], None],
    stop_event: threading.Event,
    status: StatusTracker,
) -> None:
    """Uploads every replay already on disk, then hands off to `watch_replays`
    for new ones.

    Without this initial pass, a folder full of replays from before the
    daemon was ever configured would sit there forever: `watch_replays` only
    reacts to files *created* while it's watching, so plugging in an already
    populated folder looked like "configured the daemon, nothing uploads".
    """
    existing = sorted(replays_dir.glob("*.StormReplay"))
    status.set_found(len(existing))
    logger.info("Found %d replay(s) already on disk in %s", len(existing), replays_dir)
    for path in existing:
        if stop_event.is_set():
            return
        ingest(path)

    def _on_new_replay(path: Path) -> None:
        status.bump_found()
        ingest(path)

    watch_replays(replays_dir, on_replay_ready=_on_new_replay, stop_event=stop_event)


class _DaemonRunner:
    """Starts/stops the background replay-watcher thread, one instance at a time."""

    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._stop_event: threading.Event | None = None
        self.status = StatusTracker()

    def start(self, config: Config) -> None:
        self.stop()  # ensure any previous thread is fully stopped before starting a new one
        self.status = StatusTracker()  # fresh counters for this run

        client = api_client.ApiClient(config)
        sync_state = SyncState()
        stop_event = threading.Event()

        def _ingest_and_track(path: Path) -> None:
            self.status.start_syncing(path.name)
            outcome = ingest_file(client, path, sync_state)
            self.status.finish_syncing(
                ok=outcome.status in ("uploaded", "skipped"),
                error=outcome.detail if outcome.status == "error" else None,
            )

        thread = threading.Thread(
            target=_run_sync_loop,
            args=(config.replays_dir, _ingest_and_track, stop_event, self.status),
            name="hots-replay-watcher",
            daemon=True,
        )
        self._thread = thread
        self._stop_event = stop_event
        thread.start()

    def stop(self, timeout: float = 10.0) -> None:
        if self._thread is None or self._stop_event is None:
            return
        self._stop_event.set()
        self._thread.join(timeout=timeout)
        if self._thread.is_alive():
            logger.warning("Replay watcher thread did not stop within %.0fs", timeout)
        self._thread = None
        self._stop_event = None


def run_app() -> int:
    from .gui import run_settings_window
    from .tray import TrayController

    if not config_exists():
        logger.info("No configuration found, opening first-run setup window.")
        if not run_settings_window(is_first_run=True):
            logger.info("Setup was cancelled, exiting.")
            return 1

    try:
        config = load_config()
    except ConfigError as err:
        logger.error("%s", err)
        return 1

    daemon = _DaemonRunner()
    daemon.start(config)

    update_stop_event = threading.Event()
    threading.Thread(
        target=watch_for_updates,
        args=(update_stop_event,),
        name="hots-update-checker",
        daemon=True,
    ).start()

    def _on_open_settings() -> None:
        if run_settings_window(is_first_run=False, status_tracker=daemon.status):
            try:
                new_config = load_config()
            except ConfigError as err:
                logger.error("New configuration is invalid, keeping the previous one running: %s", err)
                return
            logger.info("Configuration changed, restarting the replay watcher.")
            daemon.start(new_config)

    def _on_quit() -> None:
        logger.info("Stopping the replay watcher before exit...")
        update_stop_event.set()
        daemon.stop()

    tray = TrayController(on_open_settings=_on_open_settings, on_quit=_on_quit)
    tray.run()
    return 0
