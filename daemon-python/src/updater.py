"""Background self-update: checks GitHub Releases for a daemon build newer
than this one and, if found, downloads and installs it via Velopack.

This used to hand off to a hand-rolled PowerShell script that copied a
downloaded .exe over the running one and relaunched it -- exactly the shape
of thing real-time antivirus is built to kill on sight, regardless of how
legitimate the app actually is. Velopack (an update framework with an
official Python SDK, see `_update_manager`/`_get_update_manager` below)
replaces all of that: `UpdateManager.download_updates` fetches the release
asset, and `UpdateManager.apply_updates_and_restart` performs an atomic,
versioned install-directory swap using Velopack's own bundled `Update.exe`
-- a signed, well-known updater binary instead of an ad-hoc unsigned script,
which is what actually gets flagged by endpoint protection.

This build is still not code-signed (no certificate has been purchased for
it), so Windows SmartScreen shows its "Windows protected your PC" warning
the first time a browser-downloaded copy is run -- that's a one-time,
per-download-hash prompt from Explorer's own Attachment Execution Service,
unrelated to the update mechanism itself.

`update.log` (see `update_log_file_path`) still records what happened during
each check/download/install attempt -- there's no longer a separate
out-of-process script that could fail silently after this process exits, but
keeping a log is still useful for diagnosing a failed automatic update after
the fact (e.g. via the settings window's "Voir le journal" button).
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import subprocess
import sys
import tempfile
import threading
from dataclasses import dataclass, replace
from enum import Enum
from pathlib import Path
from typing import Callable

import requests
import velopack

logger = logging.getLogger(__name__)

_GITHUB_REPO = "aifedespaix/hots-stats"
# Human-facing counterpart of the update source below -- GitHub redirects
# this to whatever tag is actually current, so it never goes stale the way
# pinning a version number would. Opened in the player's browser by the
# "Mise à jour manuelle" button (see gui.py) and by `manual_fallback_message`
# as a fallback with a completely different failure surface than the
# automatic install: it's just a normal browser download + double-click, the
# same trusted everyday flow as any other .exe from the web.
_RELEASE_PAGE_URL = f"https://github.com/{_GITHUB_REPO}/releases/latest"
_GITHUB_REPO_URL = f"https://github.com/{_GITHUB_REPO}"

_STARTUP_DELAY_SECONDS = 30  # let the daemon finish its first sync pass before checking
_CHECK_INTERVAL_SECONDS = 6 * 60 * 60  # 6h

# Nuitka injects `__compiled__` into every compiled module's globals; unlike
# PyInstaller, it does not set `sys.frozen`, so this is the reliable way to
# tell "running as the built .exe" apart from "running from source". Only
# the frozen build has a real Velopack-managed installation worth checking.
IS_FROZEN = "__compiled__" in globals()

# Where updates come from -- constructing a `GithubSource` itself is cheap
# and side-effect-free (no network call, no install-layout lookup), so it's
# safe to do at module import time.
_update_source = velopack.GithubSource(_GITHUB_REPO_URL, None, False)

# The `UpdateManager` itself is deliberately *not* constructed eagerly here,
# even though it's conceptually the same kind of shared, constructed-once
# module state as `_update_source` above. `velopack.UpdateManager(...)`
# raises immediately (`RuntimeError: ... Could not auto-locate app
# manifest`) unless it's running from inside a real Velopack-managed install
# directory -- confirmed empirically against the installed `velopack` 1.2.0
# package in this repo's venv. That's true of every unfrozen run (`pytest`,
# `python -m src.main` in dev) and would break *importing this module at
# all* -- which every test, and `app.py`/`gui.py` at startup, does
# unconditionally. See `_get_update_manager` for the lazy singleton that
# avoids this while still sharing one instance across every real caller.
_update_manager: velopack.UpdateManager | None = None


def _get_update_manager() -> velopack.UpdateManager:
    """Lazily constructs (once) and returns the module-shared
    `UpdateManager`. Only ever actually called from code paths already
    gated on `IS_FROZEN` -- `watch_for_updates` returns immediately if not
    `IS_FROZEN`, and the Update tab that wires up `trigger_manual_update` is
    only built by gui.py's `_build_ui` when `IS_FROZEN` -- so by the time
    this runs, the process is expected to be a real Velopack-installed
    build, where `UpdateManager`'s install-layout auto-detection succeeds.
    """
    global _update_manager
    if _update_manager is None:
        _update_manager = velopack.UpdateManager(_update_source)
    return _update_manager


# Must match the `--packId`/`--mainExe` values `vpk pack` is invoked with in
# .github/workflows/build-daemon.yml -- these three names (this pair, plus
# the CI workflow's own two flags) are the one place Velopack's identity for
# this app is decided; keep them in sync if either ever changes.
_PACK_ID = "hots-analytics-daemon"
_EXE_NAME = "hots-analytics-daemon.exe"

# -- One-time pre-Velopack -> Velopack migration shim -------------------------
#
# TEMPORARY, ship-in-exactly-one-release code. See
# docs/superpowers/plans/2026-08-31-daemon-velopack-auto-update.md, Task 6,
# for the full rationale. Once telemetry/support signals confirm the
# pre-Velopack install base has migrated, delete
# `is_running_from_legacy_install`, `migrate_to_velopack_install`, their
# helpers and constants below, and the `main()` call site that invokes them
# -- a permanent per-startup check for a one-time historical event is
# unnecessary complexity once it's done its job.
#
# The GitHub Releases API (not `_update_manager`/Velopack's `GithubSource`)
# is used here on purpose: `UpdateManager` only knows how to download "the
# update package" for the install it's managing, not an arbitrary named
# asset -- and a legacy install has no Velopack-managed install for it to
# even construct against (see `_get_update_manager`'s docstring). This
# reimplements just enough of the pre-Task-2 `download_update`'s plain
# `requests`-based GitHub-asset-download approach (removed by Task 2 from the
# main update flow, kept here only for this one-time path) to fetch the
# installer instead.
_LATEST_RELEASE_API_URL = f"https://api.github.com/repos/{_GITHUB_REPO}/releases/latest"
# Velopack's own naming for the installer `vpk pack`/`vpk upload github`
# publish alongside the update packages -- see build-daemon.yml and
# docs/superpowers/specs/2026-08-31-daemon-velopack-auto-update-design.md's
# "Migration" section. Must stay `{_PACK_ID}-Setup.exe` to match what `vpk`
# actually produces.
_SETUP_ASSET_NAME = f"{_PACK_ID}-Setup.exe"
_MIGRATION_REQUEST_TIMEOUT_SECONDS = 15
_MIGRATION_DOWNLOAD_TIMEOUT_SECONDS = 60

# Name of the sentinel file (in the same folder as config.json -- see
# config.py's `config_file_path`) marking that this one-time migration has
# already run, so it's never repeated even if a legacy install somehow gets
# launched again after migrating.
#
# Deliberately a standalone file rather than a key inside config.json:
# `config.py`'s `save_config` writes a *fixed literal payload* (it doesn't
# merge unknown keys back in), so any flag stored in config.json would be
# silently erased the first time the user hits Save in the settings window --
# which, post-migration, is a completely normal thing to do. That would make
# the migration re-trigger on every subsequent legacy-exe launch. A separate
# file has no other writer, and deleting it is all that's needed when this
# whole shim is removed.
_MIGRATION_DONE_SENTINEL_NAME = ".velopack-migrated"


def installed_exe_path() -> Path:
    """The stable path Windows autostart (and anything else that needs "the
    exe to launch, that will still be there next boot") should point at --
    NOT `sys.executable` (which under Nuitka's --onefile packaging resolves
    to an ephemeral per-run extraction folder that's deleted at exit) and
    NOT the versioned copy inside Velopack's `current\\` directory (which
    gets replaced wholesale on every update -- a shortcut pointing directly
    at it could end up pointing at a deleted file mid-update).

    Velopack installs to `%LocalAppData%\\{packId}\\` and places a small,
    version-independent "stub" executable at the root of that folder (next
    to `current\\` and `Update.exe`) whose only job is to launch whatever is
    currently inside `current\\` -- see
    docs/superpowers/specs/2026-08-31-daemon-velopack-auto-update-design.md.
    That stub is what stays stable across updates, so it's what this
    function returns.
    """
    local_app_data = os.environ.get("LOCALAPPDATA")
    base = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
    return base / _PACK_ID / _EXE_NAME


def _running_exe_path() -> Path:
    """Where THIS process's executable actually lives right now -- as opposed
    to `installed_exe_path()`, which returns the stable stub path the app
    *should* be installed at, whether or not it's there yet.

    Under Nuitka's --onefile packaging `sys.executable` points at the
    ephemeral per-run extraction folder, so `NUITKA_ONEFILE_BINARY` (which
    Nuitka sets to the real launched .exe) takes priority when present."""
    onefile_binary = os.environ.get("NUITKA_ONEFILE_BINARY")
    return Path(onefile_binary or sys.executable).resolve()


def is_running_from_legacy_install() -> bool:
    """True only for the one-time migration case: a frozen build running
    from somewhere other than the Velopack-managed install directory (i.e.
    the old raw-exe install model, from before this migration). Never true
    for a fresh Velopack install, and never true for local dev.

    Compares the *actually running* exe (`_running_exe_path`) against the
    Velopack install directory -- not `installed_exe_path()` against a
    recomputation of its own definition, which would be tautologically
    equal and so could never detect anything."""
    if not IS_FROZEN:
        return False
    try:
        velopack_dir = installed_exe_path().parent.resolve()
    except OSError:
        # Can't tell where the Velopack install would be -> don't claim this
        # is a legacy install; the migration retries on the next launch.
        return False
    # `parents` (not a `==` on the immediate parent) because a Velopack
    # install runs the app from `<dir>\current\`, not from `<dir>` itself --
    # only the stub sits at the root.
    return velopack_dir not in _running_exe_path().parents


def _migration_done_sentinel_path() -> Path:
    """`%APPDATA%\\hots-analytics\\.velopack-migrated` -- next to config.json.
    See `_MIGRATION_DONE_SENTINEL_NAME` for why this isn't a config key."""
    from .config import config_file_path

    return config_file_path().parent / _MIGRATION_DONE_SENTINEL_NAME


def _is_migration_marked_done() -> bool:
    """Whether the sentinel file exists. Defensive (defaults to "not done
    yet" on any failure) since this must never itself be the reason the
    migration doesn't retry on the next launch."""
    try:
        return _migration_done_sentinel_path().is_file()
    except OSError:
        return False


def _mark_migration_done() -> None:
    """Creates the sentinel file (see `_MIGRATION_DONE_SENTINEL_NAME`),
    creating `%APPDATA%\\hots-analytics\\` if it doesn't exist yet. Its
    contents are purely informational -- only its existence is read."""
    path = _migration_done_sentinel_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    timestamp = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    path.write_text(
        f"Migrated to the Velopack-managed install at {timestamp}.\n", encoding="utf-8"
    )


def migrate_to_velopack_install() -> None:
    """Downloads the current release's Setup.exe and runs it silently, then
    marks the migration done (see `_MIGRATION_DONE_SENTINEL_NAME`) so this never
    repeats even if somehow launched again from the old location. Called
    once, early in `main()`, only for the one transitional release this
    function ships in -- see
    docs/superpowers/specs/2026-08-31-daemon-velopack-auto-update-design.md's
    "Migration" section, and the TEMPORARY-code comment above this section.
    Best-effort: any failure here just leaves the user on their current
    (working) install, to be retried on this release's next launch rather
    than left in a broken state.
    """
    if _is_migration_marked_done():
        logger.debug("Velopack migration already completed, nothing to do.")
        return

    logger.info("Legacy (pre-Velopack) install detected -- starting one-time migration.")
    try:
        response = requests.get(_LATEST_RELEASE_API_URL, timeout=_MIGRATION_REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        release = response.json()
    except (requests.RequestException, ValueError) as err:
        logger.warning("Migration: could not fetch the latest release, will retry next launch: %s", err)
        _append_update_log_line("?", f"Migration: release lookup failed: {err}")
        return

    version = str(release.get("tag_name", "")).lstrip("v") or "?"

    setup_asset_url: str | None = None
    for asset in release.get("assets", []):
        if asset.get("name") == _SETUP_ASSET_NAME:
            setup_asset_url = asset.get("browser_download_url")
            break

    if setup_asset_url is None:
        logger.warning(
            "Migration: release %s has no '%s' asset (yet), will retry next launch.",
            release.get("tag_name"),
            _SETUP_ASSET_NAME,
        )
        _append_update_log_line(
            version, f"Migration: no '{_SETUP_ASSET_NAME}' asset on the latest release yet."
        )
        return

    try:
        dest_dir = Path(tempfile.mkdtemp(prefix="hots-analytics-migration-"))
        setup_exe_path = dest_dir / _SETUP_ASSET_NAME
        logger.info("Migration: downloading %s from %s...", _SETUP_ASSET_NAME, setup_asset_url)
        with requests.get(
            setup_asset_url, stream=True, timeout=_MIGRATION_DOWNLOAD_TIMEOUT_SECONDS
        ) as dl_response:
            dl_response.raise_for_status()
            with open(setup_exe_path, "wb") as f:
                for chunk in dl_response.iter_content(chunk_size=1024 * 1024):
                    f.write(chunk)
    except (requests.RequestException, OSError) as err:
        logger.warning("Migration: failed to download %s, will retry next launch: %s", _SETUP_ASSET_NAME, err)
        _append_update_log_line(version, f"Migration: download failed: {err}")
        return

    logger.info("Migration: downloaded %s to %s, launching it silently...", _SETUP_ASSET_NAME, setup_exe_path)
    _append_update_log_line(version, f"Migration: downloaded {_SETUP_ASSET_NAME}, launching --silent install.")
    try:
        subprocess.Popen([str(setup_exe_path), "--silent"], close_fds=True)
    except OSError as err:
        logger.warning("Migration: failed to launch %s, will retry next launch: %s", _SETUP_ASSET_NAME, err)
        _append_update_log_line(version, f"Migration: launch failed: {err}")
        return

    # Hand the Windows autostart registration over to the new install before
    # marking the migration done. The `HKCU\...\Run` value still points at
    # *this* (legacy, arbitrarily-located) .exe, which Setup.exe does not
    # touch and does not delete -- so without this, the next boot launches
    # the old exe, which sees the migration already marked done and exits
    # without starting anything: autostart silently stops working for every
    # migrated user who had it enabled. `set_enabled(True)` rewrites the
    # value to `installed_exe_path()`, i.e. the Velopack stub. Setup.exe runs
    # asynchronously so that stub may not exist on disk yet at this instant;
    # that's fine, the Run value is only ever read at the next boot.
    try:
        from .autostart import is_enabled, set_enabled

        if is_enabled():
            set_enabled(True)
            logger.info("Migration: Windows autostart re-pointed at %s.", installed_exe_path())
            _append_update_log_line(version, "Migration: autostart re-pointed at the Velopack stub.")
    except OSError as err:
        # Best-effort, exactly like every other step here: a failed registry
        # write must not abort a migration whose install is already underway.
        logger.warning("Migration: could not hand over the autostart registration: %s", err)
        _append_update_log_line(version, f"Migration: autostart hand-over failed: {err}")

    try:
        _mark_migration_done()
    except OSError as err:
        logger.warning(
            "Migration: Setup.exe launched but failed to mark migration complete, will retry next launch: %s",
            err,
        )
        _append_update_log_line(version, f"Migration: Setup.exe launched but marking complete failed: {err}")
        return

    logger.info("Migration: Setup.exe launched and the migration was marked complete.")
    _append_update_log_line(version, "Migration: Setup.exe launched, marked complete.")


def manual_fallback_message(version: str) -> str:
    """Actionable instructions shown (see gui.py) when an update could not
    be applied automatically. Points at the installer on the GitHub Release
    page rather than a locally-staged file -- Velopack's UpdateManager owns
    the download/apply staging directory, so unlike the old PowerShell-based
    mechanism, there is no separate "already-downloaded build" this daemon
    can point the user at directly."""
    return (
        f"La mise à jour vers la version {version} n'a pas pu être installée automatiquement. "
        f"Téléchargez et lancez l'installeur depuis {release_page_url()} pour l'installer manuellement."
    )


def release_page_url() -> str:
    """The GitHub "latest release" page -- see `_RELEASE_PAGE_URL`."""
    return _RELEASE_PAGE_URL


def update_log_file_path() -> Path:
    """`%APPDATA%\\hots-analytics\\update.log` -- next to `config.json`.
    `_append_update_log_line` appends one line per notable check/download/
    install event to this file, so it's a record of what happened even if
    the settings window wasn't open (or the app itself) to see it live."""
    from .config import config_file_path

    return config_file_path().parent / "update.log"


def read_last_update_log_lines(max_lines: int = 10) -> list[str]:
    """The last `max_lines` of `update.log`, most recent last -- for showing
    "what happened during the last update attempt" in the settings window.
    Returns `[]` if the file doesn't exist yet (no update has ever run) or
    can't be read."""
    path = update_log_file_path()
    if not path.is_file():
        return []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    return [line for line in lines if line.strip()][-max_lines:]


def _append_update_log_line(version: str, message: str) -> None:
    """Best-effort, timestamped append to `update.log`. Called from the
    check/download/install flow below on the events worth a permanent
    record (an update found, a download failure, an install failure) --
    never raises, since a locked/unwritable log must never interrupt an
    actual update attempt."""
    try:
        log_path = update_log_file_path()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        timestamp = dt.datetime.now().astimezone().isoformat(timespec="seconds")
        with log_path.open("a", encoding="utf-8") as f:
            f.write(f"{timestamp} [v{version}] {message}\n")
    except OSError:
        logger.debug("Could not write to the update log", exc_info=True)


@dataclass(frozen=True)
class AvailableUpdate:
    version: str
    # The Velopack `UpdateInfo` this was derived from -- passed straight
    # back into `UpdateManager.download_updates`/`apply_updates_and_restart`
    # by `perform_update`. Velopack owns everything about what to fetch and
    # from where; this daemon only needs `version` for display and
    # notify-once-per-version bookkeeping (see `watch_for_updates`).
    velopack_info: velopack.UpdateInfo


class UpdatePhase(str, Enum):
    IDLE = "idle"
    CHECKING = "checking"
    AVAILABLE = "available"
    DOWNLOADING = "downloading"
    INSTALLING = "installing"
    ERROR = "error"


@dataclass(frozen=True)
class UpdateStatus:
    phase: UpdatePhase = UpdatePhase.IDLE
    version: str | None = None
    progress: float | None = None  # 0..1 while phase is DOWNLOADING
    message: str | None = None  # extra context: an error, or "up to date"
    # Historically set alongside `message` when a downloaded-but-
    # uninstallable build had been staged next to the installed .exe for the
    # player to finish by hand. Velopack now owns the download/apply staging
    # directory itself, so there's no longer a separate locally-staged build
    # this daemon could point at -- this field is always `None` today, but
    # is kept (rather than removed) since gui.py (not modified by this
    # change) still reads it defensively. See `UpdateStatusTracker.set` for
    # why it's reset by default on every status update.
    manual_fallback_path: Path | None = None


class UpdateStatusTracker:
    """Thread-safe last-known-state of the updater, polled by the settings
    window (see gui.py's `_refresh_update_status`) so "download in
    progress" / "installing" / a failure are visible instead of the update
    happening invisibly in the background."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._status = UpdateStatus()

    def snapshot(self) -> UpdateStatus:
        with self._lock:
            return self._status

    def set(self, **kwargs: object) -> None:
        with self._lock:
            # `manual_fallback_path` only ever makes sense alongside the
            # exact failure it was staged for -- reset it here by default so
            # it can't silently survive (via `replace`'s "keep whatever the
            # field already was" behavior) into a later, unrelated status
            # such as the next background check or download that never
            # meant to carry it forward. No current caller ever passes it
            # explicitly (see `UpdateStatus.manual_fallback_path`'s
            # docstring), so in practice this always resets it to `None`.
            kwargs.setdefault("manual_fallback_path", None)
            self._status = replace(self._status, **kwargs)

    def try_begin(self, version: str) -> bool:
        """Atomically claims the "downloading/installing" state, unless
        another download is already in flight. Guards against the
        background auto-check and the settings window's manual "Update now"
        button racing into two overlapping downloads."""
        with self._lock:
            if self._status.phase in (UpdatePhase.DOWNLOADING, UpdatePhase.INSTALLING):
                return False
            self._status = UpdateStatus(
                phase=UpdatePhase.DOWNLOADING, version=version, progress=0.0
            )
            return True


def _check_for_update() -> AvailableUpdate | None:
    """Best-effort check via Velopack's `UpdateManager` (backed by
    `_update_source`, a `GithubSource` pointed at this repo's releases).
    Returns `None` on any failure (offline, rate-limited, no release
    published yet) or when already on the latest version -- an update check
    must never interrupt the daemon's actual job of syncing replays.
    Velopack's own manifest-based comparison replaces the old hand-rolled
    `parse_version`/`find_update` version-comparison logic."""
    try:
        update_info = _get_update_manager().check_for_updates()
    except Exception as err:
        logger.info("Update check failed (non-fatal): %s", err)
        return None
    if update_info is None:
        return None
    return AvailableUpdate(
        version=update_info.TargetFullRelease.Version.lstrip("v"),
        velopack_info=update_info,
    )


def perform_update(update: AvailableUpdate, status: UpdateStatusTracker) -> bool:
    """Downloads and applies `update` via Velopack's `UpdateManager`,
    reporting progress on `status` throughout. Returns False without doing
    anything if another update is already in flight (see
    `UpdateStatusTracker.try_begin`); returns True once an attempt has been
    made (which, on success, is essentially never observed --
    `apply_updates_and_restart` replaces the running process instead of
    returning).
    """
    if not status.try_begin(update.version):
        logger.info("Update already in progress, ignoring redundant trigger.")
        return False

    manager = _get_update_manager()

    def _on_download_progress(percent: int) -> None:
        # Velopack reports 0..100 (an int); `UpdateStatus.progress` is
        # documented (and relied on by gui.py's progress bar) as 0..1.
        status.set(progress=percent / 100)

    try:
        manager.download_updates(update.velopack_info, progress_callback=_on_download_progress)
    except Exception as err:
        # An update check/download must never interrupt the daemon's actual
        # job of syncing replays -- log and degrade to "retry next cycle"
        # rather than let this propagate out of the calling thread
        # (`watch_for_updates`'s loop, or a one-shot manual check) and stop
        # it from ever checking again for the rest of this run.
        logger.warning("Update download failed, will retry next cycle: %s", err)
        _append_update_log_line(update.version, f"Download failed: {err}")
        status.set(
            phase=UpdatePhase.ERROR,
            message=f"Le téléchargement de la mise à jour a échoué : {err}",
        )
        return True

    status.set(phase=UpdatePhase.INSTALLING, progress=None)
    try:
        manager.apply_updates_and_restart(update.velopack_info)
        return True  # unreachable in practice -- the process restarts itself on success
    except Exception as err:
        logger.warning("Update install failed: %s", err)
        _append_update_log_line(update.version, f"Install failed: {err}")
        status.set(phase=UpdatePhase.ERROR, message=manual_fallback_message(update.version))
        return True


def trigger_manual_update(status: UpdateStatusTracker) -> None:
    """Runs one check-and-apply cycle right now, on a background thread --
    what the settings window's "Mettre à jour maintenant" button calls.
    Safe to call even while the background `watch_for_updates` loop is
    mid-cycle: `perform_update`'s `try_begin` guard means only one of them
    actually downloads."""

    def _run() -> None:
        status.set(phase=UpdatePhase.CHECKING, message=None)
        update = _check_for_update()
        if update is None:
            status.set(
                phase=UpdatePhase.IDLE,
                version=None,
                progress=None,
                message="Aucune mise à jour disponible.",
            )
            return
        perform_update(update, status)

    threading.Thread(target=_run, name="hots-manual-update", daemon=True).start()


def watch_for_updates(
    stop_event: threading.Event,
    status: UpdateStatusTracker,
    *,
    auto_update_enabled: Callable[[], bool] = lambda: True,
    on_update_found: Callable[[AvailableUpdate], None] | None = None,
) -> None:
    """Runs for the app's lifetime on a background thread: checks for a
    newer release shortly after startup, then every few hours, and --
    unless `auto_update_enabled()` says otherwise -- applies it (see
    `perform_update`) as soon as one is found. No-ops when not running as
    the compiled .exe (e.g. `python -m src.main` in dev), since there's no
    installed binary to replace.

    `auto_update_enabled` is re-checked on every cycle (not read once at
    startup) so toggling the settings-window checkbox takes effect on the
    next check without restarting the daemon. When it returns False, a
    found update is still reported (status + `on_update_found`, once per
    version) but left for the "Mettre à jour maintenant" button
    (`trigger_manual_update`) to actually install.

    `on_update_found`, when given, is called once per newly-found version,
    before it's downloaded -- app.py wires this to a tray balloon
    notification so the update doesn't happen invisibly. Best-effort: an
    exception from it is logged and never stops the update from proceeding.
    """
    if not IS_FROZEN:
        return
    if stop_event.wait(_STARTUP_DELAY_SECONDS):
        return

    notified_version: str | None = None
    while not stop_event.is_set():
        status.set(phase=UpdatePhase.CHECKING, message=None)
        update = _check_for_update()
        if update is None:
            status.set(
                phase=UpdatePhase.IDLE, version=None, progress=None, message=None
            )
        else:
            status.set(
                phase=UpdatePhase.AVAILABLE,
                version=update.version,
                progress=None,
                message=None,
            )
            if update.version != notified_version:
                notified_version = update.version
                _append_update_log_line(update.version, "Update found.")
                if on_update_found is not None:
                    try:
                        on_update_found(update)
                    except Exception:
                        logger.warning(
                            "Update-found notification callback failed", exc_info=True
                        )
            if auto_update_enabled():
                logger.info("Update v%s available, downloading...", update.version)
                perform_update(update, status)  # never returns on success
        if stop_event.wait(_CHECK_INTERVAL_SECONDS):
            return
