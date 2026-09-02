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

from .updater import IS_FROZEN, installed_exe_path

logger = logging.getLogger(__name__)

_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
_VALUE_NAME = "HotsAnalyticsDaemon"

# Windows tracks a *second*, independent flag for every Run-key startup
# entry: Task Manager's Startup tab (or Windows itself, if it judges an app
# too slow to start) can disable an entry here without ever touching the
# Run key value it's paired with -- which is exactly why a checkbox driven
# only by the Run key (as this module used to be) can show "enabled" while
# nothing actually launches at boot. Format is undocumented but stable
# since Windows 8: a 12-byte value per app name, byte 0 == 0x02 means
# enabled, any other observed value means disabled by Task Manager or
# Windows' own startup-impact policy.
_STARTUP_APPROVED_KEY = (
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
)
_STARTUP_APPROVED_ENABLED_BLOB = bytes([0x02] + [0] * 11)


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
    except OSError:
        return False
    return _is_startup_approved_enabled()


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
                # `installed_exe_path()`, not `sys.executable`: under Nuitka's
                # --onefile packaging the latter resolves to the ephemeral
                # per-run extraction folder, which is gone by the next boot --
                # pointing autostart at it would silently stop working the
                # moment the process that created it exits.
                winreg.SetValueEx(key, _VALUE_NAME, 0, winreg.REG_SZ, f'"{installed_exe_path()}"')
            else:
                try:
                    winreg.DeleteValue(key, _VALUE_NAME)
                except FileNotFoundError:
                    pass
    except OSError as err:
        logger.warning("Failed to update the Windows startup registration: %s", err)
        return
    if enabled:
        _mark_startup_approved_enabled()


def _is_startup_approved_enabled() -> bool:
    """True unless Windows separately marked this entry disabled via
    StartupApproved -- see `_STARTUP_APPROVED_KEY`. No entry at all (never
    touched by Task Manager) counts as enabled, matching Windows' own
    default for an untouched Run-key entry."""
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _STARTUP_APPROVED_KEY) as key:
            value, _ = winreg.QueryValueEx(key, _VALUE_NAME)
    except OSError:
        return True
    return bool(value) and value[0] == 0x02


def _mark_startup_approved_enabled() -> None:
    """Best-effort repair: forces StartupApproved's flag for this entry
    back to "enabled", the same effective state re-enabling it from Task
    Manager would produce. Called from `set_enabled(True)` so turning
    autostart on always actually results in it running at the next boot,
    even if Windows had silently disabled it before."""
    import winreg

    try:
        key = winreg.CreateKeyEx(
            winreg.HKEY_CURRENT_USER, _STARTUP_APPROVED_KEY, 0, winreg.KEY_SET_VALUE
        )
    except OSError as err:
        logger.warning("Could not open StartupApproved\\Run to repair autostart: %s", err)
        return
    try:
        winreg.SetValueEx(
            key, _VALUE_NAME, 0, winreg.REG_BINARY, _STARTUP_APPROVED_ENABLED_BLOB
        )
    except OSError as err:
        logger.warning("Could not repair the StartupApproved autostart flag: %s", err)
    finally:
        key.Close()


def needs_repair() -> bool:
    """True only when the Run key is registered but Windows separately
    disabled it via StartupApproved -- the one case `is_enabled()` alone
    can't distinguish from "never enabled". Lets the settings window
    proactively repair a silently-broken autostart when it opens, instead
    of just showing the checkbox unchecked and waiting for the player to
    notice and re-toggle it themselves."""
    if not is_supported():
        return False
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as key:
            winreg.QueryValueEx(key, _VALUE_NAME)
    except OSError:
        return False
    return not _is_startup_approved_enabled()
