import sys
import types
from unittest.mock import MagicMock

from src import single_instance


def test_acquire_always_true_off_windows(monkeypatch):
    monkeypatch.setattr(single_instance.sys, "platform", "linux")
    assert single_instance.acquire() is True


def _install_fake_win32_modules(monkeypatch, *, get_last_error: int) -> tuple[MagicMock, MagicMock]:
    fake_win32event = types.ModuleType("win32event")
    fake_win32api = types.ModuleType("win32api")
    fake_winerror = types.ModuleType("winerror")
    fake_winerror.ERROR_ALREADY_EXISTS = 183

    create_mutex = MagicMock(return_value="fake-handle")
    close_handle = MagicMock()
    fake_win32event.CreateMutex = create_mutex
    fake_win32api.GetLastError = MagicMock(return_value=get_last_error)
    fake_win32api.CloseHandle = close_handle

    monkeypatch.setitem(sys.modules, "win32event", fake_win32event)
    monkeypatch.setitem(sys.modules, "win32api", fake_win32api)
    monkeypatch.setitem(sys.modules, "winerror", fake_winerror)
    monkeypatch.setattr(single_instance.sys, "platform", "win32")
    monkeypatch.setattr(single_instance, "_mutex_handle", None)
    return create_mutex, close_handle


def test_acquire_true_when_no_other_instance_holds_it(monkeypatch):
    create_mutex, close_handle = _install_fake_win32_modules(monkeypatch, get_last_error=0)

    assert single_instance.acquire() is True
    create_mutex.assert_called_once()
    close_handle.assert_not_called()


def test_acquire_false_and_releases_handle_when_already_running(monkeypatch):
    _create_mutex, close_handle = _install_fake_win32_modules(monkeypatch, get_last_error=183)

    assert single_instance.acquire() is False
    close_handle.assert_called_once_with("fake-handle")
