"""Global keyboard shortcut that triggers a live-draft capture.

Backed by the `keyboard` package, which installs a low-level Windows
keyboard hook (`SetWindowsHookEx(WH_KEYBOARD_LL, ...)`) rather than binding
to a specific window -- that's what makes it fire even while Heroes of the
Storm has focus, windowed or fullscreen (exclusive fullscreen bypasses this
the same way it bypasses everything else GDI-based; "Fullscreen (Windowed)",
the game's own default display mode, works fine).

`keyboard` does real OS work at import time on Linux (device enumeration
under `/dev/input`, which needs root) and at hook-install time on Windows, so
every import of it here is deferred into the functions that need it -- same
pattern as `autostart.py`'s lazy `import winreg` -- so this module stays
importable (and unit-testable, with `keyboard` mocked out) on any platform.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

logger = logging.getLogger(__name__)

# Combos that are either claimed by Windows/the shell itself (so `keyboard`
# would never see them fire) or too easy to hit by accident (no modifier at
# all). Not exhaustive -- there's no reliable way to detect what some other
# running application already grabbed -- just enough to steer a rebind away
# from the obviously bad choices.
_RESERVED_HOTKEYS = {
    "alt+f4",
    "alt+tab",
    "ctrl+alt+delete",
    "ctrl+shift+esc",
    "windows",
    "print screen",
}


class InvalidHotkeyError(ValueError):
    """Raised by `validate` for a combo that can't be registered."""


@dataclass(frozen=True)
class HotkeyStatus:
    """A point-in-time snapshot of `HotkeyManager`'s state -- what's
    actually registered with Windows right now, the most recent
    registration failure (if any), and when the hotkey was last actually
    pressed. Exists because the settings window previously had no way to
    tell "the combo is syntactically valid" (`validate()`, a pure string
    check) apart from "Windows actually installed the hook" -- the gap that
    made a silently-failed registration look identical to a working one."""

    registered_hotkey: str | None
    last_error: str | None
    last_triggered_at: datetime | None


def validate(hotkey: str) -> str:
    """Normalizes and validates a hotkey string (e.g. "ctrl+shift+d"),
    raising `InvalidHotkeyError` with a user-facing message if it's empty,
    unparsable, reserved, or has no modifier key at all (bare letter/number
    keys are too easy to trigger by accident while playing).

    Used both before registering a hotkey and live in the settings window
    while the user is typing a rebind.
    """
    normalized = hotkey.strip().lower()
    if not normalized:
        raise InvalidHotkeyError("Le raccourci ne peut pas être vide.")
    if normalized in _RESERVED_HOTKEYS:
        raise InvalidHotkeyError(f"« {hotkey} » est réservé par Windows, choisis-en un autre.")
    if "+" not in normalized:
        raise InvalidHotkeyError("Le raccourci doit inclure au moins une touche de modification (Ctrl, Maj, Alt).")

    import keyboard

    try:
        keyboard.parse_hotkey(normalized)
    except Exception as err:
        # Broad on purpose: `keyboard`'s parser can raise several exception
        # types depending on platform/backend/keyboard layout (e.g. a
        # missing OS-level lookup tool), and every one of them means the
        # same thing here -- this combo can't be registered on this machine.
        raise InvalidHotkeyError(f"Raccourci invalide : {err}") from err

    return normalized


class HotkeyManager:
    """Registers a single global hotkey and calls `on_trigger` (on
    `keyboard`'s own listener thread) each time it's pressed. Re-entrant
    `start()` calls (e.g. the settings window saving a rebind) atomically
    swap the registration rather than double-firing on the old one.
    """

    def __init__(self, on_trigger: Callable[[], None]) -> None:
        self._on_trigger = on_trigger
        self._lock = threading.Lock()
        self._registered: str | None = None
        self._last_error: str | None = None
        self._last_triggered_at: datetime | None = None

    @property
    def active_hotkey(self) -> str | None:
        with self._lock:
            return self._registered

    def snapshot(self) -> HotkeyStatus:
        with self._lock:
            return HotkeyStatus(
                registered_hotkey=self._registered,
                last_error=self._last_error,
                last_triggered_at=self._last_triggered_at,
            )

    def _handle_trigger(self) -> None:
        """What's actually registered with `keyboard.add_hotkey` -- stamps
        `last_triggered_at` *before* calling the real callback, so a press
        is recorded even if the callback itself is slow, superseded, or
        raises. This is what lets the settings window show "the hotkey was
        detected" as a signal independent of whether the resulting capture
        succeeded (see `draft_capture.capture_and_submit`, which can fail
        for reasons that have nothing to do with the hotkey itself, e.g. no
        game window found)."""
        with self._lock:
            self._last_triggered_at = datetime.now(timezone.utc)
        self._on_trigger()

    def start(self, hotkey: str) -> None:
        """Validates and registers `hotkey`, replacing any previously
        registered one. Logs and leaves nothing registered on failure (e.g.
        `keyboard` can't install its hook on this platform/permission
        level) rather than raising -- a broken hotkey must never crash the
        daemon's startup or a settings save. `snapshot().last_error` is how
        a caller (the settings window) finds out a failure happened at
        all -- see `HotkeyStatus`."""
        try:
            normalized = validate(hotkey)
        except InvalidHotkeyError as err:
            logger.error("Not registering draft hotkey: %s", err)
            with self._lock:
                self._last_error = str(err)
            return

        import keyboard

        with self._lock:
            self._unregister_locked()
            try:
                keyboard.add_hotkey(normalized, self._handle_trigger)
            except Exception as err:
                logger.exception("Failed to register global hotkey %r", normalized)
                self._last_error = str(err)
                return
            self._registered = normalized
            self._last_error = None
            logger.info("Registered live-draft capture hotkey: %s", normalized)

    def stop(self) -> None:
        with self._lock:
            self._unregister_locked()

    def _unregister_locked(self) -> None:
        if self._registered is None:
            return
        import keyboard

        try:
            keyboard.remove_hotkey(self._registered)
        except (KeyError, ValueError):
            pass
        logger.info("Unregistered live-draft capture hotkey: %s", self._registered)
        self._registered = None
