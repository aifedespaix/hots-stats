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

Exiting is only safe once the handoff has actually taken -- `Popen`
succeeding just means Windows *accepted* the request to spawn the script,
not that it's still running a moment later. `apply_update_and_exit` briefly
confirms the script is still alive before committing to `os._exit`; if it
isn't (or `powershell.exe` couldn't even be launched), the update is
aborted and this process keeps running the current version instead of
exiting into what would otherwise be nothing. This matters in practice, not
just in theory: the script this hands off to is, unavoidably, an unsigned,
hidden, execution-policy-bypassing process that copies one unsigned .exe
over another and relaunches it -- exactly the shape of thing real-time
antivirus is built to kill on sight, regardless of how legitimate the app
actually is.

This build is not code-signed (no certificate has been purchased for it),
so Windows SmartScreen shows its "Windows protected your PC" warning the
first time a browser-downloaded copy is run -- that's a one-time,
per-download-hash prompt from Explorer's own Attachment Execution Service.
The update .exe itself is fetched with `requests`, so it never picks up a
Mark-of-the-Web -- but `Start-Process` with a bare `-FilePath` still goes
through the same ShellExecute path Explorer uses, so if the *installed*
.exe already carries a Mark-of-the-Web (very likely: it's usually sitting
wherever the user's browser first downloaded it), that same SmartScreen
prompt could reappear on every self-relaunch and block it silently since
nobody is there to click "Run anyway". The relaunch script strips it
(`Unblock-File`) right after copying the new build into place, so this
doesn't depend on the installed .exe's location or download history.

Every relaunch attempt is logged to `update.log` next to `config.json` (see
`update_log_file_path`) -- the PowerShell handoff runs after this process
has already exited, so that log is the only record of what happened if a
copy/relaunch step fails and the app doesn't come back. Both the copy and
the relaunch are retried a few times (a just-exited process, or real-time
antivirus scanning an unfamiliar unsigned .exe, can each hold a brief file
lock), and if copying the new build over the installed .exe still fails
after every retry, the script falls back to relaunching the previous
version (left untouched on disk) instead of leaving the app closed --
otherwise a single failed update permanently "bricks" the daemon until the
user notices and manually reruns an old installer from wherever they kept
it.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import subprocess
import sys
import tempfile
import threading
import time
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

_DOWNLOADS_DIR_NAME = "hots-analytics-updates"

# Only exist on Windows. `apply_update_and_exit` only does anything
# meaningful against a real Windows-installed .exe, but resolving these
# eagerly with `getattr` (instead of a bare `subprocess.DETACHED_PROCESS`
# at the call site) keeps the module importable -- and the rest of that
# function's logic unit-testable with `subprocess.Popen` itself mocked --
# on the non-Windows platforms this test suite and `python -m src.main` in
# dev actually run on.
_DETACHED_PROCESS = getattr(subprocess, "DETACHED_PROCESS", 0)
_CREATE_NEW_PROCESS_GROUP = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)

# How long `apply_update_and_exit` waits, after handing off to the relaunch
# script, to confirm that script is still alive before actually exiting --
# see that function's docstring for why this matters (real-time antivirus /
# SmartScreen killing an unsigned, freshly-spawned "copy an exe over another
# exe and relaunch it" script is a real failure mode, not a hypothetical
# one). Long enough to not false-positive on a merely slow process start,
# short enough that a normal successful update barely notices the delay.
_RELAUNCH_LIVENESS_CHECK_SECONDS = 1.5

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


def downloads_dir() -> Path:
    """Where a downloaded update build is staged before being handed off to
    the relaunch script -- `%TEMP%\\hots-analytics-updates\\`. Temp, not
    appdata: this only ever holds a build that's either about to replace the
    installed .exe (and gets deleted by the relaunch script once it does) or
    was abandoned mid-download, neither of which is worth surviving a
    reboot."""
    return Path(tempfile.gettempdir()) / _DOWNLOADS_DIR_NAME


def update_log_file_path() -> Path:
    """`%APPDATA%\\hots-analytics\\update.log` -- next to `config.json`. The
    relaunch script (see `_render_relaunch_script`) appends one line per step
    to this file; since it runs after this process has already exited, it's
    the only record of what happened if a copy/relaunch step fails silently
    on the user's machine."""
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
    """Best-effort append to `update.log`, timestamped the same way the
    relaunch PowerShell script's own `Log` function is (see
    `_RELAUNCH_SCRIPT`), so lines written from Python and from the script
    interleave into one coherent timeline regardless of which side wrote
    which. Called from `apply_update_and_exit` itself -- on both the normal
    handoff path and every abort path -- so an attempt that never gets as
    far as the PowerShell script successfully logging anything (it failed to
    launch at all, or was killed within its first moment of life) still
    leaves a trace. Without this, that failure mode looked exactly like "the
    app quietly vanished", with nothing on disk anywhere to explain why."""
    try:
        log_path = update_log_file_path()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        timestamp = dt.datetime.now().astimezone().isoformat(timespec="seconds")
        with log_path.open("a", encoding="utf-8") as f:
            f.write(f"{timestamp} [v{version}] {message}\n")
    except OSError:
        logger.debug("Could not write to the update log", exc_info=True)


