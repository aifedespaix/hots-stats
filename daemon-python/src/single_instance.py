"""Prevents two copies of the daemon's tray app from running at once.

Uses a named Win32 mutex rather than a PID/lock file: the OS releases it the
instant this process dies for any reason (crash, Task Manager kill, power
loss), with nothing left behind to clean up or a staleness check to get
wrong -- unlike a lock file, which needs its own "is that pid still alive"
logic to recover from an unclean previous exit.
"""

from __future__ import annotations

import logging
import sys

logger = logging.getLogger(__name__)

_MUTEX_NAME = "Global\\HotsAnalyticsDaemon-SingleInstance"

# Kept referenced for the process's whole lifetime once acquired: letting it
# get garbage-collected would close the handle and release the mutex early.
_mutex_handle = None


def acquire() -> bool:
    """Returns True if this process now (exclusively) holds the daemon's
    single-instance lock, False if another instance already holds it. A
    no-op that always returns True off Windows, where this daemon isn't
    supported anyway (see `updater.IS_FROZEN` / `autostart.is_supported`)."""
    global _mutex_handle
    if sys.platform != "win32":
        return True

    import win32api
    import win32event
    import winerror

    handle = win32event.CreateMutex(None, False, _MUTEX_NAME)
    already_running = win32api.GetLastError() == winerror.ERROR_ALREADY_EXISTS
    if already_running:
        win32api.CloseHandle(handle)
        logger.info("Another instance already holds the single-instance lock.")
        return False

    _mutex_handle = handle
    return True
