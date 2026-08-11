"""Settings window: shown on first run to collect the 3 required fields, and
reopenable from the tray to review/edit them (pre-filled) and see stats.

Plain tkinter + ttk, not customtkinter: tkinter is stdlib, so it needs
nothing extra bundled into the Nuitka build (see build-daemon.yml's
`--enable-plugin=tk-inter`) — ttk theming gets a clean enough look without
the extra packaging risk customtkinter's bundled theme/asset files add to a
`--onefile` build.

Threading note: this module is only ever driven from a dedicated thread that
does nothing but run one `tk.Tk()` mainloop at a time (see tray.py) — never
from the same thread as pystray's own loop, and never two windows at once.
Background lookups (ping, token/stats check) run on worker threads and hand
their result back to the Tk thread via `root.after(...)`, which is the
documented thread-safe way to talk to a running mainloop from another
thread.
"""

from __future__ import annotations

import logging
import threading
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from . import api_client
from .config import config_file_path, default_replays_dir, read_config_file, save_config
from .constants import APP_VERSION
from .urls import DEFAULT_API_BASE_URL, guess_settings_url

logger = logging.getLogger(__name__)

_DEBOUNCE_MS = 600

# A small, dark, "gamer tool" palette. Kept in one place so the whole window
# reads as one deliberate look rather than default-tk gray.
_BG = "#1c1f2e"
_PANEL = "#252a3d"
_FIELD_BG = "#2f3550"
_FIELD_BG_FOCUS = "#394069"
_TEXT = "#e8eaf6"
_TEXT_MUTED = "#8b90ad"
_ACCENT = "#6c8cff"
_OK = "#4cd97b"
_ERROR = "#ef5b5b"
_NEUTRAL = "#8b90ad"


def run_settings_window(is_first_run: bool) -> bool:
    """Opens the settings window and blocks (on the calling thread) until
    it's closed. Returns True if the user saved a valid configuration."""
    result = {"saved": False}
    root = tk.Tk()
    _SettingsWindow(root, is_first_run=is_first_run, result=result)
    root.mainloop()
    return result["saved"]