def cleanup_stale_downloads() -> None:
    """Clears `downloads_dir()` of anything left over from a previous run --
    an update build that failed to download completely, or one that was
    superseded by a newer release before ever being applied. Nothing in
    there is resumable or otherwise worth keeping across a restart; a normal
    successful update already removes its own file (see
    `_render_relaunch_script`), so this is just cleanup for the abnormal
    cases. Best-effort and called once at startup, never on the hot path of
    an actual download."""
    directory = downloads_dir()
    if not directory.is_dir():
        return
    for child in directory.iterdir():
        try:
            if child.is_dir():
                import shutil

                shutil.rmtree(child)
            else:
                child.unlink()
        except OSError:
            logger.debug("Could not remove stale update download at %s", child, exc_info=True)


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


# Every step logs a timestamped line to `{log_path}` (best-effort: wrapped in
# try/catch so a locked/unwritable log never stops the actual update) since
# this script is the *only* thing running once this process has exited --
# without it, a failure here (a locked file, a blocked relaunch) previously
# looked to the user like "the app closed and never came back", with nothing
# on disk to explain why. Copy-Item and Start-Process are each retried a few
# times because the just-exited process (or real-time antivirus scanning an
# unfamiliar unsigned .exe) can hold a brief file lock or block execution
# right after `Wait-Process` returns or the copy completes. Path arguments
# are single-quoted (not double-quoted) so a `$` in a username or folder
# name -- valid in a Windows path, but PowerShell variable-expansion syntax
# inside a double-quoted string -- can't silently corrupt them.
#
# Critically, if replacing the installed .exe fails even after every retry,
# this still relaunches the *previous* version (untouched on disk) rather
# than leaving the app closed: a failed update should degrade back to "still
# running the old version", never to "gone until a human notices and
# manually reruns an old installer". Without this fallback, a persistent
# failure (e.g. antivirus holding a lock past the retry window) looked
# exactly like the app permanently forgetting how to start -- and since the
# installed .exe was never actually replaced, every future launch would
# redetect the same "new" release and repeat the identical failure.
_RELAUNCH_SCRIPT = """\
$ErrorActionPreference = 'Continue'
function Log($msg) {{
    try {{ Add-Content -LiteralPath '{log_path}' -Value "$(Get-Date -Format o) [v{version}] $msg" -Encoding utf8 }} catch {{}}
}}

function Relaunch($exePath, $why) {{
    for ($attempt = 1; $attempt -le 5; $attempt++) {{
        try {{
            Unblock-File -LiteralPath $exePath -ErrorAction SilentlyContinue
            $proc = Start-Process -FilePath $exePath -PassThru
            # Diagnostic only -- doesn't change the retry/fallback decision
            # below, which already treats a non-throwing Start-Process call
            # as success. This just tells the difference, in the log, between
            # "relaunched and still running" and "relaunched but something
            # (antivirus, SmartScreen) killed it a moment later" -- both look
            # identical to Start-Process itself, since it doesn't wait.
            Start-Sleep -Milliseconds 1500
            if ($proc -and $proc.HasExited) {{
                Log "$why -- relaunched (attempt $attempt) but the process exited almost immediately (code $($proc.ExitCode)); it may have been blocked by antivirus or SmartScreen."
            }} else {{
                Log "$why -- relaunched successfully (attempt $attempt) and is still running."
            }}
            return $true
        }} catch {{
            Log "$why -- relaunch attempt $attempt failed: $($_.Exception.Message)"
            Start-Sleep -Milliseconds 1000
        }}
    }}
    return $false
}}

Log "Waiting for process {pid} to exit..."
Wait-Process -Id {pid} -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

$copied = $false
for ($attempt = 1; $attempt -le 10; $attempt++) {{
    try {{
        Copy-Item -LiteralPath '{new_exe}' -Destination '{current_exe}' -Force
        $copied = $true
        Log "Copied new build into place (attempt $attempt)."
        break
    }} catch {{
        Log "Copy attempt $attempt failed: $($_.Exception.Message)"
        Start-Sleep -Milliseconds 1000
    }}
}}

if ($copied) {{
    Remove-Item -LiteralPath '{new_exe}' -Force -ErrorAction SilentlyContinue
    if (-not (Relaunch '{current_exe}' "Update installed")) {{
        Log "Update installed but every relaunch attempt failed -- the app will not restart on its own."
    }}
}} else {{
    Log "Update failed: could not replace the running executable after 10 attempts. Previous version left in place."
    if (-not (Relaunch '{current_exe}' "Copy failed, falling back to the previous version")) {{
        Log "Fallback relaunch of the previous version also failed -- the app will not restart on its own."
    }}
}}

Remove-Item -LiteralPath '{script_path}' -Force -ErrorAction SilentlyContinue
"""


