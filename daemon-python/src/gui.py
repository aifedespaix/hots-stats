"""Settings window: shown on first run to collect the 3 required fields, and
reopenable from the tray to review/edit them (pre-filled) and see stats.

Plain tkinter + ttk, not customtkinter: tkinter is stdlib, so it needs
nothing extra bundled into the Nuitka build (see build-daemon.yml's
`--enable-plugin=tk-inter`) — ttk theming gets a clean enough look without
the extra packaging risk customtkinter's bundled theme/asset files add to a
`--onefile` build.

Laid out as a `ttk.Notebook` with one tab per concern (Config / Draft Live /
Synchronisation / Update) instead of one long scroll of stacked sections —
each tab's widgets are still built up front (not lazily on first select),
so the window's locked size (see `_center`) already accounts for every
tab's worst-case content and never resizes when switching between them.

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

from PIL import Image, ImageTk

from . import api_client, autostart, draft_capture, hotkey, updater
from .config import (
    DEFAULT_DRAFT_HOTKEY,
    config_file_path,
    default_replays_dir,
    open_config_folder,
    open_path,
    read_config_file,
    save_config,
)
from .constants import APP_VERSION
from .draft_capture import CapturePhase, DraftCaptureCoordinator
from .draft_layout import TeamCropResult
from .ocr import OcrResult
from .status import StatusTracker
from .sync_state import SyncState
from .updater import UpdatePhase, UpdateStatus, UpdateStatusTracker
from .urls import DEFAULT_API_BASE_URL, guess_settings_url

logger = logging.getLogger(__name__)

_DEBOUNCE_MS = 600
_LIVE_STATS_POLL_MS = 500

# Dynamic labels (currently-syncing filename, last sync error) are fed
# unbounded text from the filesystem/API — without a cap the window would
# keep growing to fit whatever comes in. Truncating to these lengths keeps
# the window's locked size (see `_center`) valid for any content it'll ever
# show.
_SYNCING_LABEL_MAX_CHARS = 60
_ERROR_LABEL_MAX_CHARS = 220
_SKIPPED_LABEL_MAX_CHARS = 110
_UPDATE_STATUS_MAX_CHARS = 90
_DRAFT_CAPTURE_STATUS_MAX_CHARS = 90
_TEST_CAPTURE_STATUS_MAX_CHARS = 90
_LABEL_WRAPLENGTH = 460

# How long the "Tester la capture" button waits, after being clicked, before
# actually taking the screenshot -- gives the player a moment to alt-tab to
# whatever window they actually want to test (the click itself leaves the
# settings window focused, which would otherwise be the only thing ever
# captured). See `_SettingsWindow._start_test_capture`.
_TEST_CAPTURE_DELAY_SECONDS = 3

# Display width (px) each of the 10 crop thumbnails is scaled to in the test
# capture's result window -- the raw crops are tiny (hand-tuned name-strip
# boxes, see draft_layout.py), so shown at native size they'd be nearly
# unreadable.
_TEST_CAPTURE_THUMB_WIDTH = 220

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

# Human-readable explanation per `parser.ReplaySkipped` / `IngestOutcome`
# skip-reason code (see `ingestion.py`/`sync_state.py`, which persist the
# same short codes) -- shown in the Debug report's "ignorées" section and
# next to the live counter on the Synchronisation tab. A new skip reason
# only needs an entry added here.
_SKIP_REASON_LABELS = {
    "ai_player": (
        "Partie avec un joueur IA (bot) — seules les parties entre joueurs réels sont synchronisées."
    ),
}


def _format_update_status(status: UpdateStatus) -> str:
    """Renders the updater's current phase as one French status line --
    including download progress, since a bare "downloading" gives no sense
    of whether it's about to finish or stuck."""
    if status.phase is UpdatePhase.CHECKING:
        return "Recherche de mise à jour…"
    if status.phase is UpdatePhase.AVAILABLE:
        return f"Mise à jour v{status.version} disponible"
    if status.phase is UpdatePhase.DOWNLOADING:
        pct = f" ({round(status.progress * 100)} %)" if status.progress is not None else ""
        return f"Téléchargement de la v{status.version}…{pct}"
    if status.phase is UpdatePhase.INSTALLING:
        return f"Installation de la v{status.version}, redémarrage…"
    if status.phase is UpdatePhase.ERROR:
        return f"✗ Échec de la mise à jour : {status.message}" if status.message else "✗ Échec de la mise à jour"
    return status.message or f"À jour (v{APP_VERSION})"


def _truncate(text: str, max_chars: int) -> str:
    """Caps `text` at `max_chars`, replacing anything cut off with an
    ellipsis, so a label fed unbounded text (a long file name, a verbose
    server error) can't keep growing the window it lives in."""
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


class _ProgressBarDriver:
    """Switches a `ttk.Progressbar` between determinate (a known 0-100%)
    and indeterminate ("something's happening, no ETA") modes to match an
    `UpdateStatus`, and idles it back to empty once the update is neither
    running nor pending. Used by both the settings window's Update tab and
    the standalone update-progress popup (see `run_update_progress_window`)
    so the two share one rendering of "what does this phase look like".
    """

    def __init__(self, bar: ttk.Progressbar) -> None:
        self._bar = bar
        self._animating = False

    def apply(self, status: UpdateStatus) -> None:
        if status.phase is UpdatePhase.DOWNLOADING and status.progress is not None:
            self._stop()
            self._bar.configure(mode="determinate", maximum=100)
            self._bar["value"] = round(status.progress * 100)
        elif status.phase in (UpdatePhase.CHECKING, UpdatePhase.INSTALLING) or (
            status.phase is UpdatePhase.DOWNLOADING and status.progress is None
        ):
            self._start()
        else:
            self._stop()
            self._bar.configure(mode="determinate")
            self._bar["value"] = 0

    def _start(self) -> None:
        if self._animating:
            return
        self._animating = True
        self._bar.configure(mode="indeterminate")
        self._bar.start(12)

    def _stop(self) -> None:
        if not self._animating:
            return
        self._animating = False
        self._bar.stop()


def run_settings_window(
    is_first_run: bool,
    status_tracker: StatusTracker | None = None,
    sync_state: SyncState | None = None,
    update_status: UpdateStatusTracker | None = None,
    draft_capture_status: DraftCaptureCoordinator | None = None,
) -> bool:
    """Opens the settings window and blocks (on the calling thread) until
    it's closed. Returns True if the user saved a valid configuration.

    `status_tracker`, when the daemon is already running (reopened from the
    tray), lets the Synchronisation tab show live found/synced/currently-
    syncing counts instead of just the one-off "games recorded" summary
    fetched from the API. `sync_state`, same condition, backs the Debug
    button's error report. `update_status`, same condition, backs the
    Update tab's live progress and lets its "Vérifier les mises à jour"
    button report back to something. `draft_capture_status`, same
    condition, backs the Draft Live tab's "capture in progress" indicator.
    """
    result = {"saved": False}
    root = tk.Tk()
    _SettingsWindow(
        root,
        is_first_run=is_first_run,
        result=result,
        status_tracker=status_tracker,
        sync_state=sync_state,
        update_status=update_status,
        draft_capture_status=draft_capture_status,
    )
    root.mainloop()
    return result["saved"]


