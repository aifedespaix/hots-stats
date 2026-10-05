"""Is Heroes of the Storm running right now? Lets the upload scheduler hold the *backlog*
back while the player is in the game (see upload_scheduler.py).

Uses the Win32 process snapshot through `ctypes` rather than `psutil`, so the frozen exe
doesn't gain a dependency for one boolean. Non-Windows (dev machines running the tests)
always reports "not running".
"""

from __future__ import annotations

import ctypes
import logging
import sys
import threading
import time
from ctypes import wintypes
from typing import Callable

logger = logging.getLogger(__name__)

GAME_PROCESS_NAMES = frozenset({"heroesofthestorm_x64.exe", "heroesofthestorm.exe"})
_TH32CS_SNAPPROCESS = 0x00000002


if sys.platform == "win32":

    class PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", ctypes.c_wchar * 260),
        ]

    # A private handle to kernel32 (not the shared `ctypes.windll.kernel32`, whose function
    # objects are process-wide): the argtypes below are set once at import so no call ever
    # rewrites them while another thread is mid-call.
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    _kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    _kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    _kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    _kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

# Called from the scheduler thread (GameDetector) and the Tk thread (sync window), so the
# snapshot walk is serialised.
_snapshot_lock = threading.Lock()


def _list_process_names() -> list[str]:
    if sys.platform != "win32":
        return []

    with _snapshot_lock:
        snapshot = _kernel32.CreateToolhelp32Snapshot(_TH32CS_SNAPPROCESS, 0)
        if snapshot in (None, ctypes.c_void_p(-1).value):
            return []
        names: list[str] = []
        try:
            entry = PROCESSENTRY32W()
            entry.dwSize = ctypes.sizeof(entry)
            ok = _kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
            while ok:
                names.append(entry.szExeFile)
                ok = _kernel32.Process32NextW(snapshot, ctypes.byref(entry))
        finally:
            _kernel32.CloseHandle(snapshot)
        return names


class GameDetector:
    """Caches the answer for `ttl` seconds: the scheduler asks before every backlog file, and a
    process snapshot per file would be wasted work."""

    def __init__(
        self,
        *,
        lister: Callable[[], list[str]] = _list_process_names,
        ttl: float = 5.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._lister = lister
        self._ttl = ttl
        self._clock = clock
        self._checked_at: float | None = None
        self._running = False

    def is_running(self) -> bool:
        now = self._clock()
        if self._checked_at is None or now - self._checked_at >= self._ttl:
            try:
                self._running = any(name.lower() in GAME_PROCESS_NAMES for name in self._lister())
            except Exception:  # noqa: BLE001 -- detection is a courtesy, never a reason to stall the sync
                logger.debug("Game process detection failed", exc_info=True)
                self._running = False
            self._checked_at = now
        return self._running
