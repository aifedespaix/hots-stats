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

from . import api_client, draft_capture, hotkey, single_instance
from .config import Config, ConfigError, config_exists, is_auto_update_enabled, load_config
from .ingestion import ingest_file
from .status import StatusTracker
from .sync_state import SyncState
from .updater import AvailableUpdate, UpdateStatusTracker, watch_for_updates
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
    sync_state: SyncState | None = None,
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
    if sync_state is not None:
        # So the Debug report can flag "source file missing" for anything
        # tracked that's no longer where it was synced from (moved,
        # deleted, or a replays folder that got repointed elsewhere).
        sync_state.refresh_file_existence({str(path) for path in existing})
    for path in existing:
        if stop_event.is_set():
            return
        ingest(path)

    def _on_new_replay(path: Path) -> None:
        status.bump_found()
        ingest(path)

    watch_replays(replays_dir, on_replay_ready=_on_new_replay, stop_event=stop_event)


def _sync_api_version(config: Config, sync_state: SyncState) -> str | None:
    """Called once per daemon start: asks the API its version and, if it
    reports a `minParserVersion`, drops the local "already synced" record
    for anything synced below it (see `SyncState.invalidate_stale`) so it
    gets reparsed and re-uploaded on this run instead of being skipped.
    Also checks `dataResetAt` (see below) for the same "reprocess
    everything" trigger, scoped to this account instead of every daemon.

    This is deliberately API-driven rather than daemon-driven: the daemon
    never decides on its own to "resync everything", it only ever reacts to
    what the API currently says it wants, via its `minParserVersion`
    selector. Best-effort -- if the API can't be reached (offline, briefly
    down), existing sync state is left untouched rather than treated as
    "nothing needs resyncing" or, worse, "resync everything".
    """
    info = api_client.fetch_version(config.api_base_url, config.access_token)
    if info is None:
        logger.info("Could not reach the API to check its version; keeping local sync state as-is.")
        return sync_state.get_meta("api_version")

    api_version = info.get("apiVersion")
    min_parser_version = info.get("minParserVersion")
    if min_parser_version:
        invalidated = sync_state.invalidate_stale(min_parser_version)
        if invalidated:
            logger.info(
                "API requires parser version >= %s: %d previously-synced replay(s) will be resynced.",
                min_parser_version,
                invalidated,
            )

    # `dataResetAt` is set once this account ever uses "Réinitialiser mes
    # données" in the Settings page (POST /auth/me/reset-data): every match
    # they'd uploaded is gone server-side, so the local cache of "already
    # synced" replays is now entirely wrong -- not just stale for some -- and
    # must be dropped wholesale rather than filtered by version. Compared
    # against the last value *this daemon install* has seen (`meta` table),
    # not simply "is it set", so a) a fresh install with nothing to wipe
    # doesn't bother, and b) each account only triggers one wipe per reset,
    # not one on every single startup thereafter.
    data_reset_at = info.get("dataResetAt")
    if data_reset_at:
        last_seen_reset_at = sync_state.get_meta("data_reset_at")
        if last_seen_reset_at is not None and last_seen_reset_at != data_reset_at:
            wiped = sync_state.wipe_all()
            logger.info(
                "Account data was reset (%s): %d local replay record(s) cleared, "
                "everything will be reparsed and re-uploaded from disk.",
                data_reset_at,
                wiped,
            )
        sync_state.set_meta("data_reset_at", data_reset_at)

    if api_version:
        sync_state.set_meta("api_version", api_version)
    return api_version


