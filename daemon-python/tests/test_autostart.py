import sys
import types
from pathlib import Path
from unittest.mock import patch

import pytest

from src import autostart


@pytest.fixture
def fake_winreg(monkeypatch):
    """A minimal in-memory stand-in for `winreg`, keyed by (subkey, value
    name). Good enough to drive `autostart.py`'s Run / StartupApproved
    read-writes without touching the real Windows registry. Exposes
    `.store` (a `{(subkey, value_name): value}` dict) so a test can seed or
    inspect state directly."""
    store: dict[tuple[str, str], object] = {}

    class _Key:
        def __init__(self, subkey):
            self.subkey = subkey

        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

        def Close(self):
            pass

    fake = types.ModuleType("winreg")
    fake.HKEY_CURRENT_USER = "HKCU"
    fake.KEY_SET_VALUE = 1
    fake.REG_SZ = 1
    fake.REG_BINARY = 3
    fake.OpenKey = lambda _hive, subkey, *_a, **_k: _Key(subkey)
    fake.CreateKeyEx = lambda _hive, subkey, *_a, **_k: _Key(subkey)

    def _set_value_ex(key, name, _res, _type, value):
        store[(key.subkey, name)] = value

    def _query_value_ex(key, name):
        if (key.subkey, name) not in store:
            raise FileNotFoundError()
        return store[(key.subkey, name)], 1

    def _delete_value(key, name):
        if (key.subkey, name) not in store:
            raise FileNotFoundError()
        del store[(key.subkey, name)]

    fake.SetValueEx = _set_value_ex
    fake.QueryValueEx = _query_value_ex
    fake.DeleteValue = _delete_value
    fake.store = store

    monkeypatch.setitem(sys.modules, "winreg", fake)
    monkeypatch.setattr(autostart, "is_supported", lambda: True)
    monkeypatch.setattr(
        autostart, "installed_exe_path", lambda: Path(r"C:\Real\hots-analytics-daemon.exe")
    )
    return fake


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


def test_set_enabled_registers_installed_exe_path_not_sys_executable(fake_winreg):
    """Regression test: the Run key must point at `installed_exe_path()`
    (the real, persistent .exe), not `sys.executable` -- under Nuitka's
    --onefile packaging the latter resolves to a temp extraction folder
    that's deleted once the process exits, which would silently break
    autostart on the next boot."""
    autostart.set_enabled(True)

    assert fake_winreg.store[(autostart._RUN_KEY, autostart._VALUE_NAME)] == (
        '"C:\\Real\\hots-analytics-daemon.exe"'
    )


def test_is_enabled_false_when_run_key_absent(fake_winreg):
    assert autostart.is_enabled() is False


def test_is_enabled_true_when_run_key_present_and_startup_approved_absent(fake_winreg):
    autostart.set_enabled(True)
    # Simulate a plain, never-touched-by-Task-Manager install: only the Run
    # key exists, no StartupApproved entry at all.
    fake_winreg.store.pop((autostart._STARTUP_APPROVED_KEY, autostart._VALUE_NAME), None)

    assert autostart.is_enabled() is True


def test_is_enabled_false_when_startup_approved_marks_it_disabled(fake_winreg):
    autostart.set_enabled(True)
    fake_winreg.store[(autostart._STARTUP_APPROVED_KEY, autostart._VALUE_NAME)] = bytes(
        [0x03] + [0] * 11
    )

    assert autostart.is_enabled() is False


def test_set_enabled_true_writes_startup_approved_enabled_blob(fake_winreg):
    autostart.set_enabled(True)

    value = fake_winreg.store[(autostart._STARTUP_APPROVED_KEY, autostart._VALUE_NAME)]
    assert value[0] == 0x02


def test_set_enabled_true_repairs_a_previously_disabled_startup_approved_flag(fake_winreg):
    fake_winreg.store[(autostart._RUN_KEY, autostart._VALUE_NAME)] = '"C:\\old.exe"'
    fake_winreg.store[(autostart._STARTUP_APPROVED_KEY, autostart._VALUE_NAME)] = bytes(
        [0x03] + [0] * 11
    )

    autostart.set_enabled(True)

    assert autostart.is_enabled() is True


def test_needs_repair_false_when_run_key_absent(fake_winreg):
    assert autostart.needs_repair() is False


def test_needs_repair_false_when_enabled_normally(fake_winreg):
    autostart.set_enabled(True)
    assert autostart.needs_repair() is False


def test_needs_repair_true_when_windows_silently_disabled_it(fake_winreg):
    fake_winreg.store[(autostart._RUN_KEY, autostart._VALUE_NAME)] = '"C:\\old.exe"'
    fake_winreg.store[(autostart._STARTUP_APPROVED_KEY, autostart._VALUE_NAME)] = bytes(
        [0x03] + [0] * 11
    )

    assert autostart.needs_repair() is True
