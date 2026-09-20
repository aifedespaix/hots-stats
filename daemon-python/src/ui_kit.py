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
