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

from . import api_client
from .config import Config, ConfigError, config_exists, load_config
from .gui import run_settings_window
from .ingestion import ingest_file
from .tray import TrayController
from .watcher import watch_replays

logger = logging.getLogger(__name__)


class _DaemonRunner:
    """Starts/stops the background replay-watcher thread, one instance at a time."""

    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._stop_event: threading.Event | None = None

    def start(self, config: Config) -> None:
        self.stop()  # ensure any previous thread is fully stopped before starting a new one

        client = api_client.ApiClient(config)
        stop_event = threading.Event()
        thread = threading.Thread(
            target=watch_replays,
            args=(config.replays_dir,),
            kwargs={"on_replay_ready": lambda path: ingest_file(client, path), "stop_event": stop_event},
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

    def _on_open_settings() -> None:
        if run_settings_window(is_first_run=False):
            try:
                new_config = load_config()
            except ConfigError as err:
                logger.error("New configuration is invalid, keeping the previous one running: %s", err)
                return
            logger.info("Configuration changed, restarting the replay watcher.")
            daemon.start(new_config)

    def _on_quit() -> None:
        logger.info("Stopping the replay watcher before exit...")
        daemon.stop()

    tray = TrayController(on_open_settings=_on_open_settings, on_quit=_on_quit)
    tray.run()
    return 0