class _SettingsWindow:
    def __init__(self, root: tk.Tk, *, is_first_run: bool, result: dict) -> None:
        self._root = root
        self._is_first_run = is_first_run
        self._result = result
        self._debounce_job: str | None = None

        root.title("HotS Analytics — Configuration")
        root.configure(bg=_BG)
        root.resizable(False, False)
        root.protocol("WM_DELETE_WINDOW", self._on_close)

        self._style = self._build_style()
        self._api_var = tk.StringVar()
        self._token_var = tk.StringVar()
        self._replays_var = tk.StringVar()

        self._build_ui()
        self._prefill()
        self._center()
        self._check_connection()
        if not is_first_run:
            self._load_stats()

        root.after(50, lambda: self._api_entry.focus_set())

    # -- layout ---------------------------------------------------------

    def _build_style(self) -> ttk.Style:
        style = ttk.Style()
        # "clam" is the only built-in ttk theme that reliably honors custom
        # colors on every platform; the default ("vista" on Windows) mostly
        # ignores background/foreground overrides.
        style.theme_use("clam")
        style.configure("TFrame", background=_BG)
        style.configure("Panel.TFrame", background=_PANEL)
        style.configure("TLabel", background=_BG, foreground=_TEXT, font=("Segoe UI", 10))
        style.configure("Panel.TLabel", background=_PANEL, foreground=_TEXT, font=("Segoe UI", 10))
        style.configure("Muted.TLabel", background=_BG, foreground=_TEXT_MUTED, font=("Segoe UI", 9))
        style.configure("PanelMuted.TLabel", background=_PANEL, foreground=_TEXT_MUTED, font=("Segoe UI", 9))
        style.configure("Title.TLabel", background=_BG, foreground=_TEXT, font=("Segoe UI", 15, "bold"))
        style.configure("Link.TLabel", background=_PANEL, foreground=_ACCENT, font=("Segoe UI", 9, "underline"))
        style.configure(
            "Accent.TButton",
            background=_ACCENT,
            foreground="#0f1220",
            font=("Segoe UI", 10, "bold"),
            padding=(14, 8),
            borderwidth=0,
        )
        style.map("Accent.TButton", background=[("active", "#8aa3ff"), ("disabled", "#3a4066")])
        style.configure(
            "Ghost.TButton",
            background=_BG,
            foreground=_TEXT_MUTED,
            font=("Segoe UI", 10),
            padding=(14, 8),
            borderwidth=0,
        )
        style.map("Ghost.TButton", background=[("active", _PANEL)])
        return style

    def _build_ui(self) -> None:
        outer = ttk.Frame(self._root, padding=24)
        outer.pack(fill="both", expand=True)

        ttk.Label(outer, text="HotS Analytics", style="Title.TLabel").pack(anchor="w")
        subtitle = (
            "Première configuration du daemon de synchronisation"
            if self._is_first_run
            else "Paramètres du daemon de synchronisation"
        )
        ttk.Label(outer, text=subtitle, style="Muted.TLabel").pack(anchor="w", pady=(2, 16))

        card = tk.Frame(outer, bg=_PANEL)
        card.pack(fill="x")
        card_inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        card_inner.pack(fill="x")
        card_inner.grid_columnconfigure(0, weight=1, minsize=340)

        # Each field consumes 2 grid rows (label, then entry); `grid_row`
        # tracks the next free row so fields, the token link, and the
        # browse button all stack without overlapping.
        self._api_entry, self._api_status, grid_row = self._build_field(
            card_inner,
            label="URL de l'API",
            var=self._api_var,
            start_row=0,
            on_change=self._on_api_or_token_changed,
        )

        self._token_entry, self._token_status, grid_row = self._build_field(
            card_inner,
            label="Token d'accès",
            var=self._token_var,
            start_row=grid_row,
            on_change=self._on_api_or_token_changed,
            show="•",
        )
        link = ttk.Label(card_inner, text="Générer / gérer mon token →", style="Link.TLabel", cursor="hand2")
        link.grid(row=grid_row, column=0, columnspan=3, sticky="w", pady=(0, 14))
        link.bind("<Button-1>", lambda _e: self._open_token_link())
        grid_row += 1

        self._replays_entry, self._replays_status, grid_row = self._build_field(
            card_inner,
            label="Dossier des replays",
            var=self._replays_var,
            start_row=grid_row,
            on_change=self._on_replays_changed,
        )
        browse = ttk.Button(card_inner, text="Parcourir…", style="Ghost.TButton", command=self._browse_replays_dir)
        browse.grid(row=grid_row, column=0, columnspan=3, sticky="w", pady=(0, 4))

        self._error_label = ttk.Label(outer, text="", style="Muted.TLabel", foreground=_ERROR)
        self._error_label.pack(anchor="w", pady=(10, 0))

        if not self._is_first_run:
            self._build_stats(outer)

        buttons = ttk.Frame(outer, style="TFrame")
        buttons.pack(fill="x", pady=(20, 0))
        cancel_text = "Quitter" if self._is_first_run else "Annuler"
        ttk.Button(buttons, text=cancel_text, style="Ghost.TButton", command=self._on_close).pack(side="right")
        ttk.Button(buttons, text="Enregistrer", style="Accent.TButton", command=self._save).pack(
            side="right", padx=(0, 10)
        )

    def _build_field(self, parent, *, label, var, start_row, on_change, show=None):
        """Grids a label + entry + status indicator starting at `start_row`.

        Returns `(entry, status_label, next_row)` so callers can chain
        fields one after another without recomputing row numbers.
        """
        ttk.Label(parent, text=label, style="Panel.TLabel").grid(
            row=start_row, column=0, columnspan=3, sticky="w"
        )

        entry_row = start_row + 1
        wrapper = tk.Frame(parent, bg=_FIELD_BG, highlightthickness=1, highlightbackground=_FIELD_BG)
        wrapper.grid(row=entry_row, column=0, sticky="ew", pady=(4, 14))

        entry = tk.Entry(
            wrapper,
            textvariable=var,
            bg=_FIELD_BG,
            fg=_TEXT,
            insertbackground=_TEXT,
            relief="flat",
            font=("Segoe UI", 10),
            show=show or "",
        )
        entry.pack(fill="x", padx=10, pady=8)
        entry.bind("<FocusIn>", lambda _e: wrapper.configure(bg=_FIELD_BG_FOCUS, highlightbackground=_ACCENT))
        entry.bind("<FocusOut>", lambda _e: wrapper.configure(bg=_FIELD_BG, highlightbackground=_FIELD_BG))
        entry.bind("<KeyRelease>", lambda _e: on_change())

        status = ttk.Label(parent, text="", style="PanelMuted.TLabel")
        status.grid(row=entry_row, column=1, columnspan=2, sticky="w", padx=(10, 0))

        return entry, status, entry_row + 1

    def _build_stats(self, parent) -> None:
        stats = tk.Frame(parent, bg=_PANEL)
        stats.pack(fill="x", pady=(16, 0))
        inner = ttk.Frame(stats, style="Panel.TFrame", padding=16)
        inner.pack(fill="x")

        ttk.Label(inner, text="Version", style="PanelMuted.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(inner, text=APP_VERSION, style="Panel.TLabel").grid(row=1, column=0, sticky="w")

        ttk.Label(inner, text="Parties enregistrées", style="PanelMuted.TLabel").grid(
            row=0, column=1, sticky="w", padx=(40, 0)
        )
        self._games_count_label = ttk.Label(inner, text="…", style="Panel.TLabel")
        self._games_count_label.grid(row=1, column=1, sticky="w", padx=(40, 0))

    # -- prefill ----------------------------------------------------------

    def _prefill(self) -> None:
        if self._is_first_run:
            existing = {}
        else:
            existing = read_config_file()

        self._api_var.set(existing.get("apiBaseUrl") or DEFAULT_API_BASE_URL)
        self._token_var.set(existing.get("accessToken") or "")

        replays_dir = existing.get("replaysDir")
        if not replays_dir:
            guessed = default_replays_dir()
            replays_dir = str(guessed) if guessed else ""
        self._replays_var.set(replays_dir)
        self._check_replays_dir()

    # -- validation: replays dir ------------------------------------------

    def _on_replays_changed(self) -> None:
        # A directory check is a cheap local filesystem stat, unlike the
        # network calls below — no need to debounce it.
        self._check_replays_dir()

    def _check_replays_dir(self) -> None:
        value = self._replays_var.get().strip()
        if not value:
            self._set_status(self._replays_status, "Sélectionnez un dossier", _ERROR)
            return
        if Path(value).is_dir():
            self._set_status(self._replays_status, "✓ Dossier trouvé", _OK)
        else:
            self._set_status(self._replays_status, "✗ Introuvable", _ERROR)

    def _browse_replays_dir(self) -> None:
        chosen = filedialog.askdirectory(title="Dossier des replays Heroes of the Storm")
        if chosen:
            self._replays_var.set(chosen)
        self._check_replays_dir()

    # -- validation: API + token (debounced) ------------------------------

    def _on_api_or_token_changed(self) -> None:
        self._set_status(self._api_status, "…", _NEUTRAL)
        self._set_status(self._token_status, "…", _NEUTRAL)
        if self._debounce_job is not None:
            self._root.after_cancel(self._debounce_job)
        self._debounce_job = self._root.after(_DEBOUNCE_MS, self._check_connection)

    def _check_connection(self) -> None:
        self._debounce_job = None
        base_url = self._api_var.get().strip()
        token = self._token_var.get().strip()
        if not base_url:
            self._set_status(self._api_status, "", _NEUTRAL)
            self._set_status(self._token_status, "", _NEUTRAL)
            return

        threading.Thread(target=self._check_connection_worker, args=(base_url, token), daemon=True).start()

    def _check_connection_worker(self, base_url: str, token: str) -> None:
        reachable = api_client.ping_health(base_url)
        self._root.after(0, self._apply_api_status, reachable)

        if not reachable:
            # Can't tell if the token itself is valid without a reachable
            # API — leave it neutral rather than mislabeling it "invalid".
            self._root.after(0, self._apply_token_status, "unknown")
            return
        if not token:
            self._root.after(0, self._apply_token_status, "unknown")
            return

        summary = api_client.fetch_summary(base_url, token)
        self._root.after(0, self._apply_token_status, summary if summary is not None else "invalid")

    def _apply_api_status(self, reachable: bool) -> None:
        if reachable:
            self._set_status(self._api_status, "✓ Connexion OK", _OK)
        else:
            self._set_status(self._api_status, "✗ Injoignable", _ERROR)

    def _apply_token_status(self, state: dict | str) -> None:
        if state == "unknown":
            self._set_status(self._token_status, "", _NEUTRAL)
        elif state == "invalid":
            self._set_status(self._token_status, "✗ Token invalide", _ERROR)
        else:
            self._set_status(self._token_status, "✓ Token valide", _OK)
            if hasattr(self, "_games_count_label"):
                self._games_count_label.configure(text=str(state.get("gamesPlayed", "—")))

    # -- stats (reopen only) ------------------------------------------------

    def _load_stats(self) -> None:
        existing = read_config_file()
        base_url = existing.get("apiBaseUrl")
        token = existing.get("accessToken")
        if base_url and token:
            threading.Thread(target=self._load_stats_worker, args=(base_url, token), daemon=True).start()

    def _load_stats_worker(self, base_url: str, token: str) -> None:
        summary = api_client.fetch_summary(base_url, token)
        games = summary.get("gamesPlayed", "—") if summary else "—"
        self._root.after(0, lambda: self._games_count_label.configure(text=str(games)))

    # -- misc ---------------------------------------------------------------

    def _set_status(self, label: ttk.Label, text: str, color: str) -> None:
        label.configure(text=text, foreground=color)

    def _open_token_link(self) -> None:
        webbrowser.open(guess_settings_url(self._api_var.get() or DEFAULT_API_BASE_URL))

    def _center(self) -> None:
        self._root.update_idletasks()
        width, height = self._root.winfo_reqwidth(), self._root.winfo_reqheight()
        x = (self._root.winfo_screenwidth() - width) // 2
        y = (self._root.winfo_screenheight() - height) // 3
        self._root.geometry(f"+{x}+{y}")

    def _save(self) -> None:
        api_base_url = self._api_var.get().strip()
        access_token = self._token_var.get().strip()
        replays_dir = self._replays_var.get().strip()

        if not api_base_url:
            self._show_error("L'URL de l'API est requise.")
            return
        if not access_token:
            self._show_error("Le token d'accès est requis.")
            return
        if not replays_dir or not Path(replays_dir).is_dir():
            self._show_error("Le dossier des replays est invalide ou introuvable.")
            return

        save_config(api_base_url, access_token, replays_dir)
        logger.info("Configuration saved to %s", config_file_path())
        self._result["saved"] = True
        self._root.destroy()

    def _show_error(self, message: str) -> None:
        self._error_label.configure(text=message)

    def _on_close(self) -> None:
        if self._is_first_run:
            if not messagebox.askyesno(
                "Quitter", "Aucune configuration n'a été enregistrée. Quitter quand même ?", parent=self._root
            ):
                return
        self._root.destroy()
