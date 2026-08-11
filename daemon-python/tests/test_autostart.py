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
