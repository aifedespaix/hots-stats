import sys
import time
from unittest.mock import MagicMock

import pytest

from src.hotkey import HotkeyManager, InvalidHotkeyError, validate


def _wait_until(condition, timeout=1.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(0.005)
    raise AssertionError("condition was not met in time")


@pytest.fixture
def fake_keyboard(monkeypatch):
    # `keyboard` does real OS-level hook/device work at import time, which
    # fails outright on a non-Windows, non-root CI box -- swapping in a
    # mock via sys.modules keeps hotkey.py's lazy `import keyboard`
    # statements from ever touching the real package during tests.
    fake = MagicMock()
    monkeypatch.setitem(sys.modules, "keyboard", fake)
    return fake


def test_validate_rejects_empty():
    with pytest.raises(InvalidHotkeyError):
        validate("   ")


def test_validate_rejects_reserved():
    with pytest.raises(InvalidHotkeyError):
        validate("alt+f4")


def test_validate_rejects_no_modifier():
    with pytest.raises(InvalidHotkeyError):
        validate("d")


def test_validate_normalizes_case_and_whitespace(fake_keyboard):
    assert validate(" CTRL+SHIFT+D ") == "ctrl+shift+d"


def test_validate_rejects_unparsable_combo(fake_keyboard):
    fake_keyboard.parse_hotkey.side_effect = ValueError("boom")
    with pytest.raises(InvalidHotkeyError):
        validate("ctrl+shift+???")


def test_hotkey_manager_registers_and_replaces(fake_keyboard):
    manager = HotkeyManager(on_trigger=lambda: None)

    manager.start("ctrl+shift+d")
    assert manager.active_hotkey == "ctrl+shift+d"
    fake_keyboard.add_hotkey.assert_called_once()

    manager.start("ctrl+alt+g")
    assert manager.active_hotkey == "ctrl+alt+g"
    fake_keyboard.remove_hotkey.assert_called_once_with("ctrl+shift+d")


def test_hotkey_manager_start_invalid_hotkey_registers_nothing(fake_keyboard):
    manager = HotkeyManager(on_trigger=lambda: None)
    manager.start("d")  # no modifier

    assert manager.active_hotkey is None
    fake_keyboard.add_hotkey.assert_not_called()


def test_hotkey_manager_stop_unregisters(fake_keyboard):
    manager = HotkeyManager(on_trigger=lambda: None)
    manager.start("ctrl+shift+d")

    manager.stop()

    assert manager.active_hotkey is None
    fake_keyboard.remove_hotkey.assert_called_once_with("ctrl+shift+d")


def test_hotkey_manager_registration_failure_is_swallowed(fake_keyboard, monkeypatch):
    import src.hotkey as hotkey_module

    monkeypatch.setattr(hotkey_module, "_MAX_REGISTRATION_ATTEMPTS", 1)
    fake_keyboard.add_hotkey.side_effect = RuntimeError("hook failed")
    manager = HotkeyManager(on_trigger=lambda: None)

    manager.start("ctrl+shift+d")

    assert manager.active_hotkey is None


def test_snapshot_reports_registered_hotkey_and_no_error(fake_keyboard):
    manager = HotkeyManager(on_trigger=lambda: None)
    manager.start("ctrl+shift+d")

    status = manager.snapshot()
    assert status.registered_hotkey == "ctrl+shift+d"
    assert status.last_error is None


def test_snapshot_reports_last_error_on_registration_failure(fake_keyboard, monkeypatch):
    import src.hotkey as hotkey_module

    monkeypatch.setattr(hotkey_module, "_MAX_REGISTRATION_ATTEMPTS", 1)
    fake_keyboard.add_hotkey.side_effect = RuntimeError("hook failed")
    manager = HotkeyManager(on_trigger=lambda: None)

    manager.start("ctrl+shift+d")

    status = manager.snapshot()
    assert status.registered_hotkey is None
    assert status.last_error == "hook failed"


def test_snapshot_clears_last_error_on_a_later_successful_start(fake_keyboard):
    fake_keyboard.add_hotkey.side_effect = [RuntimeError("hook failed"), None]
    manager = HotkeyManager(on_trigger=lambda: None)

    manager.start("ctrl+shift+d")
    assert manager.snapshot().last_error == "hook failed"

    manager.start("ctrl+alt+g")
    assert manager.snapshot().last_error is None
    assert manager.snapshot().registered_hotkey == "ctrl+alt+g"


def test_snapshot_reports_invalid_hotkey_as_last_error(fake_keyboard):
    manager = HotkeyManager(on_trigger=lambda: None)
    manager.start("d")  # no modifier -- fails validate(), not add_hotkey

    status = manager.snapshot()
    assert status.registered_hotkey is None
    assert "modification" in status.last_error


def test_snapshot_records_last_triggered_at_on_a_real_press(fake_keyboard):
    calls: list[str] = []
    manager = HotkeyManager(on_trigger=lambda: calls.append("fired"))
    manager.start("ctrl+shift+d")

    # `fake_keyboard.add_hotkey` doesn't call its callback itself -- grab
    # the wrapped callback `HotkeyManager` actually registered and invoke it
    # directly, simulating Windows firing the hook.
    registered_callback = fake_keyboard.add_hotkey.call_args.args[1]
    registered_callback()

    assert calls == ["fired"]
    assert manager.snapshot().last_triggered_at is not None


def test_last_triggered_at_updates_even_if_on_trigger_raises(fake_keyboard):
    def _boom():
        raise RuntimeError("capture blew up")

    manager = HotkeyManager(on_trigger=_boom)
    manager.start("ctrl+shift+d")
    registered_callback = fake_keyboard.add_hotkey.call_args.args[1]

    with pytest.raises(RuntimeError):
        registered_callback()

    assert manager.snapshot().last_triggered_at is not None


def test_start_retries_after_a_registration_failure_and_eventually_succeeds(
    fake_keyboard, monkeypatch
):
    import src.hotkey as hotkey_module

    monkeypatch.setattr(hotkey_module, "_RETRY_DELAY_SECONDS", 0.01)
    fake_keyboard.add_hotkey.side_effect = [RuntimeError("hook failed"), None]
    manager = HotkeyManager(on_trigger=lambda: None)

    manager.start("ctrl+shift+d")
    assert manager.active_hotkey is None
    assert manager.snapshot().last_error == "hook failed"

    _wait_until(lambda: manager.active_hotkey == "ctrl+shift+d")
    assert manager.snapshot().last_error is None


def test_retry_gives_up_after_max_attempts(fake_keyboard, monkeypatch):
    import src.hotkey as hotkey_module

    monkeypatch.setattr(hotkey_module, "_RETRY_DELAY_SECONDS", 0.01)
    monkeypatch.setattr(hotkey_module, "_MAX_REGISTRATION_ATTEMPTS", 2)
    fake_keyboard.add_hotkey.side_effect = RuntimeError("hook failed")
    manager = HotkeyManager(on_trigger=lambda: None)

    manager.start("ctrl+shift+d")
    time.sleep(0.05)  # long enough for every retry attempt to have run

    assert manager.active_hotkey is None
    assert fake_keyboard.add_hotkey.call_count == 2


def test_a_pending_retry_is_superseded_by_a_new_start_call(fake_keyboard, monkeypatch):
    import src.hotkey as hotkey_module

    monkeypatch.setattr(hotkey_module, "_RETRY_DELAY_SECONDS", 0.05)
    fake_keyboard.add_hotkey.side_effect = [RuntimeError("hook failed"), None, None]
    manager = HotkeyManager(on_trigger=lambda: None)

    manager.start("ctrl+shift+d")  # fails, schedules a retry for "ctrl+shift+d"
    manager.start("ctrl+alt+g")  # succeeds immediately, should win

    time.sleep(0.1)  # let the stale retry's timer fire, if it's going to

    assert manager.active_hotkey == "ctrl+alt+g"
