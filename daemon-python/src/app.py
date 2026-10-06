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
import sys
import threading
from pathlib import Path
from typing import Callable, Sequence

from . import accounts_discovery, api_client, constants, draft_capture, draft_layout, hotkey, ocr, single_instance, updater
from .config import Config, ConfigError, config_exists, is_auto_update_enabled, load_config
from .dependency_guard import DependencyGuard
from .error_reporter import ErrorReporter, ReportingHandler, install_logging_handler, uninstall_logging_handler
from .game_process import GameDetector
from .history_enricher import HistoryEnricher
from .ingestion import IngestOutcome, ingest_file, sync_spatial_calibrations
from .status import StatusTracker
from .sync_state import SyncState
from .upload_scheduler import SYNC_DURING_GAME_META_KEY, UploadScheduler
from .updater import AvailableUpdate, UpdateStatusTracker, watch_for_updates
from .accounts_discovery import WatchDir
from .watcher import watch_replays

# gui/tray need tkinter/pystray (a display), same as main.py's lazy `from
# .app import run_app` for `--resync`: importing them only inside run_app()
# keeps the rest of this module (in particular `_DaemonRunner` /
# `_run_sync_loop`, which is where the actual sync logic lives) importable
# and unit-testable headlessly.

logger = logging.getLogger(__name__)

# How many *consecutive* ingestion failures (no success in between) it takes
# before the tray gets a one-time "something's persistently wrong" toast --
# see `_DaemonRunner._maybe_notify_persistent_failure`. High enough that a
# couple of unrelated one-off failures (one corrupt replay, one dropped
# request) don't trigger it, low enough to still notify well before a whole
# large backlog silently fails end to end (e.g. a revoked token).
_PERSISTENT_FAILURE_THRESHOLD = 5

# How often the maintenance thread (`_DaemonRunner.start`) re-runs the history enrichment.
_MAINTENANCE_INTERVAL_SECONDS = 600


def _lower_worker_priority() -> None:
    """Runs once on the upload scheduler's worker thread (`UploadScheduler`'s
    `on_thread_start`) so replay parsing yields CPU to
    whatever's in the foreground -- typically the game itself, if the
    player starts one while the initial backlog is still draining. No
    detection of "is a game running": lowering the *background* work's
    priority is the general fix, correct regardless of which foreground app
    it's competing with. Best-effort -- a failure here must never stop the
    sync it's trying to make less disruptive."""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        THREAD_PRIORITY_BELOW_NORMAL = -1
        handle = ctypes.windll.kernel32.GetCurrentThread()
        if not ctypes.windll.kernel32.SetThreadPriority(handle, THREAD_PRIORITY_BELOW_NORMAL):
            raise ctypes.WinError()
    except Exception:
        logger.warning("Could not lower sync worker thread priority", exc_info=True)


def _is_provably_known(path: Path, sync_state: SyncState | None) -> bool:
    """True when `ingest_file` would skip `path` without parsing or uploading it: its cached
    hash (same path/size/mtime) is synced at the current parser version, or its parse retry
    budget is spent. Anything uncertain (no state, no stat, never hashed) is *not* known, so
    it gets enqueued. Mirrors `ingest_file`'s own skip conditions on purpose."""
    if sync_state is None:
        return False
    try:
        stat = path.stat()
    except OSError:
        return False
    replay_hash = sync_state.cached_hash(str(path), stat.st_size, stat.st_mtime)
    if replay_hash is None:
        return False
    return sync_state.is_up_to_date(replay_hash, constants.PARSER_VERSION) or sync_state.parse_retry_budget_exhausted(
        replay_hash, constants.PARSER_VERSION, constants.MAX_PARSE_RETRY_ATTEMPTS
    )


