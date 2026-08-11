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
from dataclasses import dataclass
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


@dataclass(frozen=True)
class AvailableUpdate:
    version: str
    download_url: str
    asset_name: str


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


def download_update(update: AvailableUpdate, dest_dir: Path) -> Path:
    """Streams the release asset to `dest_dir / update.asset_name`."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / update.asset_name
    with requests.get(update.download_url, stream=True, timeout=_DOWNLOAD_TIMEOUT_SECONDS) as response:
        response.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                f.write(chunk)
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
    (by pid) to exit, replaces the running .exe with `new_exe`, relaunches
    it, and cleans up after itself -- then exits this process immediately so
    the script's wait resolves. Never returns."""
    current_exe = Path(sys.executable).resolve()
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


def watch_for_updates(
    stop_event: threading.Event, on_update_found: Callable[[AvailableUpdate], None] | None = None
) -> None:
    """Runs for the app's lifetime on a background thread: checks for a
    newer release shortly after startup, then every few hours, and applies
    it (see `apply_update_and_exit`) as soon as one is found. No-ops when
    not running as the compiled .exe (e.g. `python -m src.main` in dev),
    since there's no installed binary to replace.

    `on_update_found`, when given, is called once a newer build is
    confirmed available, before it's downloaded -- app.py wires this to a
    tray balloon notification so the (fully automatic) update doesn't
    happen invisibly. Best-effort: an exception from it is logged and never
    stops the update from proceeding.
    """
    if not IS_FROZEN:
        return
    if stop_event.wait(_STARTUP_DELAY_SECONDS):
        return
    while not stop_event.is_set():
        update = check_for_update()
        if update is not None:
            logger.info("Update v%s available, downloading...", update.version)
            if on_update_found is not None:
                try:
                    on_update_found(update)
                except Exception:
                    logger.warning("Update-found notification callback failed", exc_info=True)
            try:
                new_exe = download_update(update, Path(tempfile.gettempdir()) / "hots-analytics-updates")
            except requests.RequestException as err:
                logger.warning("Update download failed, will retry next cycle: %s", err)
            else:
                apply_update_and_exit(new_exe)  # never returns
        if stop_event.wait(_CHECK_INTERVAL_SECONDS):
            return