def run_update_progress_window(update_status: UpdateStatusTracker, version: str) -> None:
    """A small, always-on-top standalone window shown while an update
    downloads/installs *without* the settings window open -- otherwise the
    only visible sign of an automatic update was the tray balloon
    (best-effort, silently dropped on failure) and then the app vanishing
    for a few seconds, which is exactly the "it just closes and tells you
    nothing" complaint this exists to fix.

    Blocks (on the calling thread, meant to be a dedicated one -- see
    app.py's `_on_update_found`) until the update finishes. On success the
    whole process exits from underneath this window (see
    `updater.apply_update_and_exit`), so there is nothing to close; on
    failure it shows the error and waits for the user to dismiss it.
    """
    root = tk.Tk()
    _UpdateProgressWindow(root, update_status, version)
    root.mainloop()


class _UpdateProgressWindow:
    def __init__(self, root: tk.Tk, update_status: UpdateStatusTracker, version: str) -> None:
        self._root = root
        self._update_status = update_status
        self._poll_job: str | None = None

        root.title("HotS Analytics — Mise à jour")
        root.configure(bg=_BG)
        root.resizable(False, False)
        root.attributes("-topmost", True)
        root.protocol("WM_DELETE_WINDOW", lambda: None)  # closes itself once done/failed

        outer = ttk.Frame(root, padding=20, style="TFrame")
        outer.pack(fill="both", expand=True)
        _apply_dark_style()

        ttk.Label(outer, text=f"Mise à jour v{version}", style="Title.TLabel").pack(anchor="w")
        self._status_label = ttk.Label(
            outer, text="", style="Muted.TLabel", wraplength=340, justify="left"
        )
        self._status_label.pack(anchor="w", pady=(6, 10))

        self._bar = ttk.Progressbar(outer, orient="horizontal", length=340, mode="indeterminate")
        self._bar.pack(fill="x")
        self._bar_driver = _ProgressBarDriver(self._bar)

        self._close_button = ttk.Button(outer, text="Fermer", style="Ghost.TButton", command=root.destroy)
        # Only shown on error -- on any other phase the process is either
        # still working or about to exit on its own (see `_poll`).
        self._close_button_visible = False

        root.update_idletasks()
        x = (root.winfo_screenwidth() - root.winfo_reqwidth()) - 24
        y = (root.winfo_screenheight() - root.winfo_reqheight()) - 80
        root.geometry(f"+{max(x, 0)}+{max(y, 0)}")

        self._poll()

    def _poll(self) -> None:
        status = self._update_status.snapshot()
        self._status_label.configure(text=_format_update_status(status))
        self._bar_driver.apply(status)

        if status.phase is UpdatePhase.ERROR:
            if not self._close_button_visible:
                self._close_button_visible = True
                self._close_button.pack(anchor="e", pady=(12, 0))
            return  # stop polling -- wait for the user to dismiss it

        self._poll_job = self._root.after(300, self._poll)


_style_built = False


def _apply_dark_style() -> None:
    """Builds the shared dark ttk theme once per process (both the main
    settings window and the standalone update-progress popup use it, and
    ttk styles are process-global -- rebuilding is harmless but wasteful)."""
    global _style_built
    style = ttk.Style()
    style.theme_use("clam")  # the only built-in theme that reliably honors custom colors everywhere
    if _style_built:
        return
    _style_built = True
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
    style.configure("TNotebook", background=_BG, borderwidth=0)
    style.configure(
        "TNotebook.Tab",
        background=_BG,
        foreground=_TEXT_MUTED,
        padding=(16, 8),
        font=("Segoe UI", 10),
        borderwidth=0,
    )
    style.map(
        "TNotebook.Tab",
        background=[("selected", _PANEL)],
        foreground=[("selected", _TEXT)],
    )
    style.configure("TProgressbar", background=_ACCENT, troughcolor=_FIELD_BG, borderwidth=0, thickness=8)


