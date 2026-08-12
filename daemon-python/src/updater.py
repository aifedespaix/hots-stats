"""Background self-update: checks GitHub Releases for a daemon build newer
than this one and, if found, downloads it and relaunches in its place.

A running Windows .exe can't reliably overwrite or rename itself (and a
Nuitka --onefile build in particular may be executing from a self-extracted
copy rather than the original path), so the swap can't happen in this
process. Instead, `apply_update_and_exit` writes a tiny PowerShell script
that waits for this process to exit, copies the downloaded build over the
current .exe, relaunches it, and deletes itself -- then this process exits
immediately, releasing the file lock the script is waiting on. This is the
same handoff technique most self-updating single-.exe Windows apps use.
"""

from __future__ import annotations

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

from .constants import APP_VERSION

logger = logging.getLogger(__name__)

_GITHUB_REPO = "aifedespaix/hots-stats"
_LATEST_RELEASE_URL = f"https://api.github.com/repos/{_GITHUB_REPO}/releases/latest"
_ASSET_PREFIX = "hots-analytics-daemon-v"
_REQUEST_TIMEOUT_SECONDS = 15
_DOWNLOAD_TIMEOUT_SECONDS = 60

_STARTUP_DELAY_SECONDS = 30  # let the daemon finish its first sync pass before checking
_CHECK_INTERVAL_SECONDS = 6 * 60 * 60  # 6h

# Nuitka injects `__compiled__` into every compiled module's globals; unlike
# PyInstaller, it does not set `sys.frozen`, so this is the reliable way to
# tell "running as the built .exe" apart from "running from source". Only
# the frozen build has a real .exe on disk worth replacing.
IS_FROZEN = "__compiled__" in globals()


def installed_exe_path() -> Path:
    """The path of the .exe the user actually launched (double-clicked, or
    the autostart registry entry) -- as opposed to `sys.executable`, which
    under Nuitka's --onefile packaging resolves to the ephemeral per-run
    extraction folder that gets deleted once the process exits. Copying an
    update "over" that path, or registering it for Windows autostart, would
    silently target a file that's gone by the time anything looks for it
    again -- which is why both `apply_update_and_exit` and `autostart.py`
    go through this helper instead of `sys.executable` directly.

    Nuitka sets `NUITKA_ONEFILE_BINARY` in the unpacked child process's
    environment to the original onefile binary's path for exactly this
    self-updating use case; fall back to `sys.executable` when it's unset
    (e.g. a non-onefile build, or not running under Nuitka at all).
    """
    onefile_binary = os.environ.get("NUITKA_ONEFILE_BINARY")
    if onefile_binary:
        return Path(onefile_binary).resolve()
    return Path(sys.executable).resolve()


@dataclass(frozen=True)
class AvailableUpdate:
    version: str
    download_url: str
    asset_name: str


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
            self._status = replace(self._status, **kwargs)

    def try_begin(self, version: str) -> bool:
        """Atomically claims the "downloading/installing" state, unless
        another download is already in flight. Guards against the
        background auto-check and the settings window's manual "Update now"
        button racing into two overlapping downloads."""
        with self._lock:
            if self._status.phase in (UpdatePhase.DOWNLOADING, UpdatePhase.INSTALLING):
                return False
            self._status = UpdateStatus(phase=UpdatePhase.DOWNLOADING, version=version, progress=0.0)
            return True


def parse_version(version: str) -> tuple[int, ...] | None:
    """"v1.2.3" / "1.2.3" -> (1, 2, 3). None for anything that isn't a plain
    dotted-numeric version, e.g. the "0.0.0-dev.<sha>" builds produced by
    manual/non-tag runs -- those are never treated as an update candidate,
    in either direction."""
    parts = version.strip().lstrip("v").split(".")
    if not parts:
        return None
    try:
        return tuple(int(part) for part in parts)
    except ValueError:
        return None


def find_update(release: dict, current_version: str) -> AvailableUpdate | None:
    """Pure decision logic, split out from `check_for_update` for testing:
    given a GitHub "latest release" API response and the running version,
    is there a newer daemon build to install?"""
    latest = parse_version(release.get("tag_name", ""))
    current = parse_version(current_version)
    if latest is None or current is None or latest <= current:
        return None

    for asset in release.get("assets", []):
        name = asset.get("name", "")
        if name.startswith(_ASSET_PREFIX) and name.endswith(".exe"):
            return AvailableUpdate(
                version=release["tag_name"].lstrip("v"),
                download_url=asset["browser_download_url"],
                asset_name=name,
            )

    logger.warning("Release %s has no daemon .exe asset, skipping.", release.get("tag_name"))
    return None


