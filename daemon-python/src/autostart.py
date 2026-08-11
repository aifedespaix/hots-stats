""""Launch at Windows startup" toggle, backed by the current user's `Run`
registry key (`HKCU\\...\\CurrentVersion\\Run`) rather than a shortcut in the
Startup folder: no admin rights needed to write it, and it's trivially
inspectable/removable by the user themselves (Task Manager's Startup tab,
`msconfig`, or regedit) without having to know where the daemon put a file.

Launching the registered command (the .exe, no arguments) reuses the
already-existing "no config -> settings window, else -> tray only" behavior
in `app.run_app`: once configured, starting the daemon never pops the
settings window, so autostart naturally launches straight into the tray with
sync running in the background -- there's no separate "silent" mode to build.
"""

from __future__ import annotations

import logging
import sys

from .updater import IS_FROZEN

logger = logging.getLogger(__name__)

_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
_VALUE_NAME = "HotsAnalyticsDaemon"


def is_supported() -> bool:
    """True only for the compiled .exe on Windows: there's no installed
    binary to point the registry at in dev (`python -m src.main` would
    register the interpreter itself), and the `winreg` module this uses
    only exists on Windows."""
    return sys.platform == "win32" and IS_FROZEN


def is_enabled() -> bool:
    if not is_supported():
        return False
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as key:
            winreg.QueryValueEx(key, _VALUE_NAME)
            return True
    except OSError:
        return False


def set_enabled(enabled: bool) -> None:
    """Best-effort: a registry write can fail (permissions, a locked-down
    machine) but that must never crash the settings window over a
    convenience toggle -- log and leave the checkbox to reflect reality on
    next open instead."""
    if not is_supported():
        return
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            if enabled:
                winreg.SetValueEx(key, _VALUE_NAME, 0, winreg.REG_SZ, f'"{sys.executable}"')
            else:
                try:
                    winreg.DeleteValue(key, _VALUE_NAME)
                except FileNotFoundError:
                    pass
    except OSError as err:
        logger.warning("Failed to update the Windows startup registration: %s", err)
