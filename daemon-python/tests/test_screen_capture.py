import sys
from unittest.mock import MagicMock

import pytest

from src.screen_capture import (
    GameWindowNotFoundError,
    capture_window,
    find_foreground_window,
    find_game_window,
)


@pytest.fixture
def fake_win32gui(monkeypatch):
    fake = MagicMock()
    monkeypatch.setitem(sys.modules, "win32gui", fake)
    return fake


def test_find_game_window_returns_matching_visible_window(fake_win32gui):
    def enum_windows(callback, param):
        callback(111, param)  # not visible, skipped
        callback(222, param)  # matches

    fake_win32gui.EnumWindows.side_effect = enum_windows
    fake_win32gui.IsWindowVisible.side_effect = lambda hwnd: hwnd == 222
    fake_win32gui.IsIconic.return_value = False
    fake_win32gui.GetWindowText.side_effect = lambda hwnd: "Heroes of the Storm" if hwnd == 222 else ""

    assert find_game_window() == 222


def test_find_game_window_raises_when_not_running(fake_win32gui):
    fake_win32gui.EnumWindows.side_effect = lambda callback, param: None

    with pytest.raises(GameWindowNotFoundError):
        find_game_window()


def test_find_game_window_prefers_the_foreground_window_among_matches(fake_win32gui):
    """A browser tab or another app can also have "Heroes of the Storm" in
    its title -- when more than one visible window matches, the one the
    player is actually looking at (foreground) must win over EnumWindows'
    arbitrary Z-order-derived iteration order."""

    def enum_windows(callback, param):
        callback(111, param)
        callback(222, param)

    fake_win32gui.EnumWindows.side_effect = enum_windows
    fake_win32gui.IsWindowVisible.return_value = True
    fake_win32gui.IsIconic.return_value = False
    fake_win32gui.GetWindowText.return_value = "Heroes of the Storm"
    fake_win32gui.GetForegroundWindow.return_value = 222

    assert find_game_window() == 222


def test_find_game_window_falls_back_to_first_match_when_foreground_is_unrelated(fake_win32gui):
    """The foreground window isn't always one of the matches at all (e.g. an
    overlay briefly stealing focus) -- falls back to the first match rather
    than finding nothing."""

    def enum_windows(callback, param):
        callback(111, param)

    fake_win32gui.EnumWindows.side_effect = enum_windows
    fake_win32gui.IsWindowVisible.return_value = True
    fake_win32gui.IsIconic.return_value = False
    fake_win32gui.GetWindowText.return_value = "Heroes of the Storm"
    fake_win32gui.GetForegroundWindow.return_value = 999  # some other, unrelated window

    assert find_game_window() == 111


def test_find_game_window_skips_minimized_windows(fake_win32gui):
    fake_win32gui.EnumWindows.side_effect = lambda callback, param: callback(333, param)
    fake_win32gui.IsWindowVisible.return_value = True
    fake_win32gui.IsIconic.return_value = True

    with pytest.raises(GameWindowNotFoundError):
        find_game_window()


def test_find_foreground_window_returns_whatever_has_focus_no_title_check(fake_win32gui):
    """Unlike `find_game_window`, no title filtering at all -- this backs
    the "Tester la capture" button, which must work against any window."""
    fake_win32gui.GetForegroundWindow.return_value = 777

    assert find_foreground_window() == 777


def test_find_foreground_window_raises_when_nothing_has_focus(fake_win32gui):
    fake_win32gui.GetForegroundWindow.return_value = 0

    with pytest.raises(GameWindowNotFoundError):
        find_foreground_window()


def test_capture_window_rejects_empty_client_area(fake_win32gui):
    fake_win32gui.GetClientRect.return_value = (0, 0, 0, 0)
    fake_win32gui.ClientToScreen.side_effect = lambda hwnd, point: point

    with pytest.raises(GameWindowNotFoundError):
        capture_window(123)


def test_capture_window_returns_image_from_client_rect(fake_win32gui, monkeypatch):
    fake_win32gui.GetClientRect.return_value = (0, 0, 4, 2)
    fake_win32gui.ClientToScreen.side_effect = lambda hwnd, point: point

    fake_grab = MagicMock()
    fake_grab.size = (4, 2)
    fake_grab.bgra = bytes([0, 0, 0, 255] * 8)  # 4x2 pixels, BGRA

    fake_sct = MagicMock()
    fake_sct.grab.return_value = fake_grab
    fake_mss_module = MagicMock()
    fake_mss_module.mss.return_value.__enter__.return_value = fake_sct
    monkeypatch.setitem(sys.modules, "mss", fake_mss_module)

    image = capture_window(123)

    assert image.size == (4, 2)
    fake_sct.grab.assert_called_once_with({"left": 0, "top": 0, "width": 4, "height": 2})