class _DaemonRunner:
    """Starts/stops the background replay-watcher thread, one instance at a time."""

    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._stop_event: threading.Event | None = None
        self.status = StatusTracker()
        self.sync_state: SyncState | None = None
        # `_client` is swapped by every `start()` call; the hotkey manager
        # itself is built once and kept for the app's whole lifetime so
        # settings-window rebinds (`start()` again with a new hotkey) just
        # re-register on the same instance instead of leaking a new one.
        self._client: api_client.ApiClient | None = None
        self.hotkey_manager = hotkey.HotkeyManager(on_trigger=self._trigger_draft_capture)

    def _trigger_draft_capture(self) -> None:
        # Runs on `keyboard`'s own internal dispatch thread -- handing off
        # to a fresh thread immediately keeps a slow capture (screenshot +
        # OCR) from delaying that thread's next keystroke.
        client = self._client
        if client is None:
            return
        threading.Thread(
            target=draft_capture.capture_and_submit, args=(client,), name="hots-draft-capture", daemon=True
        ).start()

    def start(self, config: Config) -> None:
        self.stop()  # ensure any previous thread is fully stopped before starting a new one
        self.status = StatusTracker()  # fresh counters for this run

        client = api_client.ApiClient(config)
        self._client = client
        if config.draft_feature_enabled:
            self.hotkey_manager.start(config.draft_hotkey)
        else:
            self.hotkey_manager.stop()
        sync_state = SyncState()
        self.sync_state = sync_state
        stop_event = threading.Event()
        # Resolved on the background thread itself (see `_run` below), not
        # here, so a slow/unreachable API doesn't hold up returning from
        # `start()` -- the caller is either the tray's own startup or the
        # settings-window save handler, neither of which should block on a
        # network round trip.
        api_version_box: dict[str, str | None] = {"value": None}

        def _ingest_and_track(path: Path) -> None:
            self.status.start_syncing(path.name)
            outcome = ingest_file(client, path, sync_state, api_version=api_version_box["value"])
            self.status.finish_syncing(
                ok=outcome.status in ("uploaded", "skipped"),
                error=outcome.detail if outcome.status == "error" else None,
            )

        def _run() -> None:
            api_version_box["value"] = _sync_api_version(config, sync_state)
            _run_sync_loop(config.replays_dir, _ingest_and_track, stop_event, self.status, sync_state)

        thread = threading.Thread(target=_run, name="hots-replay-watcher", daemon=True)
        self._thread = thread
        self._stop_event = stop_event
        thread.start()

    def stop(self, timeout: float = 10.0) -> None:
        self.hotkey_manager.stop()
        if self._thread is None or self._stop_event is None:
            return
        self._stop_event.set()
        self._thread.join(timeout=timeout)
        if self._thread.is_alive():
            logger.warning("Replay watcher thread did not stop within %.0fs", timeout)
        self._thread = None
        self._stop_event = None


def _notify_already_running() -> None:
    """A second launch (double-click, or autostart racing a manual start)
    must not silently do nothing -- pop a small dialog explaining why
    instead of leaving the user wondering where their tray icon went."""
    import tkinter as tk
    from tkinter import messagebox

    root = tk.Tk()
    root.withdraw()
    messagebox.showinfo(
        "HotS Analytics",
        "HotS Analytics est déjà en cours d'exécution (icône dans la zone de notification).",
    )
    root.destroy()


def run_app() -> int:
    from .gui import run_settings_window
    from .tray import TrayController

    if not single_instance.acquire():
        logger.warning("Another instance of the daemon is already running, exiting.")
        _notify_already_running()
        return 1

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
    update_status = UpdateStatusTracker()

    def _on_open_settings() -> None:
        if run_settings_window(
            is_first_run=False,
            status_tracker=daemon.status,
            sync_state=daemon.sync_state,
            update_status=update_status,
        ):
            try:
                new_config = load_config()
            except ConfigError as err:
                logger.error("New configuration is invalid, keeping the previous one running: %s", err)
                return
            logger.info("Configuration changed, restarting the replay watcher.")
            daemon.start(new_config)

    update_stop_event = threading.Event()

    def _on_quit() -> None:
        logger.info("Stopping the replay watcher before exit...")
        update_stop_event.set()
        daemon.stop()

    # Constructed before the update-checker thread starts (but only `.run()`
    # at the very end) so `_on_update_found` below has a tray icon to post
    # its notification to as soon as an update is found, not just once the
    # tray's own message loop gets around to starting.
    tray = TrayController(on_open_settings=_on_open_settings, on_quit=_on_quit)

    def _on_update_found(update: AvailableUpdate) -> None:
        if is_auto_update_enabled():
            # The download + relaunch happen automatically right after this
            # -- this is purely so "why did my tray icon flicker/relaunch"
            # has an answer on screen instead of happening invisibly.
            tray.notify(f"Mise à jour v{update.version} trouvée, installation en cours…", "HotS Analytics")
        else:
            # Auto-update is off: nothing happens until the user clicks
            # "Mettre à jour maintenant" in the settings window themselves.
            tray.notify(
                f"Mise à jour v{update.version} disponible. Ouvrez les paramètres pour l'installer.",
                "HotS Analytics",
            )

    threading.Thread(
        target=watch_for_updates,
        args=(update_stop_event, update_status),
        kwargs={"auto_update_enabled": is_auto_update_enabled, "on_update_found": _on_update_found},
        name="hots-update-checker",
        daemon=True,
    ).start()

    tray.run()
    return 0