class _SettingsWindow:
    def __init__(
        self,
        root: tk.Tk,
        *,
        is_first_run: bool,
        result: dict,
        status_tracker: StatusTracker | None = None,
        sync_state: SyncState | None = None,
        update_status: UpdateStatusTracker | None = None,
        draft_capture_status: DraftCaptureCoordinator | None = None,
    ) -> None:
        self._root = root
        self._is_first_run = is_first_run
        self._result = result
        self._status_tracker = status_tracker
        self._sync_state = sync_state
        self._update_status = update_status
        self._draft_capture_status = draft_capture_status
        self._debounce_job: str | None = None
        self._live_stats_job: str | None = None
        self._update_status_job: str | None = None
        self._draft_capture_status_job: str | None = None
        self._test_capture_countdown_job: str | None = None
        self._test_capture_running = False
        self._hotkey_capturing = False
        # Flipped once the window starts closing (see `_on_close`/`_save`),
        # before `root.destroy()`. Background worker threads (the
        # connection/token checks, the hotkey-combo listener) can still be
        # mid-flight at that point; `_after_if_open` uses this to drop their
        # results instead of handing a destroyed Tk root/widget back to
        # `root.after`, which would otherwise raise from a thread nothing is
        # watching.
        self._closed = False

        root.title("HotS Analytics — Configuration")
        root.configure(bg=_BG)
        root.resizable(False, False)
        root.protocol("WM_DELETE_WINDOW", self._on_close)
        root.bind("<Escape>", lambda _e: self._on_close())

        _apply_dark_style()
        self._api_var = tk.StringVar()
        self._token_var = tk.StringVar()
        self._replays_var = tk.StringVar()

        self._build_ui()
        self._prefill()
        self._center()
        self._check_connection()
        if not is_first_run:
            self._load_stats()
            if self._status_tracker is not None:
                self._refresh_live_stats()
            # The Update tab (and `_update_status_label`/`_update_progress_bar`
            # it would refresh) only actually gets built when `IS_FROZEN` --
            # see `_build_ui` -- so this must stay in sync with that guard.
            if updater.IS_FROZEN and self._update_status is not None:
                self._refresh_update_status()
            if self._draft_capture_status is not None:
                self._refresh_draft_capture_status()

        root.after(50, lambda: self._api_entry.focus_set())

    # -- layout ---------------------------------------------------------

    def _build_tab(self, notebook: ttk.Notebook, title: str) -> ttk.Frame:
        tab = ttk.Frame(notebook, style="TFrame", padding=18)
        notebook.add(tab, text=title)
        return tab

    def _build_ui(self) -> None:
        outer = ttk.Frame(self._root, padding=24)
        outer.pack(fill="both", expand=True)

        header = ttk.Frame(outer, style="TFrame")
        header.pack(fill="x")
        ttk.Label(header, text="HotS Analytics", style="Title.TLabel").pack(side="left", anchor="w")
        ttk.Button(
            header, text="📁 Dossier de données", style="Ghost.TButton", command=self._open_data_folder
        ).pack(side="right")

        subtitle = (
            "Première configuration du daemon de synchronisation"
            if self._is_first_run
            else f"Paramètres du daemon de synchronisation · v{APP_VERSION}"
        )
        ttk.Label(outer, text=subtitle, style="Muted.TLabel").pack(anchor="w", pady=(2, 14))

        notebook = ttk.Notebook(outer)
        notebook.pack(fill="both", expand=True)

        self._build_config_tab(self._build_tab(notebook, "Config"))
        self._build_draft_tab(self._build_tab(notebook, "Draft Live"))
        self._build_sync_tab(self._build_tab(notebook, "Synchronisation"))
        if updater.IS_FROZEN:
            self._build_update_tab(self._build_tab(notebook, "Update"))

        self._error_label = ttk.Label(
            outer, text="", style="Muted.TLabel", foreground=_ERROR, wraplength=_LABEL_WRAPLENGTH, justify="left"
        )
        self._error_label.pack(anchor="w", pady=(10, 0))

        buttons = ttk.Frame(outer, style="TFrame")
        buttons.pack(fill="x", pady=(14, 0))
        if not self._is_first_run and self._sync_state is not None:
            ttk.Button(buttons, text="Debug", style="Ghost.TButton", command=self._open_debug_window).pack(
                side="left"
            )
        cancel_text = "Quitter" if self._is_first_run else "Annuler"
        ttk.Button(buttons, text=cancel_text, style="Ghost.TButton", command=self._on_close).pack(side="right")
        ttk.Button(buttons, text="Enregistrer", style="Accent.TButton", command=self._save).pack(
            side="right", padx=(0, 10)
        )
        self._root.bind("<Return>", lambda _e: self._save())

    def _open_data_folder(self) -> None:
        open_config_folder()

    def _after_if_open(self, func, *args) -> None:
        """`self._root.after(0, func, *args)`, but a no-op once the window
        has closed. Every call site is a background worker thread (a
        connection/token check, the hotkey-combo listener) handing a result
        back to the Tk thread -- those threads aren't cancelled when the
        window closes (there's no clean way to interrupt a blocking
        `requests.get`/`keyboard.read_hotkey` call), so without this guard a
        result that arrives after `_on_close`/`_save` already destroyed the
        root would either touch already-destroyed widgets or hand `after` a
        dead interpreter, raising from a thread nothing is watching instead
        of just being silently discarded like it should be.
        """
        if self._closed:
            return
        try:
            self._root.after(0, func, *args)
        except (RuntimeError, tk.TclError):
            pass

    # -- Config tab -------------------------------------------------------

    def _build_config_tab(self, parent: ttk.Frame) -> None:
        card = tk.Frame(parent, bg=_PANEL)
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

        if autostart.is_supported():
            self._autostart_var = tk.BooleanVar(value=autostart.is_enabled())
            autostart_check = self._checkbutton(
                card_inner,
                text="Lancer au démarrage de Windows (en arrière-plan, sans ouvrir cette fenêtre)",
                variable=self._autostart_var,
                command=self._on_autostart_toggled,
            )
            autostart_check.grid(row=grid_row + 1, column=0, columnspan=3, sticky="w", pady=(10, 0))

    def _checkbutton(self, parent, *, text: str, variable: tk.BooleanVar, command) -> tk.Checkbutton:
        """A `Checkbutton` styled to match the dark ttk theme (plain `tk`,
        not `ttk`, since ttk's checkbutton doesn't expose enough color
        knobs to blend in) -- factored out since every tab uses at least
        one of these with the same look."""
        return tk.Checkbutton(
            parent,
            text=text,
            variable=variable,
            command=command,
            bg=_PANEL,
            fg=_TEXT,
            selectcolor=_FIELD_BG,
            activebackground=_PANEL,
            activeforeground=_TEXT,
            highlightthickness=0,
            borderwidth=0,
            font=("Segoe UI", 9),
            anchor="w",
            wraplength=420,
            justify="left",
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

    # -- Draft Live tab -----------------------------------------------------

    def _build_draft_tab(self, parent: ttk.Frame) -> None:
        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x")
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")
        inner.grid_columnconfigure(0, weight=1, minsize=340)

        self._draft_enabled_var = tk.BooleanVar(value=True)
        enabled_check = self._checkbutton(
            inner,
            text="Activer la capture de draft en direct",
            variable=self._draft_enabled_var,
            command=self._on_draft_enabled_toggled,
        )
        enabled_check.grid(row=0, column=0, columnspan=3, sticky="w")

        ttk.Label(inner, text="Raccourci clavier", style="Panel.TLabel").grid(
            row=1, column=0, columnspan=3, sticky="w", pady=(14, 0)
        )
        self._draft_hotkey_var = tk.StringVar()

        hotkey_row = ttk.Frame(inner, style="Panel.TFrame")
        hotkey_row.grid(row=2, column=0, columnspan=3, sticky="w", pady=(4, 0))

        display_wrapper = tk.Frame(hotkey_row, bg=_FIELD_BG, highlightthickness=1, highlightbackground=_FIELD_BG)
        display_wrapper.pack(side="left")
        self._draft_hotkey_display = tk.Label(
            display_wrapper,
            textvariable=self._draft_hotkey_var,
            bg=_FIELD_BG,
            fg=_TEXT,
            font=("Segoe UI", 10, "bold"),
            padx=14,
            pady=8,
            width=22,
            anchor="w",
        )
        self._draft_hotkey_display.pack()

        self._draft_hotkey_record_btn = ttk.Button(
            hotkey_row, text="Modifier…", style="Ghost.TButton", command=self._start_hotkey_capture
        )
        self._draft_hotkey_record_btn.pack(side="left", padx=(10, 0))

        self._draft_hotkey_status = ttk.Label(inner, text="", style="PanelMuted.TLabel")
        self._draft_hotkey_status.grid(row=3, column=0, columnspan=3, sticky="w", pady=(6, 0))

        ttk.Label(
            inner,
            text=(
                "Cliquez sur « Modifier… » puis appuyez sur la combinaison de touches voulue "
                "(Échap pour annuler). Fonctionne même avec Heroes of the Storm en fenêtré ou "
                "plein écran (fenêtré)."
            ),
            style="PanelMuted.TLabel",
            wraplength=420,
            justify="left",
        ).grid(row=4, column=0, columnspan=3, sticky="w", pady=(10, 0))

        if self._draft_capture_status is not None:
            self._draft_capture_animating = False
            self._draft_capture_status_label = ttk.Label(inner, text="", style="PanelMuted.TLabel")
            self._draft_capture_status_label.grid(row=5, column=0, columnspan=3, sticky="w", pady=(14, 4))
            self._draft_capture_progress_bar = ttk.Progressbar(
                inner, orient="horizontal", length=200, mode="indeterminate"
            )
            # Not gridded here -- only shown while a capture is actually in
            # progress (see _refresh_draft_capture_status), so idle time
            # (almost always) doesn't show an empty bar doing nothing.

        # "Tester la capture" -- runs the same screenshot -> crop -> OCR
        # pipeline against whatever window has focus, without ever POSTing
        # anything, so a player can check hotkey/crop/OCR calibration
        # without needing to be mid-draft in an actual game (see
        # draft_capture.run_test_capture). Independent of the "Activer la
        # capture de draft en direct" checkbox above and of any saved
        # config -- available even on first run, before anything's saved.
        test_row = ttk.Frame(inner, style="Panel.TFrame")
        test_row.grid(row=7, column=0, columnspan=3, sticky="w", pady=(18, 0))
        self._test_capture_btn = ttk.Button(
            test_row, text="Tester la capture", style="Ghost.TButton", command=self._start_test_capture
        )
        self._test_capture_btn.pack(side="left")
        self._test_capture_status_label = ttk.Label(inner, text="", style="PanelMuted.TLabel")
        self._test_capture_status_label.grid(row=8, column=0, columnspan=3, sticky="w", pady=(6, 0))

    def _on_draft_enabled_toggled(self) -> None:
        state = "normal" if self._draft_enabled_var.get() else "disabled"
        self._draft_hotkey_record_btn.configure(state=state)
        if self._draft_enabled_var.get():
            self._check_draft_hotkey()
        else:
            self._set_status(self._draft_hotkey_status, "", _NEUTRAL)

    def _check_draft_hotkey(self) -> bool:
        value = self._draft_hotkey_var.get().strip()
        try:
            hotkey.validate(value)
        except hotkey.InvalidHotkeyError as err:
            self._set_status(self._draft_hotkey_status, _truncate(f"✗ {err}", 60), _ERROR)
            return False
        else:
            self._set_status(self._draft_hotkey_status, "✓ Raccourci valide", _OK)
            return True

    def _start_hotkey_capture(self) -> None:
        """Records a rebind by listening for the next real key combo instead
        of asking the user to type a syntax like "ctrl+shift+d" by hand --
        `keyboard.read_hotkey` (the same package already used to register
        the hotkey globally, see hotkey.py) blocks until a combo is pressed
        and released and returns it pre-formatted in exactly the string
        shape `hotkey.validate`/`keyboard.add_hotkey` expect. Runs on a
        worker thread since it blocks; the result is handed back to the Tk
        thread via `root.after`, same pattern as the connection checks.
        """
        if self._hotkey_capturing:
            return
        self._hotkey_capturing = True
        self._draft_hotkey_record_btn.configure(state="disabled")
        self._draft_hotkey_display.configure(fg=_ACCENT)
        self._set_status(self._draft_hotkey_status, "Appuyez sur une combinaison de touches… (Échap pour annuler)", _NEUTRAL)
        threading.Thread(target=self._capture_hotkey_worker, daemon=True, name="hots-hotkey-capture").start()

    def _capture_hotkey_worker(self) -> None:
        try:
            import keyboard

            combo = keyboard.read_hotkey(suppress=True)
            error: str | None = None
        except Exception as err:  # pragma: no cover -- exercised via error branch in tests
            combo = None
            error = str(err)
        self._after_if_open(self._finish_hotkey_capture, combo, error)

    def _finish_hotkey_capture(self, combo: str | None, error: str | None) -> None:
        self._hotkey_capturing = False
        self._draft_hotkey_record_btn.configure(state="normal")
        self._draft_hotkey_display.configure(fg=_TEXT)

        if error is not None:
            self._set_status(self._draft_hotkey_status, _truncate(f"✗ Capture impossible : {error}", 60), _ERROR)
            return
        if combo is None:
            return

        normalized = combo.strip().lower()
        if normalized in ("esc", "escape"):
            # A bare Escape has no modifier and would fail validation anyway
            # -- treat it as "cancel" rather than showing an error for what
            # is clearly meant as a cancel gesture.
            self._check_draft_hotkey()
            return

        self._draft_hotkey_var.set(normalized)
        self._check_draft_hotkey()

    def _refresh_draft_capture_status(self) -> None:
        """Polled while the window is open (see `__init__`/`_on_close`) so a
        hotkey-triggered capture is visible instead of the screenshot +
        crop + OCR + upload happening invisibly in the fraction of a second
        it takes -- there was previously no feedback at all beyond whatever
        eventually shows up on the dashboard's Live Draft page, which
        looked identical whether the hotkey had done nothing, failed, or
        was still working. A failure (no game window found, a
        screenshot/crop error) now stays visible in red instead of just
        being logged -- this is what used to look like "the hotkey is fine
        but nothing happens": something did happen, it just wasn't shown
        anywhere a player would see it.
        """
        assert self._draft_capture_status is not None
        status = self._draft_capture_status.snapshot()

        busy = status.phase in (CapturePhase.CAPTURING, CapturePhase.SUBMITTING)
        if not busy and self._draft_capture_animating:
            self._draft_capture_animating = False
            self._draft_capture_progress_bar.stop()
            self._draft_capture_progress_bar.grid_remove()
        elif busy and not self._draft_capture_animating:
            self._draft_capture_animating = True
            self._draft_capture_progress_bar.grid(row=6, column=0, columnspan=3, sticky="ew")
            self._draft_capture_progress_bar.start(12)

        if status.phase is CapturePhase.IDLE:
            self._set_status(self._draft_capture_status_label, "", _NEUTRAL)
        elif status.phase is CapturePhase.ERROR:
            message = status.message or "Échec de la capture."
            self._set_status(
                self._draft_capture_status_label, _truncate(f"✗ {message}", _DRAFT_CAPTURE_STATUS_MAX_CHARS), _ERROR
            )
        else:
            text = "Capture en cours…" if status.phase is CapturePhase.CAPTURING else "Envoi de la capture…"
            self._set_status(self._draft_capture_status_label, text, _NEUTRAL)

        self._draft_capture_status_job = self._root.after(_LIVE_STATS_POLL_MS, self._refresh_draft_capture_status)

    # -- Draft Live tab: "Tester la capture" ---------------------------------

    def _start_test_capture(self) -> None:
        if self._test_capture_running:
            return
        self._test_capture_running = True
        self._test_capture_btn.configure(state="disabled")
        self._test_capture_countdown(_TEST_CAPTURE_DELAY_SECONDS)

    def _test_capture_countdown(self, remaining: int) -> None:
        # Clicking the button leaves *this* window focused -- capturing
        # immediately would only ever screenshot the settings window itself.
        # This short countdown gives the player a moment to alt-tab to
        # whatever window they actually want to test (the game, or anything
        # else -- see `draft_capture.run_test_capture`).
        if remaining > 0:
            self._set_status(
                self._test_capture_status_label,
                f"Basculez vers la fenêtre à tester… capture dans {remaining}s",
                _NEUTRAL,
            )
            self._test_capture_countdown_job = self._root.after(
                1000, lambda: self._test_capture_countdown(remaining - 1)
            )
            return
        self._test_capture_countdown_job = None
        self._set_status(self._test_capture_status_label, "Capture en cours…", _NEUTRAL)
        threading.Thread(target=self._test_capture_worker, daemon=True, name="hots-test-capture").start()

    def _test_capture_worker(self) -> None:
        try:
            result = draft_capture.run_test_capture()
        except Exception as err:
            self._after_if_open(self._finish_test_capture, None, str(err))
            return
        self._after_if_open(self._finish_test_capture, result, None)

    def _finish_test_capture(
        self, result: draft_capture.TestCaptureResult | None, error: str | None
    ) -> None:
        self._test_capture_running = False
        self._test_capture_btn.configure(state="normal")

        if error is not None:
            self._set_status(
                self._test_capture_status_label, _truncate(f"✗ {error}", _TEST_CAPTURE_STATUS_MAX_CHARS), _ERROR
            )
            return
        assert result is not None
        self._set_status(self._test_capture_status_label, "✓ Capture terminée, voir la fenêtre de résultat.", _OK)
        self._open_test_capture_window(result)

    def _crop_to_photo(self, crop: Image.Image | None) -> ImageTk.PhotoImage | None:
        if crop is None or crop.width == 0 or crop.height == 0:
            return None
        scale = _TEST_CAPTURE_THUMB_WIDTH / crop.width
        resized = crop.resize((_TEST_CAPTURE_THUMB_WIDTH, max(1, round(crop.height * scale))), Image.LANCZOS)
        return ImageTk.PhotoImage(resized)

    def _open_test_capture_window(self, result: draft_capture.TestCaptureResult) -> None:
        win = tk.Toplevel(self._root)
        win.title("HotS Analytics — Test de capture")
        win.configure(bg=_BG)
        win.transient(self._root)

        body = ttk.Frame(win, padding=18)
        body.pack(fill="both", expand=True)

        # PhotoImage instances are garbage-collected by Tk the moment nothing
        # in Python still references them -- kept alive for the window's
        # whole lifetime by stashing them on it directly.
        photos: list[ImageTk.PhotoImage] = []
        win._test_capture_photos = photos  # type: ignore[attr-defined]

        def _build_team_column(title: str, team: TeamCropResult, ocr_results: list[OcrResult], column: int) -> None:
            padx = (0, 0) if column == 0 else (28, 0)
            ttk.Label(body, text=title, style="Title.TLabel").grid(row=0, column=column, sticky="w", padx=padx)
            for i, (crop, read) in enumerate(zip(team.player_crops, ocr_results), start=1):
                cell = ttk.Frame(body, style="TFrame")
                cell.grid(row=i, column=column, sticky="w", pady=(12, 0), padx=padx)

                photo = self._crop_to_photo(crop)
                if photo is not None:
                    photos.append(photo)
                    tk.Label(cell, image=photo, bg=_BG).pack(anchor="w")
                else:
                    tk.Label(cell, text="(pas de crop)", bg=_BG, fg=_TEXT_MUTED, font=("Segoe UI", 9)).pack(
                        anchor="w"
                    )

                ok = bool(read.text)
                text = read.text if ok else "— illisible —"
                ttk.Label(
                    cell,
                    text=f"Slot {i} : {text}  ({round(read.confidence * 100)} %)",
                    foreground=_OK if ok else _ERROR,
                    style="TLabel",
                ).pack(anchor="w")

        _build_team_column("Équipe gauche", result.left, result.left_results, 0)
        _build_team_column("Équipe droite", result.right, result.right_results, 1)

        ttk.Button(body, text="Fermer", style="Ghost.TButton", command=win.destroy).grid(
            row=6, column=0, columnspan=2, sticky="e", pady=(18, 0)
        )

    # -- Synchronisation tab ------------------------------------------------

    def _build_sync_tab(self, parent: ttk.Frame) -> None:
        if self._is_first_run:
            ttk.Label(
                parent,
                text="Les statistiques de synchronisation seront disponibles ici une fois le daemon lancé.",
                style="Muted.TLabel",
                wraplength=420,
                justify="left",
            ).pack(anchor="w")
            return

        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x")
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")

        ttk.Label(inner, text="Version daemon", style="PanelMuted.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(inner, text=APP_VERSION, style="Panel.TLabel").grid(row=1, column=0, sticky="w")

        ttk.Label(inner, text="Version API", style="PanelMuted.TLabel").grid(
            row=0, column=1, sticky="w", padx=(40, 0)
        )
        self._api_version_label = ttk.Label(inner, text="…", style="Panel.TLabel")
        self._api_version_label.grid(row=1, column=1, sticky="w", padx=(40, 0))

        ttk.Label(inner, text="Parties enregistrées", style="PanelMuted.TLabel").grid(
            row=0, column=2, sticky="w", padx=(40, 0)
        )
        self._games_count_label = ttk.Label(inner, text="…", style="Panel.TLabel")
        self._games_count_label.grid(row=1, column=2, sticky="w", padx=(40, 0))

        if self._status_tracker is not None:
            ttk.Label(inner, text="Trouvées dans le dossier", style="PanelMuted.TLabel").grid(
                row=0, column=3, sticky="w", padx=(40, 0)
            )
            self._found_count_label = ttk.Label(inner, text="…", style="Panel.TLabel")
            self._found_count_label.grid(row=1, column=3, sticky="w", padx=(40, 0))

            ttk.Label(inner, text="Progression de la synchronisation", style="PanelMuted.TLabel").grid(
                row=2, column=0, columnspan=4, sticky="w", pady=(16, 4)
            )
            self._sync_progress_bar = ttk.Progressbar(inner, orient="horizontal", mode="determinate", maximum=100)
            self._sync_progress_bar.grid(row=3, column=0, columnspan=4, sticky="ew")

            ttk.Label(inner, text="Synchronisées (cette session)", style="PanelMuted.TLabel").grid(
                row=4, column=0, sticky="w", pady=(14, 0)
            )
            self._synced_count_label = ttk.Label(inner, text="…", style="Panel.TLabel")
            self._synced_count_label.grid(row=5, column=0, sticky="w")

            ttk.Label(inner, text="En cours de synchronisation", style="PanelMuted.TLabel").grid(
                row=4, column=1, columnspan=3, sticky="w", pady=(14, 0), padx=(40, 0)
            )
            self._currently_syncing_label = ttk.Label(
                inner, text="—", style="Panel.TLabel", wraplength=_LABEL_WRAPLENGTH, justify="left"
            )
            self._currently_syncing_label.grid(row=5, column=1, columnspan=3, sticky="w", padx=(40, 0))

            self._skipped_count_label = ttk.Label(
                inner,
                text="",
                style="PanelMuted.TLabel",
                foreground=_NEUTRAL,
                wraplength=_LABEL_WRAPLENGTH,
                justify="left",
            )
            self._skipped_count_label.grid(row=6, column=0, columnspan=4, sticky="w", pady=(14, 0))

            self._sync_error_label = ttk.Label(
                inner,
                text="",
                style="PanelMuted.TLabel",
                foreground=_ERROR,
                wraplength=_LABEL_WRAPLENGTH,
                justify="left",
            )
            self._sync_error_label.grid(row=7, column=0, columnspan=4, sticky="w", pady=(6, 0))

    def _refresh_live_stats(self) -> None:
        assert self._status_tracker is not None
        status = self._status_tracker.snapshot()

        self._found_count_label.configure(text=str(status.found))
        self._synced_count_label.configure(
            text=f"{status.synced} ok" + (f", {status.failed} échouées" if status.failed else "")
        )
        if status.skipped_ai_player:
            # Already counted inside `synced` above (not a failure -- see
            # `DaemonStatus.skipped_ai_player`'s docstring), called out on
            # its own full-width row rather than appended to the narrow
            # "Synchronisées" column so a 3-digit count can't push the
            # "En cours de synchronisation" column past this window's fixed
            # size (see `_measure_worst_case_size`).
            self._skipped_count_label.configure(
                text=(
                    f"ℹ {status.skipped_ai_player} partie(s) avec un joueur IA non synchronisée(s) "
                    "volontairement (voir Debug pour le détail)."
                )
            )
        else:
            self._skipped_count_label.configure(text="")
        # A small pool of worker threads ingests the initial backlog (see
        # app.py's `_INITIAL_SYNC_WORKERS`), so more than one filename can be
        # "in progress" at once -- joined here rather than only ever showing
        # one of them and hiding the rest.
        if status.currently_syncing:
            syncing_text = _truncate(", ".join(sorted(status.currently_syncing)), _SYNCING_LABEL_MAX_CHARS)
        else:
            syncing_text = "—"
        self._currently_syncing_label.configure(text=syncing_text)

        done = status.synced + status.failed
        self._sync_progress_bar["value"] = round((done / status.found) * 100) if status.found else 0

        if status.last_error:
            error_text = _truncate(status.last_error, _ERROR_LABEL_MAX_CHARS)
            self._sync_error_label.configure(text=f"✗ Dernière erreur de synchronisation : {error_text}")
        else:
            self._sync_error_label.configure(text="")

        self._live_stats_job = self._root.after(_LIVE_STATS_POLL_MS, self._refresh_live_stats)

    # -- Update tab -----------------------------------------------------------

    def _build_update_tab(self, parent: ttk.Frame) -> None:
        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x")
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")
        inner.grid_columnconfigure(0, weight=1, minsize=340)

        self._auto_update_var = tk.BooleanVar(value=True)
        auto_update_check = self._checkbutton(
            inner,
            text="Mise à jour automatique (téléchargée et installée dès qu'elle est trouvée)",
            variable=self._auto_update_var,
            command=lambda: None,
        )
        auto_update_check.grid(row=0, column=0, columnspan=2, sticky="w")

        button_row = ttk.Frame(inner, style="Panel.TFrame")
        button_row.grid(row=1, column=0, columnspan=2, sticky="w", pady=(12, 0))

        if self._update_status is not None:
            self._check_update_button = ttk.Button(
                button_row,
                text="Vérifier les mises à jour",
                style="Accent.TButton",
                command=self._on_check_update_clicked,
            )
            self._check_update_button.pack(side="left")

        self._view_log_button = ttk.Button(
            button_row, text="Voir le journal", style="Ghost.TButton", command=self._open_update_log
        )
        self._view_log_button.pack(side="left", padx=(10, 0) if self._update_status is not None else (0, 0))

        if self._update_status is not None:
            self._update_status_label = ttk.Label(
                inner, text="", style="PanelMuted.TLabel", wraplength=420, justify="left"
            )
            self._update_status_label.grid(row=2, column=0, columnspan=2, sticky="w", pady=(12, 4))

            self._update_progress_bar = ttk.Progressbar(inner, orient="horizontal", mode="determinate", maximum=100)
            self._update_progress_bar.grid(row=3, column=0, columnspan=2, sticky="ew")
            self._update_progress_driver = _ProgressBarDriver(self._update_progress_bar)

        ttk.Label(
            inner,
            text=(
                "L'application n'est pas signée numériquement : au tout premier lancement d'un "
                "exécutable téléchargé, Windows SmartScreen peut afficher « Windows a protégé "
                "votre PC » — cliquez sur « Informations complémentaires » puis « Exécuter quand "
                "même ». Les mises à jour suivantes, elles, se relancent automatiquement sans "
                "repasser par cet écran."
            ),
            style="PanelMuted.TLabel",
            wraplength=420,
            justify="left",
        ).grid(row=4, column=0, columnspan=2, sticky="w", pady=(16, 0))

    def _on_check_update_clicked(self) -> None:
        assert self._update_status is not None
        self._check_update_button.configure(state="disabled")
        updater.trigger_manual_update(self._update_status)

    def _open_update_log(self) -> None:
        open_path(updater.update_log_file_path())

    def _refresh_update_status(self) -> None:
        assert self._update_status is not None
        status = self._update_status.snapshot()
        self._update_status_label.configure(text=_truncate(_format_update_status(status), _UPDATE_STATUS_MAX_CHARS))
        self._update_progress_driver.apply(status)

        busy = status.phase in (UpdatePhase.CHECKING, UpdatePhase.DOWNLOADING, UpdatePhase.INSTALLING)
        self._check_update_button.configure(state="disabled" if busy else "normal")

        self._update_status_job = self._root.after(_LIVE_STATS_POLL_MS, self._refresh_update_status)

    # -- prefill ----------------------------------------------------------

    def _prefill(self) -> None:
        if self._is_first_run:
            existing = {}
        else:
            existing = read_config_file()

        self._api_var.set(existing.get("apiBaseUrl") or DEFAULT_API_BASE_URL)
        self._token_var.set(existing.get("accessToken") or "")

        replays_dir = existing.get("replaysDir")
        if not replays_dir or not Path(replays_dir).is_dir():
            # Nothing saved, or the saved folder no longer exists (e.g. the
            # game/account moved) -- re-run autodetection rather than
            # prefilling a path that's known to be wrong. Left blank if that
            # doesn't find anything either, so the user browses manually.
            guessed = default_replays_dir()
            replays_dir = str(guessed) if guessed else ""
        self._replays_var.set(replays_dir)
        self._check_replays_dir()

        self._draft_enabled_var.set(bool(existing.get("draftFeatureEnabled", True)))
        self._draft_hotkey_var.set(existing.get("draftHotkey") or DEFAULT_DRAFT_HOTKEY)
        self._on_draft_enabled_toggled()

        if hasattr(self, "_auto_update_var"):
            self._auto_update_var.set(bool(existing.get("autoUpdateEnabled", True)))

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
        self._after_if_open(self._apply_api_status, reachable)

        if not reachable:
            # Can't tell if the token itself is valid without a reachable
            # API — leave it neutral rather than mislabeling it "invalid".
            self._after_if_open(self._apply_token_status, "unknown")
            return
        if not token:
            self._after_if_open(self._apply_token_status, "unknown")
            return

        summary = api_client.fetch_summary(base_url, token)
        self._after_if_open(self._apply_token_status, summary if summary is not None else "invalid")

        version_info = api_client.fetch_version(base_url, token)
        self._after_if_open(self._apply_api_version, version_info)

    def _apply_api_version(self, info: dict | None) -> None:
        if hasattr(self, "_api_version_label"):
            self._api_version_label.configure(text=str(info.get("apiVersion", "—")) if info else "—")

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
        self._after_if_open(lambda: self._games_count_label.configure(text=str(games)))

        version_info = api_client.fetch_version(base_url, token)
        self._after_if_open(self._apply_api_version, version_info)

    # -- debug report ---------------------------------------------------------

    def _open_debug_window(self) -> None:
        if self._sync_state is None:
            return
        records = self._sync_state.get_error_records()
        skipped = self._sync_state.get_skipped_records()
        report = self._format_debug_report(records, skipped)

        win = tk.Toplevel(self._root)
        title = f"HotS Analytics — Debug ({len(records)} erreur(s)"
        title += f", {len(skipped)} ignorée(s))" if skipped else ")"
        win.title(title)
        win.configure(bg=_BG)
        win.geometry("760x520")
        win.transient(self._root)

        body = ttk.Frame(win, padding=16)
        body.pack(fill="both", expand=True)

        text_frame = tk.Frame(body, bg=_FIELD_BG, highlightthickness=1, highlightbackground=_FIELD_BG)
        text_frame.pack(fill="both", expand=True)

        scrollbar = ttk.Scrollbar(text_frame, orient="vertical")
        text = tk.Text(
            text_frame,
            bg=_FIELD_BG,
            fg=_TEXT,
            insertbackground=_TEXT,
            relief="flat",
            wrap="word",
            font=("Consolas", 9),
            yscrollcommand=scrollbar.set,
        )
        scrollbar.configure(command=text.yview)
        scrollbar.pack(side="right", fill="y")
        text.pack(side="left", fill="both", expand=True, padx=(10, 0), pady=10)
        text.insert("1.0", report)
        text.configure(state="disabled")

        button_row = ttk.Frame(body, style="TFrame")
        button_row.pack(fill="x", pady=(12, 0))

        copy_status = ttk.Label(button_row, text="", style="Muted.TLabel")
        copy_status.pack(side="left")

        def _copy() -> None:
            win.clipboard_clear()
            win.clipboard_append(report)
            copy_status.configure(text="✓ Copié dans le presse-papiers")
            win.after(2000, lambda: copy_status.configure(text=""))

        ttk.Button(button_row, text="Fermer", style="Ghost.TButton", command=win.destroy).pack(side="right")
        ttk.Button(button_row, text="Copier", style="Accent.TButton", command=_copy).pack(
            side="right", padx=(0, 10)
        )

    def _format_debug_report(self, records: list, skipped: list) -> str:
        header = [f"HotS Analytics — rapport de debug — daemon v{APP_VERSION}", f"{len(records)} partie(s) en erreur"]
        if skipped:
            header.append(
                f"{len(skipped)} partie(s) ignorée(s) volontairement (pas des erreurs — détail plus bas)"
            )

        lines = [*header, ""]
        if not records:
            lines.append("Aucune erreur de synchronisation enregistrée.")
        else:
            for record in records:
                lines.append("-" * 70)
                lines.append(f"Fichier         : {record.file_path}")
                lines.append(f"Hash            : {record.replay_hash}")
                lines.append(f"Fichier présent : {'oui' if record.file_exists else 'non (déplacé ou supprimé)'}")
                lines.append(f"Dernière tentative : {record.last_attempt_at}")
                lines.append(f"Erreur          : {record.error_message or '(inconnue)'}")
                if record.error_log:
                    lines.append("Log complet :")
                    lines.append(record.error_log)
                lines.append("")

        if skipped:
            lines.append("=" * 70)
            lines.append(f"Parties ignorées volontairement ({len(skipped)}) — ce ne sont pas des erreurs :")
            lines.append("")
            for record in skipped:
                lines.append("-" * 70)
                lines.append(f"Fichier         : {record.file_path}")
                lines.append(f"Hash            : {record.replay_hash}")
                lines.append(f"Fichier présent : {'oui' if record.file_exists else 'non (déplacé ou supprimé)'}")
                lines.append(f"Dernière tentative : {record.last_attempt_at}")
                lines.append(f"Raison          : {_SKIP_REASON_LABELS.get(record.reason, record.reason)}")
                lines.append("")

        return "\n".join(lines)

    # -- autostart --------------------------------------------------------

    def _on_autostart_toggled(self) -> None:
        autostart.set_enabled(self._autostart_var.get())

    # -- misc ---------------------------------------------------------------

    def _set_status(self, label: ttk.Label, text: str, color: str) -> None:
        label.configure(text=text, foreground=color)

    def _open_token_link(self) -> None:
        webbrowser.open(guess_settings_url(self._api_var.get() or DEFAULT_API_BASE_URL))

    def _center(self) -> None:
        """Locks the window to a fixed size and centers it.

        Without an explicit "WxH", Tk keeps auto-growing the window every
        time a dynamic label's text changes (see `_refresh_live_stats`) --
        `resizable(False, False)` only blocks *manual* dragging, it doesn't
        stop that auto-layout growth. The size is computed from worst-case
        label content (see `_measure_worst_case_size`), not whatever
        happens to be showing right now, so it stays valid for anything
        those labels go on to display. `ttk.Notebook` sizes itself to fit
        its largest pane regardless of which tab is selected, so this
        already accounts for every tab's content, not just the active one.
        """
        width, height = self._measure_worst_case_size()
        x = (self._root.winfo_screenwidth() - width) // 2
        y = (self._root.winfo_screenheight() - height) // 3
        self._root.geometry(f"{width}x{height}+{x}+{y}")

    def _measure_worst_case_size(self) -> tuple[int, int]:
        """Temporarily fills every dynamically-updated label with
        max-length placeholder text, measures the window's required size
        with that worst case in place, then restores the real text.
        """
        placeholders: list[tuple[ttk.Label, str]] = [(self._error_label, "x" * _ERROR_LABEL_MAX_CHARS)]
        if self._status_tracker is not None:
            placeholders.append((self._currently_syncing_label, "x" * _SYNCING_LABEL_MAX_CHARS))
            placeholders.append((self._skipped_count_label, "x" * _SKIPPED_LABEL_MAX_CHARS))
            placeholders.append(
                (self._sync_error_label, "✗ Dernière erreur de synchronisation : " + "x" * _ERROR_LABEL_MAX_CHARS)
            )
        if hasattr(self, "_update_status_label"):
            placeholders.append((self._update_status_label, "x" * _UPDATE_STATUS_MAX_CHARS))
        if self._draft_capture_status is not None:
            # Can show an ERROR message up to _DRAFT_CAPTURE_STATUS_MAX_CHARS
            # long (see `_refresh_draft_capture_status`), not just the two
            # short fixed in-progress phrases -- same "x"*N filler pattern
            # as the other unbounded-text labels above.
            placeholders.append((self._draft_capture_status_label, "x" * _DRAFT_CAPTURE_STATUS_MAX_CHARS))
        placeholders.append((self._test_capture_status_label, "x" * _TEST_CAPTURE_STATUS_MAX_CHARS))

        originals = [(label, label.cget("text")) for label, _ in placeholders]
        for label, placeholder in placeholders:
            label.configure(text=placeholder)

        # The progress bar itself is normally hidden (grid_remove'd) until a
        # capture starts -- briefly showing it here too means its height is
        # already accounted for in the locked window size, so the window
        # doesn't need to grow the first time a real capture actually shows it.
        if self._draft_capture_status is not None:
            self._draft_capture_progress_bar.grid(row=6, column=0, columnspan=3, sticky="ew")

        self._root.update_idletasks()
        width, height = self._root.winfo_reqwidth(), self._root.winfo_reqheight()

        for label, original in originals:
            label.configure(text=original)
        if self._draft_capture_status is not None:
            self._draft_capture_progress_bar.grid_remove()

        return width, height

    def _save(self) -> None:
        if self._hotkey_capturing:
            self._show_error(
                "Terminez la capture du raccourci (appuyez sur une combinaison de touches, "
                "ou Échap pour annuler) avant d'enregistrer."
            )
            return

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

        draft_feature_enabled = self._draft_enabled_var.get()
        draft_hotkey = self._draft_hotkey_var.get().strip()
        if draft_feature_enabled:
            if not self._check_draft_hotkey():
                self._show_error("Le raccourci de capture de draft est invalide.")
                return
            draft_hotkey = hotkey.validate(draft_hotkey)
        elif not draft_hotkey:
            # Disabled with a blank field (e.g. never touched on first
            # run): keep a sane default around in case it's re-enabled later.
            draft_hotkey = DEFAULT_DRAFT_HOTKEY

        auto_update_enabled = self._auto_update_var.get() if hasattr(self, "_auto_update_var") else True

        save_config(
            api_base_url,
            access_token,
            replays_dir,
            draft_feature_enabled=draft_feature_enabled,
            draft_hotkey=draft_hotkey,
            auto_update_enabled=auto_update_enabled,
        )
        logger.info("Configuration saved to %s", config_file_path())
        self._result["saved"] = True
        self._stop_background_jobs()
        self._root.destroy()

    def _show_error(self, message: str) -> None:
        self._error_label.configure(text=_truncate(message, _ERROR_LABEL_MAX_CHARS))

    def _stop_background_jobs(self) -> None:
        # Marks the window as closing so `_after_if_open` drops any
        # still-in-flight worker-thread result instead of handing it to the
        # root we're about to destroy. Set here (the one place both `_save`
        # and `_on_close` call right before `root.destroy()`) rather than in
        # each of them separately.
        self._closed = True
        if self._live_stats_job is not None:
            self._root.after_cancel(self._live_stats_job)
            self._live_stats_job = None
        if self._update_status_job is not None:
            self._root.after_cancel(self._update_status_job)
            self._update_status_job = None
        if self._draft_capture_status_job is not None:
            self._root.after_cancel(self._draft_capture_status_job)
            self._draft_capture_status_job = None
        if self._test_capture_countdown_job is not None:
            self._root.after_cancel(self._test_capture_countdown_job)
            self._test_capture_countdown_job = None

    def _on_close(self) -> None:
        if self._hotkey_capturing:
            # `keyboard.read_hotkey()` (see `_capture_hotkey_worker`) is a
            # blocking call with no cancellation API: it keeps its low-level
            # hook installed, suppressing input, until the next key combo is
            # pressed -- whenever that is. Closing the window out from under
            # it wouldn't stop it; it would just mean the *next* keys the
            # player presses anywhere (e.g. an ability in the game itself)
            # get silently swallowed by that orphaned hook instead of a
            # rebind. Forcing the capture to finish (a combo, or Échap to
            # cancel) first is what actually releases the hook.
            messagebox.showinfo(
                "HotS Analytics",
                "Terminez la capture du raccourci (appuyez sur une combinaison de touches, "
                "ou Échap pour annuler) avant de fermer cette fenêtre.",
                parent=self._root,
            )
            return
        if self._is_first_run:
            if not messagebox.askyesno(
                "Quitter", "Aucune configuration n'a été enregistrée. Quitter quand même ?", parent=self._root
            ):
                return
        self._stop_background_jobs()
        self._root.destroy()
