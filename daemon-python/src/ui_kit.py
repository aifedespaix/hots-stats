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


@dataclass(frozen=True)
class Palette:
    """A small, dark, "gamer tool" color set. Values match `gui.py`'s
    previous module-level color constants exactly (this is a no-visual-
    change extraction); B2 (widget kit) is where `warn` and a higher-
    contrast muted color get added, per the spec's Decision on scope."""

    bg: str
    panel: str
    field_bg: str
    field_bg_focus: str
    text: str
    text_muted: str
    accent: str
    ok: str
    error: str
    neutral: str


DEFAULT_PALETTE = Palette(
    bg="#1c1f2e",
    panel="#252a3d",
    field_bg="#2f3550",
    field_bg_focus="#394069",
    text="#e8eaf6",
    text_muted="#8b90ad",
    accent="#6c8cff",
    ok="#4cd97b",
    error="#ef5b5b",
    neutral="#8b90ad",
)


def mousewheel_scroll_units(delta: int) -> int:
    """Converts a Windows `<MouseWheel>` event's `delta` (a signed multiple
    of 120: positive = wheel up, negative = wheel down) into the number of
    `Canvas.yview_scroll` "units" to move, per the standard Tk recipe.
    Pure so it's testable without a real event/widget."""
    return int(-delta / 120)


class ScrollableFrame:
    """A vertically scrollable container: a `tk.Canvas` holding one inner
    `ttk.Frame` (`.content`), with a `ttk.Scrollbar` and mouse-wheel
    support. Every settings-window tab body lives in one of these (see
    `gui.py`'s `_build_tab`) instead of being sized to its worst-case
    content up front.

    Not unit-tested: constructing it requires a real Tk interpreter, which
    CI's headless runner doesn't have (see `mousewheel_scroll_units` above
    for the one piece of its logic that *is* pure). Verified by hand at
    multiple DPI scales and window sizes.
    """

    def __init__(self, parent: tk.Misc, *, background: str) -> None:
        import tkinter as tk
        from tkinter import ttk

        self.outer = tk.Frame(parent, bg=background)
        self._canvas = tk.Canvas(
            self.outer, background=background, highlightthickness=0, borderwidth=0
        )
        scrollbar = ttk.Scrollbar(
            self.outer, orient="vertical", command=self._canvas.yview
        )
        self._canvas.configure(yscrollcommand=scrollbar.set)
        self._canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        self.content = ttk.Frame(self._canvas, style="TFrame")
        self._content_window = self._canvas.create_window(
            (0, 0), window=self.content, anchor="nw"
        )

        self.content.bind("<Configure>", self._on_content_configure)
        self._canvas.bind("<Configure>", self._on_canvas_configure)
        self._canvas.bind("<Enter>", self._bind_mousewheel)
        self._canvas.bind("<Leave>", self._unbind_mousewheel)

    def _on_content_configure(self, _event: "tk.Event") -> None:
        self._canvas.configure(scrollregion=self._canvas.bbox("all"))

    def _on_canvas_configure(self, event: "tk.Event") -> None:
        # Keeps the inner frame exactly as wide as the visible canvas, so
        # content wraps/reflows on window resize instead of leaving a gap
        # or requiring horizontal scrolling.
        self._canvas.itemconfigure(self._content_window, width=event.width)

    def _bind_mousewheel(self, _event: "tk.Event") -> None:
        self._canvas.bind_all("<MouseWheel>", self._on_mousewheel)

    def _unbind_mousewheel(self, _event: "tk.Event") -> None:
        self._canvas.unbind_all("<MouseWheel>")

    def _on_mousewheel(self, event: "tk.Event") -> None:
        self._canvas.yview_scroll(mousewheel_scroll_units(event.delta), "units")
