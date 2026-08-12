"""Finds the Heroes of the Storm window and screenshots its client area
(the game's actual render surface, excluding the title bar/borders) --
`draft_layout.py`'s crop coordinates were tuned against a clean game
capture with no window chrome in it.

Windows-only (`pywin32`'s `win32gui`), like the rest of this daemon.
Exclusive fullscreen bypasses the desktop compositor the same way it
bypasses everything else GDI/DWM-based, so this only reliably captures the
game in windowed or "Fullscreen (Windowed)" mode -- the latter is HotS's own
default display mode, so that's expected to cover the common case.

`win32gui` and `mss` are imported lazily inside the functions that need
them (same pattern as `autostart.py`'s lazy `import winreg`) so this module
stays importable -- and its control flow unit-testable with both mocked
out -- on any platform.
"""

from __future__ import annotations

import logging

from PIL import Image

logger = logging.getLogger(__name__)

# Every window title HotS is known to use across regions/patches -- matched
# as a case-insensitive substring rather than an exact string.
_WINDOW_TITLE_HINTS = ("heroes of the storm",)


class GameWindowNotFoundError(Exception):
    """Raised when no live, visible Heroes of the Storm window can be found."""


def find_game_window() -> int:
    """Returns the window handle (HWND) of the running game window.
    Minimized windows are skipped (`IsIconic`) since there's nothing to
    screenshot; raises `GameWindowNotFoundError` if none match."""
    import win32gui

    matches: list[int] = []

    def _on_window(hwnd: int, _param: object) -> bool:
        if not win32gui.IsWindowVisible(hwnd) or win32gui.IsIconic(hwnd):
            return True
        title = win32gui.GetWindowText(hwnd).lower()
        if any(hint in title for hint in _WINDOW_TITLE_HINTS):
            matches.append(hwnd)
        return True

    win32gui.EnumWindows(_on_window, None)
    if not matches:
        raise GameWindowNotFoundError("Heroes of the Storm window not found (is the game running?)")
    return matches[0]


def capture_window(hwnd: int) -> Image.Image:
    """Screenshots `hwnd`'s client area, mapped to absolute screen
    coordinates, via `mss` (faster than `PIL.ImageGrab` for a full-window
    grab, though this feature only takes one per hotkey press)."""
    import win32gui

    left, top, right, bottom = win32gui.GetClientRect(hwnd)
    left, top = win32gui.ClientToScreen(hwnd, (left, top))
    right, bottom = win32gui.ClientToScreen(hwnd, (right, bottom))

    if right <= left or bottom <= top:
        raise GameWindowNotFoundError("Heroes of the Storm window has no visible client area.")

    import mss

    with mss.mss() as sct:
        raw = sct.grab({"left": left, "top": top, "width": right - left, "height": bottom - top})
        return Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")


def capture_game_window() -> Image.Image:
    """Convenience wrapper: finds the game window and screenshots it in one call."""
    return capture_window(find_game_window())
