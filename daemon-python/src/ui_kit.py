"""Design tokens and stdlib-tkinter primitives shared by the settings window
(`gui.py`). Kept dependency-free and, where possible, free of any real Tk
widget so its scaling/geometry logic can be unit-tested headless (CI has no
display server — see `daemon-python/tests/test_ui_kit.py`).
"""

from __future__ import annotations

import logging
import sys
from dataclasses import dataclass
from typing import Protocol

logger = logging.getLogger(__name__)

FONT_FAMILY = "Segoe UI"


@dataclass(frozen=True)
class Fonts:
    """Named, DPI-scaled fonts for the settings window. Base sizes (at
    scale 1.0, i.e. 96 DPI) match the hardcoded values `gui.py` used before
    this module existed, so switching a style over to one of these is a
    no-visual-change-at-96-DPI refactor."""

    body: tuple
    muted: tuple
    section: tuple
    title: tuple
    link: tuple
    button: tuple
    button_bold: tuple

    @classmethod
    def for_scale(cls, scale: float) -> "Fonts":
        def sized(base_size: int, *style: str) -> tuple:
            size = max(1, int(base_size * scale + 0.5))
            return (FONT_FAMILY, size, *style) if style else (FONT_FAMILY, size)

        return cls(
            body=sized(10),
            muted=sized(9),
            section=sized(9, "bold"),
            title=sized(15, "bold"),
            link=sized(9, "underline"),
            button=sized(10),
            button_bold=sized(10, "bold"),
        )


DEFAULT_FONTS = Fonts.for_scale(1.0)


class _WinfoFpixels(Protocol):
    def winfo_fpixels(self, distance: str) -> float: ...


def dpi_scale_factor(root: _WinfoFpixels) -> float:
    """Ratio of the display's actual DPI to the tkinter/Tcl baseline of 96.
    `root` is anything exposing `winfo_fpixels` (a real `tk.Tk`/`tk.Misc` in
    production; a stub in tests) so this stays headless-testable."""
    return root.winfo_fpixels("1i") / 96.0


# PROCESS_PER_MONITOR_DPI_AWARE, from Windows' shcore.h — not imported from
# anywhere since this repo has no Windows-specific typing stubs; the literal
# is documented stable API surface (Per-Monitor-V2 DPI awareness).
_PROCESS_PER_MONITOR_DPI_AWARE = 2


def set_dpi_awareness() -> None:
    """Opts the process into Per-Monitor-V2 DPI awareness, with a fallback
    to the older system-DPI-only API, so the settings window isn't
    bitmap-scaled (blurry) on a 125%/150% display. Must be called before
    any `tk.Tk()` is created (Windows ignores the call afterwards) — see
    `main.py`. Best-effort and never fatal: an unsupported/older Windows,
    or a process that already had awareness set by something else, is not
    an error worth stopping the daemon over."""
    if sys.platform != "win32":
        return
    import ctypes

    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(_PROCESS_PER_MONITOR_DPI_AWARE)
        return
    except (AttributeError, OSError) as err:
        logger.debug("SetProcessDpiAwareness unavailable, falling back: %s", err)

    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except (AttributeError, OSError) as err:
        logger.debug("SetProcessDPIAware also failed: %s", err)
