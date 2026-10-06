"""Reusable Tk widgets for the settings window (gui.py): a tab bar with icons,
a scrollable page, and a collapsible card. Also owns the palette, so the
widgets and gui.py can't drift apart."""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk
from typing import Callable

# A small, dark, "gamer tool" palette. Kept in one place so the whole window
# reads as one deliberate look rather than default-tk gray.
BG = "#1c1f2e"
PANEL = "#252a3d"
FIELD_BG = "#2f3550"
FIELD_BG_FOCUS = "#394069"
TEXT = "#e8eaf6"
TEXT_MUTED = "#8b90ad"
ACCENT = "#6c8cff"
OK = "#4cd97b"
ERROR = "#ef5b5b"
NEUTRAL = "#8b90ad"

_FONT = "Segoe UI"
_ICON_FONT = "Segoe UI Emoji"
_ANIM_STEPS = 10
_ANIM_STEP_MS = 14


def mix(color: str, other: str, amount: float) -> str:
    """`color` blended toward `other` by `amount` (0..1), as #rrggbb."""
    c = [int(color[i : i + 2], 16) for i in (1, 3, 5)]
    o = [int(other[i : i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(a + (b - a) * amount):02x}" for a, b in zip(c, o))


class ScrollPage(tk.Frame):
    """A vertically scrollable area. Put content in `.inner`; its width tracks
    the window and the scrollbar only shows when the content doesn't fit."""

    def __init__(self, parent: tk.Misc) -> None:
        super().__init__(parent, bg=BG)
        self._canvas = tk.Canvas(self, bg=BG, highlightthickness=0, borderwidth=0)
        self._vsb = ttk.Scrollbar(self, orient="vertical", command=self._canvas.yview)
        self._canvas.configure(yscrollcommand=self._on_yscroll)
        self._canvas.pack(side="left", fill="both", expand=True)
        self.inner = ttk.Frame(self._canvas, style="TFrame", padding=(4, 14, 4, 14))
        self._window = self._canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.inner.bind("<Configure>", self._on_inner_configure)
        self._canvas.bind("<Configure>", self._on_canvas_configure)
        self.bind("<Enter>", self._bind_wheel)
        self.bind("<Leave>", self._unbind_wheel)

    def fit_request_to_content(self) -> None:
        """Makes the page *request* its content's size, so a parent that sizes
        itself from its children (see `TabView`) accounts for the full page."""
        self.update_idletasks()
        self._canvas.configure(
            width=self.inner.winfo_reqwidth(), height=self.inner.winfo_reqheight()
        )

    def _on_inner_configure(self, _event: tk.Event) -> None:
        self._canvas.configure(scrollregion=self._canvas.bbox("all"))
        self._update_scrollbar()

    def _on_canvas_configure(self, event: tk.Event) -> None:
        self._canvas.itemconfigure(self._window, width=event.width)
        self._update_scrollbar()

    def _update_scrollbar(self) -> None:
        needed = self.inner.winfo_reqheight() > self._canvas.winfo_height() > 1
        if needed and not self._vsb.winfo_ismapped():
            self._vsb.pack(side="right", fill="y")
        elif not needed and self._vsb.winfo_ismapped():
            self._vsb.pack_forget()
            self._canvas.yview_moveto(0)

    def _on_yscroll(self, first: str, last: str) -> None:
        self._vsb.set(first, last)

    def _bind_wheel(self, _event: tk.Event) -> None:
        self.bind_all("<MouseWheel>", self._on_wheel)

    def _unbind_wheel(self, event: tk.Event) -> None:
        # <Leave> also fires when entering a child; only unbind on a real exit.
        x, y = self.winfo_pointerxy()
        if self.winfo_containing(x, y) is not None and str(self.winfo_containing(x, y)).startswith(str(self)):
            return
        self.unbind_all("<MouseWheel>")

    def _on_wheel(self, event: tk.Event) -> None:
        if not self._vsb.winfo_ismapped():
            return
        # Widgets with their own scrolling (the sync table) keep the wheel.
        if getattr(event.widget, "winfo_class", lambda: "")() in ("Treeview", "Listbox", "Text"):
            return
        self._canvas.yview_scroll(-1 * (event.delta // 120), "units")


class TabView(tk.Frame):
    """A tab bar (icon + label, accent underline on the active tab, hover
    feedback) over stacked pages. Same `add`/`tab` surface as `ttk.Notebook`
    for what gui.py uses. Sized from its largest page, like a Notebook."""

    def __init__(self, parent: tk.Misc) -> None:
        super().__init__(parent, bg=BG)
        self._bar = tk.Frame(self, bg=BG)
        self._bar.pack(fill="x")
        tk.Frame(self, bg=FIELD_BG, height=1).pack(fill="x")
        self._stack = tk.Frame(self, bg=BG)
        self._stack.pack(fill="both", expand=True)
        self._stack.grid_rowconfigure(0, weight=1)
        self._stack.grid_columnconfigure(0, weight=1)
        self._tabs: dict[tk.Misc, dict] = {}
        self._selected: tk.Misc | None = None

    def add(self, page: tk.Misc, *, text: str, icon: str = "") -> None:
        cell = tk.Frame(self._bar, bg=BG, cursor="hand2")
        cell.pack(side="left", padx=(0, 4))
        icon_label = tk.Label(cell, text=icon, bg=BG, fg=TEXT_MUTED, font=(_ICON_FONT, 12))
        text_label = tk.Label(cell, text=text, bg=BG, fg=TEXT_MUTED, font=(_FONT, 10, "bold"))
        icon_label.pack(side="left", padx=(14, 6), pady=(10, 8))
        text_label.pack(side="left", padx=(0, 14), pady=(10, 8))
        underline = tk.Frame(cell, bg=BG, height=3)
        underline.place(relx=0, rely=1.0, relwidth=1.0, anchor="sw")
        info = {
            "cell": cell,
            "labels": (icon_label, text_label),
            "underline": underline,
        }
        self._tabs[page] = info
        for widget in (cell, icon_label, text_label):
            widget.bind("<Button-1>", lambda _e, p=page: self.select(p))
            widget.bind("<Enter>", lambda _e, p=page: self._paint(p, hover=True))
            widget.bind("<Leave>", lambda _e, p=page: self._paint(p, hover=False))
        page.grid(in_=self._stack, row=0, column=0, sticky="nsew")
        if self._selected is None:
            self.select(page)
        else:
            page.grid_remove()

    def tab(self, page: tk.Misc, *, text: str) -> None:
        self._tabs[page]["labels"][1].configure(text=text)

    def select(self, page: tk.Misc) -> None:
        previous = self._selected
        self._selected = page
        if previous is not None and previous is not page:
            previous.grid_remove()
            self._paint(previous)
        page.grid()
        page.tkraise()
        self._paint(page)

    def _paint(self, page: tk.Misc, hover: bool = False) -> None:
        info = self._tabs[page]
        active = page is self._selected
        bg = mix(BG, ACCENT, 0.12) if hover and not active else BG
        fg = TEXT if active or hover else TEXT_MUTED
        info["cell"].configure(bg=bg)
        for label in info["labels"]:
            label.configure(bg=bg, fg=ACCENT if active and label is info["labels"][0] else fg)
        info["underline"].configure(bg=ACCENT if active else bg)


class CollapsibleCard(tk.Frame):
    """A panel whose whole header toggles it, with an animated fold and a
    chevron on the left (▾ open / ▸ folded). Content goes in `.body`."""

    def __init__(
        self,
        parent: tk.Misc,
        title: str,
        icon: str = "",
        *,
        expanded: bool = True,
        on_toggle: Callable[[bool], None] | None = None,
    ) -> None:
        super().__init__(parent, bg=PANEL)
        self._on_toggle = on_toggle
        self._expanded = expanded
        self._anim_job: str | None = None

        self._header = tk.Frame(self, bg=PANEL, cursor="hand2")
        self._header.pack(fill="x")
        self._chevron = tk.Label(
            self._header, text="▾" if expanded else "▸", bg=PANEL, fg=ACCENT, font=(_FONT, 11, "bold"), width=2
        )
        self._chevron.pack(side="left", padx=(12, 0), pady=12)
        self._icon = tk.Label(self._header, text=icon, bg=PANEL, fg=TEXT, font=(_ICON_FONT, 11))
        if icon:
            self._icon.pack(side="left", padx=(2, 6))
        self._title = tk.Label(
            self._header, text=title, bg=PANEL, fg=TEXT_MUTED, font=(_FONT, 9, "bold"), anchor="w"
        )
        # Right-aligned slot for controls that belong to the card (e.g. a pause
        # button). Packed before the title so the title's expand can't squeeze it,
        # and left out of the toggle bindings below so clicking a control in it
        # doesn't fold the card.
        self.header_actions = tk.Frame(self._header, bg=PANEL)
        self.header_actions.pack(side="right", padx=(0, 12))
        self._title.pack(side="left", fill="x", expand=True)
        for widget in (self._header, self._chevron, self._icon, self._title):
            widget.bind("<Button-1>", lambda _e: self.toggle())
            widget.bind("<Enter>", lambda _e: self._paint_header(True))
            widget.bind("<Leave>", lambda _e: self._paint_header(False))

        # `_clip` crops `body` while its height is animated.
        self._clip = tk.Frame(self, bg=PANEL)
        self.body = ttk.Frame(self._clip, style="Panel.TFrame", padding=(18, 2, 18, 18))
        self.body.pack(fill="x", anchor="n")
        if expanded:
            self._clip.pack(fill="x")

    @property
    def expanded(self) -> bool:
        return self._expanded

    def toggle(self) -> None:
        self.set_expanded(not self._expanded)

    def set_expanded(self, expanded: bool, animate: bool = True) -> None:
        if expanded == self._expanded:
            return
        self._expanded = expanded
        self._chevron.configure(text="▾" if expanded else "▸")
        if self._anim_job is not None:
            self.after_cancel(self._anim_job)
            self._anim_job = None
        self.update_idletasks()
        full = self.body.winfo_reqheight()
        start = self._clip.winfo_height() if self._clip.winfo_ismapped() else 0
        end = full if expanded else 0
        if not animate or start == end:
            self._finish(expanded)
        else:
            self._clip.pack_propagate(False)
            self._clip.pack(fill="x")
            self._step(start, end, 0)
        if self._on_toggle is not None:
            self._on_toggle(expanded)

    def _step(self, start: int, end: int, i: int) -> None:
        i += 1
        t = i / _ANIM_STEPS
        eased = 1 - (1 - t) ** 3
        self._clip.configure(height=max(1, round(start + (end - start) * eased)))
        if i >= _ANIM_STEPS:
            self._anim_job = None
            self._finish(self._expanded)
            return
        self._anim_job = self.after(_ANIM_STEP_MS, self._step, start, end, i)

    def _finish(self, expanded: bool) -> None:
        if expanded:
            self._clip.pack_propagate(True)
            self._clip.pack(fill="x")
        else:
            self._clip.pack_forget()
            self._clip.pack_propagate(True)

    def _paint_header(self, hover: bool) -> None:
        bg = mix(PANEL, ACCENT, 0.10) if hover else PANEL
        for widget in (self._header, self._chevron, self._icon, self._title, self.header_actions):
            widget.configure(bg=bg)
        self._title.configure(fg=TEXT if hover else TEXT_MUTED)
