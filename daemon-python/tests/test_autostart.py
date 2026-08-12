import sys
import types
from pathlib import Path
from unittest.mock import patch

from src import autostart


def test_is_supported_false_when_not_frozen():
    with patch("src.autostart.IS_FROZEN", False), patch("src.autostart.sys.platform", "win32"):
        assert autostart.is_supported() is False


def test_is_supported_false_on_non_windows():
    with patch("src.autostart.IS_FROZEN", True), patch("src.autostart.sys.platform", "linux"):
        assert autostart.is_supported() is False


def test_is_enabled_false_when_not_supported():
    with patch("src.autostart.is_supported", return_value=False):
        assert autostart.is_enabled() is False


def test_set_enabled_is_a_noop_when_not_supported():
    # Must not raise even on a platform without a `winreg` module to import.
    with patch("src.autostart.is_supported", return_value=False):
        autostart.set_enabled(True)
        autostart.set_enabled(False)


def test_set_enabled_registers_installed_exe_path_not_sys_executable(monkeypatch):
    """Regression test: the Run key must point at `installed_exe_path()`
    (the real, persistent .exe), not `sys.executable` -- under Nuitka's
    --onefile packaging the latter resolves to a temp extraction folder
    that's deleted once the process exits, which would silently break
    autostart on the next boot."""
    fake_winreg = types.ModuleType("winreg")
    fake_winreg.HKEY_CURRENT_USER = "HKCU"
    fake_winreg.KEY_SET_VALUE = 1
    fake_winreg.REG_SZ = 1

    class _Key:
        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

    written: list[str] = []
    fake_winreg.OpenKey = lambda *_a, **_k: _Key()
    fake_winreg.SetValueEx = lambda _key, _name, _res, _type, value: written.append(value)

    monkeypatch.setitem(sys.modules, "winreg", fake_winreg)
    monkeypatch.setattr(autostart, "is_supported", lambda: True)
    monkeypatch.setattr(autostart, "installed_exe_path", lambda: Path(r"C:\Real\hots-analytics-daemon.exe"))

    autostart.set_enabled(True)

    assert written == ['"C:\\Real\\hots-analytics-daemon.exe"']
