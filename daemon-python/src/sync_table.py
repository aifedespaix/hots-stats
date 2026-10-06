"""The Sync tab's scrollable table: one row per replay, with its game, dates, result and upload
state (derived by sync_view.py), plus pause / "sync during game" controls and a button that
reveals the selected replay in Windows Explorer.

Only the first `PAGE_SIZE` rows are inserted; more are appended as the user scrolls, so a
library of 10 000 replays opens instantly. Refreshes are throttled and skipped while the user has
scrolled away from the top, so the list never jumps under their cursor mid-backlog.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import time
import tkinter as tk
from pathlib import Path
from tkinter import ttk
from typing import Callable, Sequence, TypeVar

from .config import open_path
from .sync_state import SyncState
from .sync_view import (
    STATE_LABELS,
    STATES,
    SyncRowView,
    build_views,
    count_by_state,
    filter_views,
    sort_views,
)
from .upload_scheduler import MODE_AUTO, MODE_PAUSED, SYNC_DURING_GAME_META_KEY, UploadScheduler

logger = logging.getLogger(__name__)

PAGE_SIZE = 500
# Caps the hover line under the table: error messages are unbounded, and the settings window has a
# fixed size that gui.py sizes with a worst-case line of exactly this length.
DETAIL_MAX_CHARS = 120
_REFRESH_MIN_SECONDS = 3.0
_ALL = "Toutes"
_COLUMNS = (
    ("label", "Partie", 230),
    ("played", "Date de la partie", 115),
    ("uploaded", "Date d'envoi", 115),
    ("result", "Résultat", 70),
    ("state", "Statut", 105),
    ("build", "Build", 55),
)
_STATE_COLORS = {
    "synced": "#4ec9a0",
    "uploading": "#6c8cff",
    "error": "#ef5b5b",
    "quarantined": "#e0a84e",
    "outdated": "#e0a84e",
    "pending": "#8b90ad",
    "skipped": "#8b90ad",
    "missing": "#8b90ad",
}

T = TypeVar("T")


def visible_page(views: Sequence[T], shown: int, page_size: int) -> list[T]:
    return list(views[shown : shown + page_size])


def explorer_select_args(path: str) -> list[str]:
    """Explorer needs `/select,<path>` as a *single* argument; passing it as a list (not a
    shell string) keeps spaces and accents in the path intact."""
    return ["explorer", f"/select,{os.path.normpath(path)}"]


def reveal_in_explorer(path: str) -> None:
    if sys.platform == "win32":
        try:
            # Explorer exits non-zero even when it worked, so the exit code is deliberately ignored.
            subprocess.Popen(explorer_select_args(path))
        except OSError:
            logger.warning("Could not open Explorer for %s", path, exc_info=True)
        return
    open_path(Path(path).parent)


class SyncTable(ttk.Frame):
    def __init__(
        self,
        parent: tk.Misc,
        *,
        sync_state: SyncState,
        scheduler: UploadScheduler | None,
        min_parser_version: Callable[[], str | None],
        dependency_required: Callable[[], str | None] = lambda: None,
        reveal: Callable[[str], None] = reveal_in_explorer,
        height: int = 6,
    ) -> None:
        super().__init__(parent)
        self._state = sync_state
        self._scheduler = scheduler
        self._min_version = min_parser_version
        self._dependency_required = dependency_required
        self._reveal = reveal
        self._all: list[SyncRowView] = []
        self._visible: list[SyncRowView] = []
        self._by_key: dict[str, SyncRowView] = {}
        self._shown = 0
        self._filter_state: str | None = None
        self._sort: tuple[str, bool] = ("played", True)
        self._last_refresh = 0.0
        self._signature: tuple | None = None
        self._page_pending = False
        self._filter_values: list[str] = []
        self._build(height)
        self.refresh(force=True)

    # -- layout ---------------------------------------------------------

    def _build(self, height: int) -> None:
        top = ttk.Frame(self)
        top.pack(fill="x", pady=(0, 6))
        ttk.Label(top, text="Afficher :").pack(side="left")
        self._filter_var = tk.StringVar(value=_ALL)
        self._filter_box = ttk.Combobox(top, textvariable=self._filter_var, state="readonly", width=24)
        self._filter_box.pack(side="left", padx=(6, 12))
        self._filter_box.bind("<<ComboboxSelected>>", self._on_filter)
        self._pause_button = ttk.Button(
            top, text="Mettre en pause", style="Warn.TButton", command=self._toggle_pause
        )
        self._pause_button.pack(side="right")
        if self._scheduler is None:
            self._pause_button.state(["disabled"])

        options = ttk.Frame(self)
        options.pack(fill="x")
        self._during_game = tk.BooleanVar(value=self._state.get_meta(SYNC_DURING_GAME_META_KEY) == "1")
        ttk.Checkbutton(
            options,
            text="Synchroniser pendant le jeu",
            variable=self._during_game,
            command=lambda: self._state.set_meta(
                SYNC_DURING_GAME_META_KEY, "1" if self._during_game.get() else "0"
            ),
        ).pack(side="left")
        self._blocked_label = ttk.Label(options, text="", style="Muted.TLabel")
        self._blocked_label.pack(side="right")

        # Shown (packed above the table) only while the daemon's heroprotocol is too old.
        self._banner = ttk.Label(self, text="", foreground="#e0a84e", wraplength=560, justify="left")

        body = ttk.Frame(self)
        body.pack(fill="both", expand=True, pady=(6, 0))
        self._tree = ttk.Treeview(
            body, columns=[c[0] for c in _COLUMNS], show="headings", height=height, selectmode="browse"
        )
        for key, title, width in _COLUMNS:
            self._tree.heading(key, text=title, command=lambda k=key: self._sort_by(k))
            self._tree.column(key, width=width, anchor="w", stretch=key == "label")
        for state, color in _STATE_COLORS.items():
            self._tree.tag_configure(state, foreground=color)
        self._vsb = ttk.Scrollbar(body, orient="vertical", command=self._tree.yview)
        self._tree.configure(yscrollcommand=self._on_yscroll)
        self._tree.pack(side="left", fill="both", expand=True)
        self._vsb.pack(side="right", fill="y")
        self._tree.bind("<Motion>", self._on_hover)
        self._tree.bind("<<TreeviewSelect>>", self._on_select)

        bottom = ttk.Frame(self)
        bottom.pack(fill="x", pady=(6, 0))
        self._detail = ttk.Label(bottom, text="", style="Muted.TLabel", wraplength=520, justify="left")  # 120 chars = 2 lines
        self._detail.pack(side="left", fill="x", expand=True)
        self._reveal_button = ttk.Button(
            bottom,
            text="Afficher dans l'explorateur",
            style="Secondary.TButton",
            command=self._reveal_selected,
        )
        self._reveal_button.pack(side="right")
        self._reveal_button.state(["disabled"])

    @property
    def detail_label(self) -> ttk.Label:
        """The hover line; exposed so the window can measure its worst case (see gui.py)."""
        return self._detail

    # -- data -----------------------------------------------------------

    def refresh(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_refresh < _REFRESH_MIN_SECONDS:
            return
        self._last_refresh = now
        snapshot = self._scheduler.snapshot() if self._scheduler is not None else None
        self._all = build_views(self._state.all_rows(), snapshot.live if snapshot else {}, self._min_version())
        self._update_filter_choices()
        self._update_controls(snapshot)
        if force or self._tree.yview()[0] == 0.0:
            self._reload(only_if_changed=not force)

    def _update_filter_choices(self) -> None:
        counts = count_by_state(self._all)
        values = [f"{_ALL} ({len(self._all)})"] + [
            f"{STATE_LABELS[s]} ({counts[s]})" for s in STATES if counts.get(s)
        ]
        if values != self._filter_values:
            self._filter_values = values
            self._filter_box.configure(values=values)
        current = STATE_LABELS.get(self._filter_state, None) if self._filter_state else None
        wanted = values[0] if current is None else f"{current} ({counts.get(self._filter_state, 0)})"
        if self._filter_var.get() != wanted:
            self._filter_var.set(wanted)

    def _update_controls(self, snapshot) -> None:
        required = self._dependency_required()
        if required:
            self._banner.configure(
                text=f"⚠ Mise à jour requise (heroprotocol ≥ {required}) : la synchronisation des anciennes "
                "parties est suspendue. Ouvrez l'onglet Mise à jour."
            )
            self._banner.pack(fill="x", before=self._tree.master, pady=(0, 6))
        else:
            self._banner.pack_forget()
        if snapshot is None:
            return
        paused = snapshot.mode == MODE_PAUSED
        self._pause_button.configure(
            text="Reprendre" if paused else "Mettre en pause",
            style="Success.TButton" if paused else "Warn.TButton",
        )
        reasons = {
            "auth": "Suspendu : jeton refusé",
            "paused": "En pause",
            "game": "En attente de la fin de la partie",
            "dependency": "Mise à jour requise avant de continuer",
        }
        self._blocked_label.configure(text=reasons.get(snapshot.blocked or "", ""))

    def _reload(self, only_if_changed: bool = False) -> None:
        visible = sort_views(
            filter_views(self._all, self._filter_state), self._sort[0], descending=self._sort[1]
        )
        signature = tuple(
            (v.key, v.state, v.label, v.played, v.uploaded, v.result, v.build) for v in visible
        )
        if only_if_changed and signature == self._signature:
            # Nothing the user can see changed: leave the tree (selection, scroll) alone.
            self._visible = visible
            self._by_key = {view.key: view for view in visible}
            return
        self._signature = signature
        self._visible = visible
        self._by_key = {view.key: view for view in visible}
        selected = self._tree.selection()
        self._tree.delete(*self._tree.get_children())
        self._shown = 0
        self._append_page()
        # The periodic refresh must not drop the user's selection; a row beyond the shown page
        # simply stays unselected.
        if selected and self._tree.exists(selected[0]):
            self._tree.selection_set(selected[0])
        self._sync_reveal_state()

    def _append_page(self) -> None:
        for view in visible_page(self._visible, self._shown, PAGE_SIZE):
            self._tree.insert(
                "",
                "end",
                iid=view.key,
                values=(view.label, view.played, view.uploaded, view.result, STATE_LABELS[view.state], view.build),
                tags=(view.state,),
            )
            self._shown += 1

    # -- events ---------------------------------------------------------

    def _on_yscroll(self, first: str, last: str) -> None:
        self._vsb.set(first, last)
        if float(last) >= 0.98 and self._shown < len(self._visible) and not self._page_pending:
            self._page_pending = True
            self.after_idle(self._append_page_once)

    def _append_page_once(self) -> None:
        self._page_pending = False
        self._append_page()

    def _on_filter(self, _event: object) -> None:
        chosen = self._filter_var.get().rsplit(" (", 1)[0]
        self._filter_state = next((s for s, label in STATE_LABELS.items() if label == chosen), None)
        self._reload()

    def _sort_by(self, column: str) -> None:
        descending = not self._sort[1] if self._sort[0] == column else column in ("played", "uploaded")
        self._sort = (column, descending)
        self._reload()

    def _toggle_pause(self) -> None:
        if self._scheduler is None:
            return
        self._scheduler.set_mode(MODE_AUTO if self._scheduler.mode == MODE_PAUSED else MODE_PAUSED)
        self.refresh(force=True)

    def _on_hover(self, event: tk.Event) -> None:
        view = self._by_key.get(self._tree.identify_row(event.y))
        if view is None:
            return
        name = Path(view.file_path).name
        text = f"{name} — {view.detail}" if view.detail else name
        if len(text) > DETAIL_MAX_CHARS:
            text = text[: DETAIL_MAX_CHARS - 1] + "…"
        self._detail.configure(text=text)

    def _on_select(self, _event: object) -> None:
        self._sync_reveal_state()

    def _sync_reveal_state(self) -> None:
        view = self._selected()
        enabled = view is not None and view.file_exists and bool(view.file_path)
        self._reveal_button.state(["!disabled"] if enabled else ["disabled"])

    def _selected(self) -> SyncRowView | None:
        selection = self._tree.selection()
        return self._by_key.get(selection[0]) if selection else None

    def _reveal_selected(self) -> None:
        view = self._selected()
        if view is not None and view.file_exists:
            self._reveal(view.file_path)
