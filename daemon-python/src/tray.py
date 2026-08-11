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

import logging
import threading
from typing import Callable

import pystray
from PIL import Image, ImageDraw

logger = logging.getLogger(__name__)

_ICON_SIZE = 64
_ICON_BG = (28, 31, 46, 255)  # matches gui.py's _BG panel color
_ICON_FG = (108, 140, 255, 255)  # matches gui.py's _ACCENT color


def _build_icon_image() -> Image.Image:
    """Procedurally draws a simple round badge, so the build doesn't need to
    ship and correctly bundle a separate .ico asset through Nuitka."""
    image = Image.new("RGBA", (_ICON_SIZE, _ICON_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    margin = 4
    draw.ellipse((margin, margin, _ICON_SIZE - margin, _ICON_SIZE - margin), fill=_ICON_BG)
    inner_margin = _ICON_SIZE * 0.32
    draw.ellipse(
        (inner_margin, inner_margin, _ICON_SIZE - inner_margin, _ICON_SIZE - inner_margin), fill=_ICON_FG
    )
    return image


class TrayController:
    def __init__(self, on_open_settings: Callable[[], None], on_quit: Callable[[], None]) -> None:
        self._on_open_settings = on_open_settings
        self._on_quit = on_quit
        self._settings_open = threading.Lock()
        self._icon = pystray.Icon(
            name="hots-analytics",
            icon=_build_icon_image(),
            title="HotS Analytics — synchronisation active",
            menu=pystray.Menu(
                pystray.MenuItem("Ouvrir les paramètres", self._handle_open_settings, default=True),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Quitter", self._handle_quit),
            ),
        )

    def run(self) -> None:
        """Blocks for the app's whole lifetime, pumping the tray icon's message loop."""
        self._icon.run()

    def _handle_open_settings(self, _icon: pystray.Icon, _item: pystray.MenuItem) -> None:
        if self._settings_open.locked():
            logger.debug("Settings window already open, ignoring click.")
            return
        threading.Thread(target=self._run_settings, daemon=True, name="hots-settings-window").start()

    def _run_settings(self) -> None:
        with self._settings_open:
            self._on_open_settings()

    def _handle_quit(self, icon: pystray.Icon, _item: pystray.MenuItem) -> None:
        logger.info("Quit requested from the tray menu.")
        self._on_quit()
        icon.stop()
