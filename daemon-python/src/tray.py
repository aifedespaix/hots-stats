"""System tray icon (pystray): reopen the settings window, or quit cleanly.

Threading model: `TrayController.run()` blocks on `pystray.Icon.run()`,
which pystray requires to be called from the main thread (mandatory on
macOS; we keep the same contract on Windows too rather than depend on a
platform-specific exception). Menu callbacks execute on that same thread's
message loop, so opening the settings window directly from a callback would
freeze the tray icon for as long as the window stayed open. Instead, each
"open settings" click spawns a short-lived thread that owns its own
`tk.Tk()` mainloop (see gui.py); a lock keeps two windows from ever being
open at once.
"""

from __future__ import annotations

import base64
import io
import logging
import threading
from typing import Callable

import pystray
from PIL import Image

from ._icon_data import TRAY_ICON_DARK_PNG_BASE64, TRAY_ICON_LIGHT_PNG_BASE64

logger = logging.getLogger(__name__)


def _taskbar_uses_light_theme() -> bool:
    """Whether the Windows taskbar/tray is light-themed (registry value
    `SystemUsesLightTheme`). Defaults to dark when it can't be read (older
    Windows, non-Windows dev machines)."""
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
        ) as key:
            return bool(winreg.QueryValueEx(key, "SystemUsesLightTheme")[0])
    except (ImportError, OSError):
        return False


def _build_icon_image() -> Image.Image:
    """Loads the app's icon (the web app's favicon, on a transparent
    background) in the palette matching the current taskbar theme, from the
    PNGs embedded in `_icon_data.py`. Embedded rather than a bundled data
    file so it survives Nuitka's --onefile packaging with no extra build flag.
    The theme is read once at startup; a switch mid-session shows on next launch."""
    encoded = (
        TRAY_ICON_LIGHT_PNG_BASE64
        if _taskbar_uses_light_theme()
        else TRAY_ICON_DARK_PNG_BASE64
    )
    return Image.open(io.BytesIO(base64.b64decode(encoded)))


class TrayController:
    def __init__(
        self,
        on_open_settings: Callable[[], None],
        on_quit: Callable[[], None],
        *,
        window_lock: threading.Lock | None = None,
    ) -> None:
        self._on_open_settings = on_open_settings
        self._on_quit = on_quit
        # Shared with app.py's standalone update-progress popup (see
        # `run_update_progress_window`) when a `window_lock` is passed in,
        # so the two never both try to own the process's one-at-a-time Tk
        # mainloop (see this module's docstring) -- opening the settings
        # window while an update toast is up, or vice versa, silently skips
        # rather than racing two `tk.Tk()` instances.
        self._settings_open = window_lock or threading.Lock()
        self._icon = pystray.Icon(
            name="hots-analytics",
            icon=_build_icon_image(),
            title="HotS Analytics - synchronisation active",
            menu=pystray.Menu(
                pystray.MenuItem(
                    "Ouvrir les paramètres", self._handle_open_settings, default=True
                ),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Quitter", self._handle_quit),
            ),
        )

    def run(self) -> None:
        """Blocks for the app's whole lifetime, pumping the tray icon's message loop."""
        self._icon.run()

    def notify(self, message: str, title: str | None = None) -> None:
        """Shows a balloon/toast notification from the tray icon. Best-effort:
        not every platform/backend pystray runs on supports notifications, so
        failures are logged and swallowed rather than raised -- a missed
        notification must never crash the caller (e.g. the auto-updater)."""
        try:
            self._icon.notify(message, title or "")
        except Exception:
            logger.debug("Tray notification failed (non-fatal)", exc_info=True)

    def open_settings(self) -> None:
        """Opens the settings window as a tray click would (no-op if one is already open)."""
        self._handle_open_settings(self._icon, None)

    def _handle_open_settings(
        self, _icon: pystray.Icon, _item: pystray.MenuItem
    ) -> None:
        if self._settings_open.locked():
            logger.debug("Settings window already open, ignoring click.")
            return
        threading.Thread(
            target=self._run_settings, daemon=True, name="hots-settings-window"
        ).start()

    def _run_settings(self) -> None:
        with self._settings_open:
            self._on_open_settings()

    def _handle_quit(self, icon: pystray.Icon, _item: pystray.MenuItem) -> None:
        logger.info("Quit requested from the tray menu.")
        self._on_quit()
        icon.stop()

    def quit(self) -> None:
        """Same as the tray menu's "Quitter", for callers outside the menu
        (the settings window's "Fermer" button)."""
        logger.info("Quit requested from the settings window.")
        self._on_quit()
        self._icon.stop()