def _run_sync_loop(
    watch_dirs: Sequence[WatchDir],
    scheduler,
    stop_event: threading.Event,
    status: StatusTracker,
    sync_state: SyncState | None = None,
    on_initial_scan: Callable[[int], None] | None = None,
) -> None:
    """Hands every replay already on disk *that isn't provably up to date* to
    `scheduler` as backlog, then watches for new ones, which it hands over as
    high-priority work (see upload_scheduler.py: one worker uploads them,
    backlog paused while the game runs).

    Replays already synced at the current parser version (or whose parse
    retry budget is spent) are not enqueued: each backlog item costs a
    pause and a "pending" row in the Sync table, which for thousands of
    already-synced files meant ~1 s each on every start. This relies on the
    caller having run `_sync_api_version` and the calibration sync first --
    they delete stale rows, so stale/recalibrated replays are no longer
    "known" here and get enqueued. The found count (status and
    `on_initial_scan`) still covers every file on disk.

    Without this initial pass, a folder full of replays from before the
    daemon was ever configured would sit there forever: `watch_replays` only
    reacts to files *created* while it's watching, so plugging in an already
    populated folder looked like "configured the daemon, nothing uploads".

    `on_initial_scan`, when given, is called once with the count found,
    before any of them are ingested -- lets a caller (`_DaemonRunner.start`)
    tell the player a backlog was found and is being worked on, instead of
    the settings window just closing with no visible sign anything is
    happening (see tasks/daemon-audit-2026-08-12.md, 2.1).
    """
    # Every account folder, every queue subfolder (see accounts_discovery) --
    # the first path each replay is seen at also tells us which account wrote
    # it, which is what the API links on.
    existing: list[Path] = []
    toon_by_path: dict[str, str | None] = {}
    for watch_dir in watch_dirs:
        for path in sorted(watch_dir.path.glob("*.StormReplay")):
            existing.append(path)
            toon_by_path[str(path)] = watch_dir.toon_handle
    toon_by_dir = {str(watch_dir.path): watch_dir.toon_handle for watch_dir in watch_dirs}
    status.set_found(len(existing))
    logger.info(
        "Found %d replay(s) already on disk in %d folder(s)", len(existing), len(watch_dirs)
    )
    if on_initial_scan is not None:
        on_initial_scan(len(existing))
    if sync_state is not None:
        # So the Debug report can flag "source file missing" for anything
        # tracked that's no longer where it was synced from (moved,
        # deleted, or a replays folder that got repointed elsewhere).
        sync_state.refresh_file_existence({str(path) for path in existing})

    to_sync = [path for path in existing if not _is_provably_known(path, sync_state)]
    if to_sync and not stop_event.is_set():
        scheduler.enqueue_backlog([(path, toon_by_path.get(str(path))) for path in to_sync])
    if stop_event.is_set():
        return

    def _on_new_replay(path: Path) -> None:
        status.bump_found()
        toon_handle = toon_by_path.get(str(path), toon_by_dir.get(str(path.parent)))
        scheduler.enqueue_new(path, toon_handle)

    watch_replays(
        [watch_dir.path for watch_dir in watch_dirs],
        on_replay_ready=_on_new_replay,
        stop_event=stop_event,
        known_paths={str(path) for path in existing},
    )


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
        sync_state.set_meta("min_parser_version", min_parser_version)
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
    # not simply "is it set", so each account only triggers one wipe per
    # reset, not one on every single startup thereafter. Deliberately *not*
    # gated on `last_seen_reset_at is not None`: an install that has synced
    # replays before but never yet observed a `dataResetAt` (i.e. this is the
    # first time this account ever hit the reset button) must still wipe --
    # "never seen locally" is not the same as "nothing to wipe". A fresh
    # install with an empty sync-state table just wipes zero rows, so there's
    # no need to special-case it.
    data_reset_at = info.get("dataResetAt")
    if data_reset_at:
        last_seen_reset_at = sync_state.get_meta("data_reset_at")
        if last_seen_reset_at != data_reset_at:
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
        self._maintenance_thread: threading.Thread | None = None
        self._stop_event: threading.Event | None = None
        self.status = StatusTracker()
        self.sync_state: SyncState | None = None
        self.scheduler: UploadScheduler | None = None
        self._reporter: ErrorReporter | None = None
        self._log_handler: ReportingHandler | None = None
        # `_client` is swapped by every `start()` call; the hotkey manager
        # and draft-capture coordinator are built once and kept for the
        # app's whole lifetime so settings-window rebinds (`start()` again
        # with a new hotkey) just re-register on the same instances instead
        # of leaking new ones -- and so the coordinator's "is this the most
        # recent capture" generation counter survives across rebinds too.
        self._client: api_client.ApiClient | None = None
        self.hotkey_manager = hotkey.HotkeyManager(on_trigger=self.trigger_draft_capture)
        self.draft_capture_status = draft_capture.DraftCaptureCoordinator()
        # Set by `run_app()` via `set_tray_notify`, once the tray icon
        # exists -- None here (and in every headless test constructing a
        # `_DaemonRunner` directly) so the proactive notifications below are
        # simply skipped rather than crashing on a missing tray.
        self._tray_notify: Callable[[str, str], None] | None = None
        # Guards `_maybe_notify_persistent_failure` against sending the same
        # "persistent failure" toast again for every failure past the
        # threshold -- reset on the next success (the streak is over) or the
        # next `start()` (fresh run, fresh judgment).
        self._failure_notified = False
        self._notify_lock = threading.Lock()
        self.dependency_guard = DependencyGuard()
        self._trigger_dependency_update: Callable[[], None] | None = None

    def set_dependency_update_trigger(self, trigger: Callable[[], None]) -> None:
        """Wired by `run_app()` to `updater.trigger_manual_update(update_status)`: what the
        dependency guard calls to fetch a newer daemon when `heroprotocol` is too old."""
        self._trigger_dependency_update = trigger

    def _refresh_dependency_requirement(
        self, config: Config, sync_state: SyncState, reporter: ErrorReporter
    ) -> None:
        info = api_client.fetch_version(config.api_base_url, config.access_token)
        if info is None:
            # Unreachable API is "unknown", not "no requirement": leave the guard as it was.
            return
        minimum = info.get("minHeroprotocolVersion")
        sync_state.set_meta("min_heroprotocol_version", minimum or "")
        if not self.dependency_guard.update(minimum):
            return
        message = f"heroprotocol {constants.HEROPROTOCOL_VERSION} is older than the required {minimum}"
        logger.info("%s; holding the backlog until the daemon is updated.", message)
        reporter.report("dependency", message)
        if self._tray_notify is not None:
            self._tray_notify(
                "Une mise à jour de HotS Analytics est nécessaire pour lire les nouvelles parties.",
                "HotS Analytics",
            )
        if is_auto_update_enabled() and updater.IS_FROZEN and self._trigger_dependency_update is not None:
            self._trigger_dependency_update()

    def set_tray_notify(self, notify: Callable[[str, str], None]) -> None:
        """Wires up `TrayController.notify` (message, title) so this runner
        can proactively surface a found-backlog or a persistent-failure
        toast -- see `start()`'s `announce_initial_scan` and
        `_maybe_notify_persistent_failure`. Called from `run_app()` once the
        tray exists, which is why tray construction was moved ahead of the
        first `start()` call -- see tasks/daemon-audit-2026-08-12.md, 2.1."""
        self._tray_notify = notify

    def _maybe_notify_persistent_failure(self) -> None:
        """Checks the just-updated status and, the first time consecutive
        failures cross `_PERSISTENT_FAILURE_THRESHOLD`, sends one tray toast
        pointing the player at the settings window instead of leaving a
        stuck sync silently failing in the background forever. Cheap to call
        after every ingestion (a lock + a status snapshot), and safe to call
        from several worker threads at once (see `_INITIAL_SYNC_WORKERS`)
        without risking a duplicate toast.
        """
        status = self.status.snapshot()
        if status.consecutive_failures == 0:
            with self._notify_lock:
                self._failure_notified = False
            return
        if self._tray_notify is None or status.consecutive_failures < _PERSISTENT_FAILURE_THRESHOLD:
            return
        with self._notify_lock:
            if self._failure_notified:
                return
            self._failure_notified = True
        self._tray_notify(
            f"Échec de synchronisation répété ({status.consecutive_failures} tentatives). "
            "Ouvrez les paramètres pour voir le détail.",
            "HotS Analytics",
        )

    def trigger_draft_capture(self) -> None:
        # Runs on `keyboard`'s own internal dispatch thread when triggered by
        # the hotkey, or on the Tk thread when triggered manually from the
        # settings window's "Capturer maintenant" button -- handing off to a
        # fresh thread immediately keeps either caller from blocking on a
        # slow capture (screenshot + OCR). Pressing the hotkey again (or
        # clicking the button again) before this thread finishes doesn't
        # queue up a second one behind it -- both run, but
        # `draft_capture_status` makes the older one notice it's been
        # superseded and bail instead of finishing after (and overwriting)
        # the newer one.
        client = self._client
        if client is None:
            return
        threading.Thread(
            target=draft_capture.capture_and_submit,
            args=(client,),
            kwargs={"coordinator": self.draft_capture_status},
            name="hots-draft-capture",
            daemon=True,
        ).start()

    def start(self, config: Config, *, announce_initial_scan: bool = False) -> None:
        """`announce_initial_scan`, when True, has the tray post a one-time
        "found N replays, syncing" toast if the initial on-disk scan finds
        any -- see `_run_sync_loop`'s `on_initial_scan`. Deliberately opt-in
        (only `run_app()`'s very first `start()` call, on a true first-ever
        run, passes it) rather than on every restart: a returning player
        with thousands of already-synced replays on disk would otherwise get
        this toast on every reboot, even though almost nothing is actually
        about to sync -- see tasks/daemon-audit-2026-08-12.md, 2.1.
        """
        self.stop()  # ensure any previous thread is fully stopped before starting a new one
        self.status = StatusTracker()  # fresh counters for this run
        self._failure_notified = False

        client = api_client.ApiClient(config)
        self._client = client
        if config.draft_feature_enabled:
            self.hotkey_manager.start(config.draft_hotkey)
        else:
            self.hotkey_manager.stop()
        sync_state = SyncState()
        self.sync_state = sync_state
        reporter = ErrorReporter(client.post_ingest_error, sync_state)
        self._reporter = reporter
        if self._log_handler is not None:
            uninstall_logging_handler(self._log_handler)
        self._log_handler = install_logging_handler(reporter)
        stop_event = threading.Event()
        # Resolved on the background thread itself (see `_run` below), not
        # here, so a slow/unreachable API doesn't hold up returning from
        # `start()` -- the caller is either the tray's own startup or the
        # settings-window save handler, neither of which should block on a
        # network round trip.
        api_version_box: dict[str, str | None] = {"value": None}
        calibrations_box: dict[str, dict | None] = {"value": None}

        def _ingest_and_track(path: Path, toon_handle: str | None) -> IngestOutcome:
            self.status.start_syncing(path.name)
            outcome = ingest_file(
                client,
                path,
                sync_state,
                api_version=api_version_box["value"],
                calibrations=calibrations_box["value"],
                toon_handle=toon_handle,
                reporter=reporter,
            )
            self.status.finish_syncing(
                path.name,
                ok=outcome.status in ("uploaded", "skipped"),
                error=outcome.detail if outcome.status == "error" else None,
                skip_reason=outcome.skip_reason,
            )
            self._maybe_notify_persistent_failure()
            reporter.flush()
            return outcome

        def _on_initial_scan(found: int) -> None:
            if announce_initial_scan and found > 0 and self._tray_notify is not None:
                self._tray_notify(
                    f"{found} replay(s) trouvé(s), synchronisation en cours…",
                    "HotS Analytics",
                )

        # Resolved once per start: every HotS account found on disk, plus any
        # manually configured extra folder.
        watch_dirs = accounts_discovery.watch_dirs(config.hots_dir, config.extra_replay_dirs)
        if not watch_dirs:
            logger.warning(
                "No replay folder found (hotsDir=%s, extra=%s)",
                config.hots_dir,
                config.extra_replay_dirs,
            )

        detector = GameDetector()
        scheduler = UploadScheduler(
            _ingest_and_track,
            stop_event=stop_event,
            is_game_running=detector.is_running,
            sync_during_game=lambda: sync_state.get_meta(SYNC_DURING_GAME_META_KEY) == "1",
            backlog_gate=lambda: not self.dependency_guard.blocked,
            on_idle=reporter.flush,
            on_auth_blocked=self._notify_auth_blocked,
            on_thread_start=_lower_worker_priority,
        )
        self.scheduler = scheduler
        scheduler.start()

        def _run() -> None:
            api_version_box["value"] = _sync_api_version(config, sync_state)
            calibrations_box["value"] = sync_spatial_calibrations(config, sync_state)
            _run_sync_loop(
                watch_dirs,
                scheduler,
                stop_event,
                self.status,
                sync_state,
                on_initial_scan=_on_initial_scan,
            )

        thread = threading.Thread(target=_run, name="hots-replay-watcher", daemon=True)
        self._thread = thread
        self._stop_event = stop_event
        thread.start()

        enricher = HistoryEnricher(client, sync_state, stop_event=stop_event)

        def _maintenance() -> None:
            # Runs once shortly after start, then every 10 minutes: fills the Sync table's
            # display data and reconciles replays whose quarantined build the API has since
            # verified. Cheap (one small request per 200 rows) and best-effort.
            while not stop_event.is_set():
                try:
                    self._refresh_dependency_requirement(config, sync_state, reporter)
                    enricher.run_once()
                except Exception:  # noqa: BLE001
                    logger.warning("Maintenance pass failed", exc_info=True)
                if stop_event.wait(_MAINTENANCE_INTERVAL_SECONDS):
                    return

        self._maintenance_thread = threading.Thread(target=_maintenance, name="hots-maintenance", daemon=True)
        self._maintenance_thread.start()

    def _notify_auth_blocked(self) -> None:
        if self._tray_notify is not None:
            self._tray_notify(
                "Le jeton d'accès a été refusé : la synchronisation est suspendue. "
                "Reconnectez-vous dans les paramètres.",
                "HotS Analytics",
            )

    def stop(self, timeout: float = 10.0) -> None:
        self.hotkey_manager.stop()
        # Stop the scheduler first: an in-flight upload can still produce reports (and log
        # records), which must exist before they are persisted / before the handler goes away.
        if self.scheduler is not None:
            self.scheduler.stop()
            self.scheduler = None
        if self._reporter is not None:
            self._reporter.persist_pending()
        if self._log_handler is not None:
            uninstall_logging_handler(self._log_handler)
            self._log_handler = None
        if self._thread is None or self._stop_event is None:
            return
        self._stop_event.set()
        if self._maintenance_thread is not None:
            self._maintenance_thread.join(timeout=timeout)
            self._maintenance_thread = None
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

    # Captured before the first-run setup window (below) creates the config
    # file, so it stays True for the rest of this call -- used later to gate
    # the one-time "found N replays, syncing" tray toast (see
    # `_DaemonRunner.start`'s `announce_initial_scan`) to a genuine first
    # run, not every restart. See tasks/daemon-audit-2026-08-12.md, 2.1.
    first_run = not config_exists()
    if first_run:
        logger.info("No configuration found, opening first-run setup window.")
        if not run_settings_window(is_first_run=True):
            logger.info("Setup was cancelled, exiting.")
            return 1

    try:
        config = load_config()
    except ConfigError as err:
        logger.error("%s", err)
        return 1

    # Seeded here (not just lazily on the first live-draft capture, see
    # draft_capture.py) so the crop tuning actually in use is visible and
    # hand-editable under %APPDATA%/hots-analytics/ from the moment the
    # daemon starts, even before the feature's hotkey is ever pressed.
    draft_layout.ensure_crop_config_file()

    daemon = _DaemonRunner()
    update_status = UpdateStatusTracker()

    def _on_open_settings() -> None:
        if run_settings_window(
            is_first_run=False,
            status_tracker=daemon.status,
            sync_state=daemon.sync_state,
            update_status=update_status,
            draft_capture_status=daemon.draft_capture_status,
            hotkey_manager=daemon.hotkey_manager,
            on_manual_capture=daemon.trigger_draft_capture,
            scheduler=daemon.scheduler,
            dependency_guard=daemon.dependency_guard,
            on_quit=lambda: tray.quit(),
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

    # Shared with TrayController's own "one settings window at a time" lock
    # so the standalone update-progress popup (see `_on_update_found` below)
    # and the settings window never both try to own the process's one Tk
    # mainloop at once.
    window_lock = threading.Lock()

    # Constructed before the update-checker thread starts (but only `.run()`
    # at the very end) so `_on_update_found` below has a tray icon to post
    # its notification to as soon as an update is found, not just once the
    # tray's own message loop gets around to starting. Also, critically,
    # before `daemon.start()`: the daemon needs a tray to notify through
    # from the very first replay it finds (see `set_tray_notify` and
    # tasks/daemon-audit-2026-08-12.md, 2.1), which used to be impossible --
    # the daemon was started before the tray existed at all.
    tray = TrayController(on_open_settings=_on_open_settings, on_quit=_on_quit, window_lock=window_lock)
    daemon.set_tray_notify(tray.notify)
    daemon.set_dependency_update_trigger(lambda: updater.trigger_manual_update(update_status))
    daemon.start(config, announce_initial_scan=first_run)

    if config.draft_feature_enabled:
        # Pays the RapidOCR model-load cost (over a second, see ocr.py) now,
        # in the background, instead of on the player's first real hotkey
        # press of the session -- stacked on top of the screenshot/crop/OCR
        # work `capture_and_submit` already has to do before anything shows
        # up on the dashboard.
        threading.Thread(target=ocr.warm_up, name="hots-ocr-warmup", daemon=True).start()

    def _show_update_progress_popup(version: str) -> None:
        # Non-blocking: if the settings window (or a previous popup) already
        # holds the lock, skip rather than queue up behind it -- matches
        # tray.py's own "already open, ignore" handling of the same lock.
        if not window_lock.acquire(blocking=False):
            logger.debug("A Tk window is already open, skipping the update-progress popup.")
            return
        try:
            from .gui import run_update_progress_window

            run_update_progress_window(update_status, version)
        finally:
            window_lock.release()

    def _on_update_found(update: AvailableUpdate) -> None:
        if is_auto_update_enabled():
            # The download + relaunch happen automatically right after this.
            # The tray balloon is best-effort (silently dropped on
            # platforms/configs where it doesn't work), so it's backed by a
            # small always-on-top popup with live download/install progress
            # -- unless the settings window is already open, in which case
            # its own Update tab already shows the same thing and a second
            # window would just be noise. This is what used to make an
            # automatic update look like "the app closes and says nothing".
            tray.notify(f"Mise à jour v{update.version} trouvée, installation en cours…", "HotS Analytics")
            threading.Thread(
                target=_show_update_progress_popup,
                args=(update.version,),
                name="hots-update-progress-popup",
                daemon=True,
            ).start()
        else:
            # Auto-update is off: nothing happens until the user clicks
            # "Vérifier les mises à jour" in the settings window themselves.
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