def check_for_update(current_version: str = APP_VERSION) -> AvailableUpdate | None:
    """Best-effort check against GitHub's "latest release" API. Returns None
    on any failure (offline, rate-limited, no release published yet, no
    matching asset) -- an update check must never interrupt the daemon's
    actual job of syncing replays."""
    try:
        response = requests.get(_LATEST_RELEASE_URL, timeout=_REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        return find_update(response.json(), current_version)
    except (requests.RequestException, ValueError, KeyError) as err:
        logger.info("Update check failed (non-fatal): %s", err)
        return None


def download_update(
    update: AvailableUpdate, dest_dir: Path, on_progress: Callable[[float | None], None] | None = None
) -> Path:
    """Streams the release asset to `dest_dir / update.asset_name`, calling
    `on_progress` with a 0..1 fraction after each chunk (or `None` if the
    server didn't report a Content-Length to compute one against)."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / update.asset_name
    with requests.get(update.download_url, stream=True, timeout=_DOWNLOAD_TIMEOUT_SECONDS) as response:
        response.raise_for_status()
        total = response.headers.get("Content-Length")
        total_bytes = int(total) if total is not None and total.isdigit() else None
        written = 0
        with open(dest, "wb") as f:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                f.write(chunk)
                written += len(chunk)
                if on_progress is not None:
                    on_progress((written / total_bytes) if total_bytes else None)
    return dest


_RELAUNCH_SCRIPT = """\
Wait-Process -Id {pid} -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Copy-Item -LiteralPath "{new_exe}" -Destination "{current_exe}" -Force
Remove-Item -LiteralPath "{new_exe}" -Force -ErrorAction SilentlyContinue
Start-Process -FilePath "{current_exe}"
Remove-Item -LiteralPath "{script_path}" -Force -ErrorAction SilentlyContinue
"""


def apply_update_and_exit(new_exe: Path) -> None:
    """Hands off to a detached PowerShell script that waits for this process
    (by pid) to exit, replaces the *actually installed* .exe (see
    `installed_exe_path`) with `new_exe`, relaunches it, and cleans up after
    itself -- then exits this process immediately so the script's wait
    resolves. Never returns."""
    current_exe = installed_exe_path()
    fd, script_path_str = tempfile.mkstemp(suffix=".ps1", prefix="hots-analytics-update-")
    script_path = Path(script_path_str)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(
            _RELAUNCH_SCRIPT.format(
                pid=os.getpid(),
                new_exe=new_exe,
                current_exe=current_exe,
                script_path=script_path,
            )
        )

    subprocess.Popen(
        [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-File",
            str(script_path),
        ],
        creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
        close_fds=True,
    )
    logger.info("Handed off to the relaunch script, exiting to update to v%s.", new_exe.name)
    os._exit(0)


def perform_update(update: AvailableUpdate, status: UpdateStatusTracker) -> bool:
    """Downloads and applies `update`, reporting progress on `status`
    throughout. Returns False without doing anything if another update is
    already in flight (see `UpdateStatusTracker.try_begin`); returns True
    once an attempt has been made (which, on success, is essentially never
    observed -- the process replaces itself via `apply_update_and_exit`).
    """
    if not status.try_begin(update.version):
        logger.info("Update already in progress, ignoring redundant trigger.")
        return False

    try:
        new_exe = download_update(
            update,
            Path(tempfile.gettempdir()) / "hots-analytics-updates",
            on_progress=lambda frac: status.set(progress=frac),
        )
    except requests.RequestException as err:
        logger.warning("Update download failed, will retry next cycle: %s", err)
        status.set(phase=UpdatePhase.ERROR, message=str(err))
        return True

    status.set(phase=UpdatePhase.INSTALLING, progress=None)
    apply_update_and_exit(new_exe)  # never returns
    return True


def trigger_manual_update(status: UpdateStatusTracker) -> None:
    """Runs one check-and-apply cycle right now, on a background thread --
    what the settings window's "Mettre à jour maintenant" button calls.
    Safe to call even while the background `watch_for_updates` loop is
    mid-cycle: `perform_update`'s `try_begin` guard means only one of them
    actually downloads."""

    def _run() -> None:
        status.set(phase=UpdatePhase.CHECKING, message=None)
        update = check_for_update()
        if update is None:
            status.set(phase=UpdatePhase.IDLE, version=None, progress=None, message="Aucune mise à jour disponible.")
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
    `apply_update_and_exit`) as soon as one is found. No-ops when not
    running as the compiled .exe (e.g. `python -m src.main` in dev), since
    there's no installed binary to replace.

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
        update = check_for_update()
        if update is None:
            status.set(phase=UpdatePhase.IDLE, version=None, progress=None, message=None)
        else:
            status.set(phase=UpdatePhase.AVAILABLE, version=update.version, progress=None, message=None)
            if update.version != notified_version:
                notified_version = update.version
                if on_update_found is not None:
                    try:
                        on_update_found(update)
                    except Exception:
                        logger.warning("Update-found notification callback failed", exc_info=True)
            if auto_update_enabled():
                logger.info("Update v%s available, downloading...", update.version)
                perform_update(update, status)  # never returns on success
        if stop_event.wait(_CHECK_INTERVAL_SECONDS):
            return