def _render_relaunch_script(*, pid: int, new_exe: Path, current_exe: Path, script_path: Path, log_path: Path, version: str) -> str:
    """Pure string-formatting split out from `apply_update_and_exit` so the
    script's content is unit-testable without actually spawning PowerShell
    or exiting the process."""
    return _RELAUNCH_SCRIPT.format(
        pid=pid,
        new_exe=new_exe,
        current_exe=current_exe,
        script_path=script_path,
        log_path=log_path,
        version=version,
    )


def apply_update_and_exit(new_exe: Path, version: str = "?") -> bool:
    """Hands off to a detached PowerShell script that waits for this process
    (by pid) to exit, replaces the *actually installed* .exe (see
    `installed_exe_path`) with `new_exe`, relaunches it, and cleans up after
    itself -- then exits this process immediately (`os._exit`) so the
    script's wait resolves. Does not return in that case.

    Returns `False` instead of exiting if the handoff can't even get that
    far: `powershell.exe` fails to launch at all (missing/blocked
    interpreter), or -- the case this exists to guard against -- the script
    process dies within its first moment of life, before it could possibly
    have finished `Copy-Item` and relaunched anything. That second case is
    not hypothetical: this script is, by construction, an unsigned,
    freshly-spawned, hidden, execution-policy-bypassing process that copies
    one unsigned .exe over another and relaunches it -- exactly the shape of
    thing real-time antivirus and other endpoint protection is built to kill
    on sight, regardless of how legitimate the app actually is (see the
    module docstring's note on why this build isn't code-signed).

    Without this check, that failure mode was indistinguishable from success
    from this process's point of view: `Popen` returning just means Windows
    *accepted* the request to start a process, not that it kept running, and
    the very next line unconditionally exited -- so the app would vanish and
    never come back, with nothing on disk to explain why (the killed script
    likely never got to execute its own first `Log` call either). Aborting
    here instead means a self-update that can't complete degrades to "still
    running the current version, will retry next cycle", the same fallback
    principle `_RELAUNCH_SCRIPT` already applies on the *other* side of this
    handoff (see `_render_relaunch_script`'s callers/tests) if `Copy-Item`
    itself fails there.
    """
    current_exe = installed_exe_path()
    log_path = update_log_file_path()
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass

    fd, script_path_str = tempfile.mkstemp(suffix=".ps1", prefix="hots-analytics-update-")
    script_path = Path(script_path_str)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(
            _render_relaunch_script(
                pid=os.getpid(),
                new_exe=new_exe,
                current_exe=current_exe,
                script_path=script_path,
                log_path=log_path,
                version=version,
            )
        )

    try:
        process = subprocess.Popen(
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
            creationflags=_DETACHED_PROCESS | _CREATE_NEW_PROCESS_GROUP,
            close_fds=True,
        )
    except OSError as err:
        logger.error("Could not launch the relaunch script: %s", err)
        _append_update_log_line(version, f"Could not launch powershell.exe for the relaunch script: {err}.")
        return False

    deadline = time.monotonic() + _RELAUNCH_LIVENESS_CHECK_SECONDS
    while time.monotonic() < deadline:
        if process.poll() is not None:
            logger.error(
                "Relaunch script (pid %d) exited almost immediately (code %s); aborting the update.",
                process.pid,
                process.returncode,
            )
            _append_update_log_line(
                version,
                f"Relaunch script exited immediately (code {process.returncode}) -- likely blocked by "
                "antivirus or a security policy. Update aborted, staying on the current version.",
            )
            return False
        time.sleep(0.1)

    logger.info("Handed off to the relaunch script, exiting to update to v%s.", version)
    _append_update_log_line(version, f"Handed off to relaunch script (pid {process.pid}), exiting now.")
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
            downloads_dir(),
            on_progress=lambda frac: status.set(progress=frac),
        )
    except (requests.RequestException, OSError) as err:
        # OSError alongside the obvious network errors: `download_update`
        # also touches disk (`dest_dir.mkdir`, writing the file), and a
        # disk-full/permission/AV-lock failure there must degrade the same
        # way a network failure does -- logged and retried next cycle --
        # rather than propagate out of this function uncaught, which would
        # silently kill whichever thread called it (the persistent
        # "hots-update-checker" loop in `watch_for_updates`, or a one-shot
        # "Vérifier les mises à jour" click) and stop it from ever checking
        # again for the rest of this run.
        logger.warning("Update download failed, will retry next cycle: %s", err)
        status.set(phase=UpdatePhase.ERROR, message=str(err))
        return True

    status.set(phase=UpdatePhase.INSTALLING, progress=None)
    # Only returns (always `False`) if the handoff to the relaunch script
    # couldn't be confirmed -- see `apply_update_and_exit`'s docstring. On
    # success it exits the process instead, so this line is never reached.
    if not apply_update_and_exit(new_exe, version=update.version):
        status.set(
            phase=UpdatePhase.ERROR,
            message=(
                "Le redémarrage automatique a échoué (probablement bloqué par un antivirus) -- "
                "l'application précédente continue de fonctionner ; nouvel essai au prochain cycle."
            ),
        )
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
    cleanup_stale_downloads()
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
