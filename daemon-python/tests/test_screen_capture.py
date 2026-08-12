import sys
from unittest.mock import MagicMock

import pytest

from src.screen_capture import GameWindowNotFoundError, capture_window, find_game_window


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


def test_find_game_window_skips_minimized_windows(fake_win32gui):
    fake_win32gui.EnumWindows.side_effect = lambda callback, param: callback(333, param)
    fake_win32gui.IsWindowVisible.return_value = True
    fake_win32gui.IsIconic.return_value = True

    with pytest.raises(GameWindowNotFoundError):
        find_game_window()


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
