"""Settings window: shown on first run to collect the 3 required fields, and
reopenable from the tray to review/edit them (pre-filled) and see stats.

Plain tkinter + ttk, not customtkinter: tkinter is stdlib, so it needs
nothing extra bundled into the Nuitka build (see build-daemon.yml's
`--enable-plugin=tk-inter`) — ttk theming gets a clean enough look without
the extra packaging risk customtkinter's bundled theme/asset files add to a
`--onefile` build.

Laid out as a `ttk.Notebook` with one tab per concern (Synchronisation / Draft Live / Config) instead of one long scroll of stacked sections —
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
from datetime import datetime, timezone
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Callable

from PIL import Image, ImageTk

from . import api_client, auth_flow, autostart, draft_capture, hotkey, updater
from .accounts_discovery import discover_account_folders
from .config import (
    DEFAULT_DRAFT_HOTKEY,
    clear_access_token,
    config_file_path,
    default_hots_dir,
    open_config_folder,
    open_path,
    read_config_file,
    save_config,
)
from .constants import APP_VERSION
from ._icon_data import TRAY_ICON_PNG_BASE64
from .gui_widgets import (
    ACCENT as _ACCENT,
    BG as _BG,
    ERROR as _ERROR,
    FIELD_BG as _FIELD_BG,
    FIELD_BG_FOCUS as _FIELD_BG_FOCUS,
    NEUTRAL as _NEUTRAL,
    OK as _OK,
    PANEL as _PANEL,
    TEXT as _TEXT,
    TEXT_MUTED as _TEXT_MUTED,
    CollapsibleCard,
    ScrollPage,
    TabView,
    Tooltip,
    mix as _mix,
)
from .draft_capture import CapturePhase, DraftCaptureCoordinator
from .draft_layout import TeamCropResult
from .ocr import OcrResult
from .status import StatusTracker
from .sync_state import SyncState
from .sync_layout import progress_summary, recap_columns
from .sync_table import DETAIL_MAX_CHARS, SyncTable
from .updater import UpdatePhase, UpdateStatus, UpdateStatusTracker
from .dependency_guard import DependencyGuard
from .upload_scheduler import UploadScheduler
from .gui_onboarding import OnboardingHooks, OnboardingView
from .onboarding import View, describe_replays_dir, initial_view, view_after_token_check
from .urls import DEFAULT_API_BASE_URL, guess_settings_url, guess_token_page_url, guess_web_base_url

logger = logging.getLogger(__name__)

_DEBOUNCE_MS = 600
_AUTOSAVE_MS = 600
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

# Human-readable explanation per `parser.ReplaySkipped` / `IngestOutcome`
# skip-reason code (see `ingestion.py`/`sync_state.py`, which persist the
# same short codes) -- shown in the Debug report's "ignorées" section and
# next to the live counter on the Synchronisation tab. A new skip reason
# only needs an entry added here.
_SKIP_REASON_LABELS = {
    "ai_player": (
        "Partie avec un joueur IA (bot) — seules les parties entre joueurs réels sont synchronisées."
    ),
    "incomplete_game": (
        "Partie sans résultat (probablement un Bac à sable/entraînement laissé inachevé) — "
        "seules les parties allées à leur terme sont synchronisées."
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
        pct = (
            f" ({round(status.progress * 100)} %)"
            if status.progress is not None
            else ""
        )
        return f"Téléchargement de la v{status.version}…{pct}"
    if status.phase is UpdatePhase.INSTALLING:
        return f"Installation de la v{status.version}, redémarrage…"
    if status.phase is UpdatePhase.ERROR:
        return (
            f"✗ Échec de la mise à jour : {status.message}"
            if status.message
            else "✗ Échec de la mise à jour"
        )
    return status.message or f"À jour (v{APP_VERSION})"


def _truncate(text: str, max_chars: int) -> str:
    """Caps `text` at `max_chars`, replacing anything cut off with an
    ellipsis, so a label fed unbounded text (a long file name, a verbose
    server error) can't keep growing the window it lives in."""
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def _format_time_ago(moment: datetime) -> str:
    """Renders a past UTC timestamp as a short relative French phrase (e.g.
    "il y a 12s") for the Draft Live tab's "dernier appui détecté" line."""
    seconds = int((datetime.now(timezone.utc) - moment).total_seconds())
    if seconds < 60:
        return f"il y a {max(seconds, 0)}s"
    minutes = seconds // 60
    if minutes < 60:
        return f"il y a {minutes} min"
    hours = minutes // 60
    return f"il y a {hours} h"


class _ProgressBarDriver:
    """Switches a `ttk.Progressbar` between determinate (a known 0-100%)
    and indeterminate ("something's happening, no ETA") modes to match an
    `UpdateStatus`, and idles it back to empty once the update is neither
    running nor pending. Used by both the settings window's Config update section and
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
    hotkey_manager: "hotkey.HotkeyManager | None" = None,
    on_manual_capture: Callable[[], None] | None = None,
    scheduler: UploadScheduler | None = None,
    dependency_guard: DependencyGuard | None = None,
    on_quit: Callable[[], None] | None = None,
    on_logout: Callable[[], None] | None = None,
    on_reconnected: Callable[[], None] | None = None,
    require_login: bool = False,
) -> bool:
    """Opens the settings window and blocks (on the calling thread) until
    it's closed. Returns True if the user saved a valid configuration.

    `status_tracker`, when the daemon is already running (reopened from the
    tray), lets the Synchronisation tab show live found/synced/currently-
    syncing counts instead of just the one-off "games recorded" summary
    fetched from the API. `sync_state`, same condition, backs the Debug
    button's error report. `update_status`, same condition, backs the
    Config's update section's live progress and lets its "Vérifier les mises à jour"
    button report back to something. `draft_capture_status`, same
    condition, backs the Draft Live tab's "capture in progress" indicator.

    `hotkey_manager`, same condition, backs the Draft Live tab's real
    registration status (error message, last-triggered timestamp) and its
    "Réessayer" action. `on_manual_capture`, same condition, is what the
    Draft Live tab's "Capturer maintenant" button calls to trigger a real
    (non-dry-run) capture on demand. `scheduler`, same condition, backs the
    Synchronisation tab's pause button and its live pending/uploading rows.

    Settings are written as they change, so there is no save button: the
    return value is True if any change was written. `on_quit`, when given,
    is what the "Fermer" button calls (after closing the window) to stop the
    whole daemon; "Réduire" just closes the window.

    `on_logout`, when given, is called when the user signs out from the
    Config tab (stop the watcher: nothing may sync without a token).
    `on_reconnected` is called when the onboarding wizard finishes a
    reconnection, just before the window closes, so the caller can restart
    the watcher and reopen the full window. `require_login` marks a startup
    window that must not close without a token.
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
        hotkey_manager=hotkey_manager,
        on_manual_capture=on_manual_capture,
        scheduler=scheduler,
        dependency_guard=dependency_guard,
        on_quit=on_quit,
        on_logout=on_logout,
        on_reconnected=on_reconnected,
        require_login=require_login,
    )
    root.mainloop()
    return result["saved"]


def run_update_progress_window(
    update_status: UpdateStatusTracker, version: str
) -> None:
    """A small, always-on-top standalone window shown while an update
    downloads/installs *without* the settings window open -- otherwise the
    only visible sign of an automatic update was the tray balloon
    (best-effort, silently dropped on failure) and then the app vanishing
    for a few seconds, which is exactly the "it just closes and tells you
    nothing" complaint this exists to fix.

    Blocks (on the calling thread, meant to be a dedicated one -- see
    app.py's `_on_update_found`) until the update finishes. On success the
    whole process is replaced from underneath this window (Velopack's
    `apply_updates_and_restart`, see `updater.perform_update`), so there is
    nothing to close; on failure it shows the error and waits for the user to
    dismiss it.
    """
    root = tk.Tk()
    _UpdateProgressWindow(root, update_status, version)
    root.mainloop()


class _UpdateProgressWindow:
    def __init__(
        self, root: tk.Tk, update_status: UpdateStatusTracker, version: str
    ) -> None:
        self._root = root
        self._update_status = update_status
        self._poll_job: str | None = None

        root.title("HotS Analytics - Mise à jour")
        root.configure(bg=_BG)
        _set_window_icon(root)
        root.resizable(False, False)
        root.attributes("-topmost", True)
        root.protocol(
            "WM_DELETE_WINDOW", lambda: None
        )  # closes itself once done/failed

        outer = ttk.Frame(root, padding=20, style="TFrame")
        outer.pack(fill="both", expand=True)
        _apply_dark_style()

        ttk.Label(outer, text=f"Mise à jour v{version}", style="Title.TLabel").pack(
            anchor="w"
        )
        self._status_label = ttk.Label(
            outer, text="", style="Muted.TLabel", wraplength=340, justify="left"
        )
        self._status_label.pack(anchor="w", pady=(6, 10))

        self._bar = ttk.Progressbar(
            outer, orient="horizontal", length=340, mode="indeterminate"
        )
        self._bar.pack(fill="x")
        self._bar_driver = _ProgressBarDriver(self._bar)

        # Only shown when the error carries a `manual_fallback_path`, which
        # since the Velopack migration is always `None`: Velopack owns its
        # own download/apply staging directory, so there is no longer a
        # locally-staged build this app could point the player at (see
        # `updater.UpdateStatus.manual_fallback_path`). Kept, inert, because
        # that field is still part of the type and this widget is guarded on
        # it -- delete both together if the field ever goes.
        self._fallback_path: Path | None = None
        self._open_fallback_button = ttk.Button(
            outer,
            text="📁 Ouvrir le dossier",
            style="Secondary.TButton",
            command=self._open_fallback_folder,
        )

        # Shown, prominently, alongside the failure -- a fallback with a
        # completely different failure surface than the automatic Velopack
        # install that just failed (see `updater.release_page_url`):
        # downloading `hots-analytics-daemon-Setup.exe` from the release page
        # in a browser and running it, unaffected by whatever blocked the
        # in-place install (antivirus, Smart App Control, a locked file).
        self._manual_download_button = ttk.Button(
            outer,
            text="⬇ Mise à jour manuelle",
            style="Warn.TButton",
            command=lambda: webbrowser.open(updater.release_page_url()),
        )

        self._close_button = ttk.Button(
            outer, text="Fermer", style="Danger.TButton", command=root.destroy
        )
        # Only shown on error -- on any other phase the process is either
        # still working or about to exit on its own (see `_poll`).
        self._close_button_visible = False

        root.update_idletasks()
        x = (root.winfo_screenwidth() - root.winfo_reqwidth()) - 24
        y = (root.winfo_screenheight() - root.winfo_reqheight()) - 80
        root.geometry(f"+{max(x, 0)}+{max(y, 0)}")

        self._poll()

    def _open_fallback_folder(self) -> None:
        if self._fallback_path is not None:
            open_path(self._fallback_path.parent)

    def _poll(self) -> None:
        status = self._update_status.snapshot()
        self._status_label.configure(text=_format_update_status(status))
        self._bar_driver.apply(status)

        if status.phase is UpdatePhase.ERROR:
            if not self._close_button_visible:
                self._close_button_visible = True
                self._manual_download_button.pack(anchor="e", pady=(12, 4))
                if status.manual_fallback_path is not None:
                    self._fallback_path = status.manual_fallback_path
                    self._open_fallback_button.pack(anchor="e", pady=(0, 4))
                    self._close_button.pack(anchor="e")
                else:
                    self._close_button.pack(anchor="e", pady=(0, 0))
            return  # stop polling -- wait for the user to dismiss it

        self._poll_job = self._root.after(300, self._poll)


# Button variants: (base color, text color on a solid fill). Each gets a solid
# style `<Name>.TButton` and an outlined one `<Name>.Ghost.TButton` (transparent
# fill on the window background, border + text in the variant color).
_BUTTON_VARIANTS = {
    "Primary": (_ACCENT, "#0f1220"),
    "Secondary": (_FIELD_BG, _TEXT),
    "Info": ("#4fa3f7", "#0b1220"),
    "Success": (_OK, "#0b1a10"),
    "Warn": ("#e0a84e", "#1c1405"),
    "Danger": (_ERROR, "#1f0808"),
}


def _configure_button_styles(style: ttk.Style) -> None:
    font = ("Segoe UI", 10)
    padding = (14, 7)
    disabled_fg = "#5d6280"
    style.configure(
        "TButton", font=font, padding=padding, borderwidth=1, focuscolor=_BG
    )
    for name, (base, on_base) in _BUTTON_VARIANTS.items():
        hover = _mix(base, "#ffffff", 0.14)
        pressed = _mix(base, "#000000", 0.18)
        secondary = name == "Secondary"
        solid_fg = _TEXT if secondary else on_base
        if secondary:
            hover = _FIELD_BG_FOCUS
            pressed = _mix(_FIELD_BG, "#000000", 0.2)
        solid = f"{name}.TButton"
        style.configure(
            solid,
            background=base,
            foreground=solid_fg,
            bordercolor=base,
            lightcolor=base,
            darkcolor=base,
            focuscolor=base,
            font=font,
            padding=padding,
        )
        style.map(
            solid,
            background=[("disabled", _PANEL), ("pressed", pressed), ("active", hover)],
            bordercolor=[("disabled", _PANEL), ("pressed", pressed), ("active", hover)],
            lightcolor=[("pressed", pressed), ("active", hover)],
            darkcolor=[("pressed", pressed), ("active", hover)],
            foreground=[("disabled", disabled_fg)],
        )
        ghost = f"{name}.Ghost.TButton"
        edge = _TEXT_MUTED if secondary else base
        text = _TEXT_MUTED if secondary else base
        style.configure(
            ghost,
            background=_BG,
            foreground=text,
            bordercolor=edge,
            lightcolor=edge,
            darkcolor=edge,
            borderwidth=1,
            focuscolor=_BG,
            font=font,
            padding=padding,
        )
        tint = _mix(_BG, edge, 0.16)
        tint_pressed = _mix(_BG, edge, 0.3)
        style.map(
            ghost,
            background=[("disabled", _BG), ("pressed", tint_pressed), ("active", tint)],
            bordercolor=[("disabled", _PANEL)],
            lightcolor=[("disabled", _PANEL)],
            darkcolor=[("disabled", _PANEL)],
            foreground=[("disabled", disabled_fg), ("active", _TEXT if secondary else base)],
        )
    # Icon-only footer buttons (their meaning comes from a Tooltip): the
    # Secondary ghost look, compact and with an emoji-capable font.
    style.configure("Icon.Secondary.Ghost.TButton", padding=(9, 6), font=("Segoe UI Emoji", 12))


def _set_window_icon(root: tk.Tk) -> None:
    """The tray icon, as the window/taskbar icon (instead of Tk's feather).
    `default=True` also covers every Toplevel opened later."""
    photo = tk.PhotoImage(data=TRAY_ICON_PNG_BASE64)
    root.iconphoto(True, photo)
    root._hots_icon = photo  # type: ignore[attr-defined]  # Tk drops unreferenced images


def _apply_dark_style() -> None:
    """Builds the shared dark ttk theme -- called every time a window is
    created (the settings window and the standalone update-progress popup
    both use it, and each is its own `tk.Tk()`).

    This used to skip rebuilding after the first call, on the assumption
    that ttk styles are process-global. They aren't: each `tk.Tk()` spins up
    its own independent Tcl interpreter with its own, freshly-defaulted ttk
    style database, so a style configured on the first window's interpreter
    has no effect on a later window's -- only `style.theme_use("clam")`
    (selecting a *built-in* theme, resolved by name against every
    interpreter) carried over. In practice this meant only the very first
    window opened in a run ever got the dark palette; every window after
    that (closing and reopening Settings from the tray, for instance) fell
    back to plain ttk "clam" defaults -- a much lighter look than the rest
    of the UI -- which is exactly the "reopens light instead of dark" bug
    this now fixes. Rebuilding is cheap (a couple dozen `style.configure`
    calls), so there's no real cost to doing it on every window open."""
    style = ttk.Style()
    style.theme_use(
        "clam"
    )  # the only built-in theme that reliably honors custom colors everywhere
    style.configure("TFrame", background=_BG)
    style.configure("Panel.TFrame", background=_PANEL)
    style.configure("TLabel", background=_BG, foreground=_TEXT, font=("Segoe UI", 10))
    style.configure(
        "Panel.TLabel", background=_PANEL, foreground=_TEXT, font=("Segoe UI", 10)
    )
    style.configure(
        "Muted.TLabel", background=_BG, foreground=_TEXT_MUTED, font=("Segoe UI", 9)
    )
    style.configure(
        "PanelMuted.TLabel",
        background=_PANEL,
        foreground=_TEXT_MUTED,
        font=("Segoe UI", 9),
    )
    style.configure(
        "SectionHeader.TLabel",
        background=_PANEL,
        foreground=_TEXT_MUTED,
        font=("Segoe UI", 9, "bold"),
    )
    style.configure(
        "Title.TLabel", background=_BG, foreground=_TEXT, font=("Segoe UI", 15, "bold")
    )
    style.configure(
        "Link.TLabel",
        background=_PANEL,
        foreground=_ACCENT,
        font=("Segoe UI", 9, "underline"),
    )
    _configure_button_styles(style)
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
    style.configure(
        "TProgressbar",
        background=_ACCENT,
        troughcolor=_FIELD_BG,
        borderwidth=0,
        thickness=8,
    )
    # Sync tab widgets (sync_table.py): plain ttk "clam" defaults are light.
    style.configure(
        "Treeview",
        background=_PANEL,
        fieldbackground=_PANEL,
        foreground=_TEXT,
        bordercolor=_PANEL,
        lightcolor=_PANEL,
        darkcolor=_PANEL,
        borderwidth=0,
        rowheight=24,
        font=("Segoe UI", 9),
    )
    style.map(
        "Treeview",
        background=[("selected", _FIELD_BG_FOCUS)],
        foreground=[("selected", _TEXT)],
    )
    style.configure(
        "Treeview.Heading",
        background=_FIELD_BG,
        foreground=_TEXT_MUTED,
        bordercolor=_BG,
        lightcolor=_FIELD_BG,
        darkcolor=_FIELD_BG,
        relief="flat",
        padding=(6, 4),
        font=("Segoe UI", 9, "bold"),
    )
    style.map(
        "Treeview.Heading",
        background=[("active", _FIELD_BG_FOCUS)],
        foreground=[("active", _TEXT)],
    )
    style.configure(
        "TCheckbutton",
        background=_BG,
        foreground=_TEXT,
        indicatorbackground=_FIELD_BG,
        indicatorforeground=_ACCENT,
        focuscolor=_BG,
        font=("Segoe UI", 10),
    )
    style.map(
        "TCheckbutton",
        background=[("active", _BG)],
        indicatorbackground=[("selected", _FIELD_BG), ("active", _FIELD_BG_FOCUS)],
    )
    style.configure(
        "TCombobox",
        fieldbackground=_FIELD_BG,
        background=_FIELD_BG,
        foreground=_TEXT,
        arrowcolor=_TEXT,
        bordercolor=_FIELD_BG,
        lightcolor=_FIELD_BG,
        darkcolor=_FIELD_BG,
        selectbackground=_FIELD_BG,
        selectforeground=_TEXT,
    )
    style.map(
        "TCombobox",
        fieldbackground=[("readonly", _FIELD_BG)],
        foreground=[("readonly", _TEXT)],
        background=[("active", _FIELD_BG_FOCUS)],
    )
    style.configure(
        "Vertical.TScrollbar",
        background=_FIELD_BG,
        troughcolor=_PANEL,
        bordercolor=_PANEL,
        lightcolor=_FIELD_BG,
        darkcolor=_FIELD_BG,
        arrowcolor=_TEXT_MUTED,
    )
    style.map("Vertical.TScrollbar", background=[("active", _FIELD_BG_FOCUS)])
    # The combobox dropdown is a plain tk Listbox, outside ttk styling.
    root = style.master
    root.option_add("*TCombobox*Listbox.background", _FIELD_BG)
    root.option_add("*TCombobox*Listbox.foreground", _TEXT)
    root.option_add("*TCombobox*Listbox.selectBackground", _ACCENT)
    root.option_add("*TCombobox*Listbox.selectForeground", "#0f1220")


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
        hotkey_manager: "hotkey.HotkeyManager | None" = None,
        on_manual_capture: Callable[[], None] | None = None,
        scheduler: UploadScheduler | None = None,
        dependency_guard: DependencyGuard | None = None,
        on_quit: Callable[[], None] | None = None,
        on_logout: Callable[[], None] | None = None,
        on_reconnected: Callable[[], None] | None = None,
        require_login: bool = False,
    ) -> None:
        self._root = root
        self._on_quit = on_quit
        self._on_logout = on_logout
        self._on_reconnected = on_reconnected
        self._require_login = require_login
        self._autosave_job: str | None = None
        # What's currently on disk (None until the first successful write on a
        # first run), so an autosave that wouldn't change anything is skipped.
        self._last_saved: tuple | None = None
        self._is_first_run = is_first_run
        self._result = result
        self._status_tracker = status_tracker
        self._sync_state = sync_state
        self._update_status = update_status
        self._draft_capture_status = draft_capture_status
        self._hotkey_manager = hotkey_manager
        self._on_manual_capture = on_manual_capture
        self._scheduler = scheduler
        self._dependency_guard = dependency_guard
        self._debounce_job: str | None = None
        self._live_stats_job: str | None = None
        self._sync_table: SyncTable | None = None
        self._update_status_job: str | None = None
        self._draft_capture_status_job: str | None = None
        self._connect_busy = False
        self._onboarding: OnboardingView | None = None
        self._current_view = View.MAIN
        self._startup_check_pending = True
        self._auth_cancel = threading.Event()
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
        # Populated by `_build_tab`: key -> (notebook, tab frame, base
        # title), so `_set_tab_problem` can toggle a marker on a tab's
        # label without needing every call site to pass the notebook/frame
        # around itself.
        self._tabs: dict[str, tuple[TabView, ScrollPage, str]] = {}
        self._pages: list[ScrollPage] = []
        # (container, labels) pairs whose wraplength follows the container's
        # width; see `_arm_dynamic_wrap`.
        self._wrap_targets: list[tuple[tk.Misc, tuple[ttk.Label, ...]]] = []

        root.title(f"HotS Analytics v{APP_VERSION} - Configuration")
        root.configure(bg=_BG)
        root.resizable(True, True)
        _set_window_icon(root)
        root.protocol("WM_DELETE_WINDOW", self._on_close)
        root.bind("<Escape>", lambda _e: self._on_close())

        _apply_dark_style()
        self._api_var = tk.StringVar()
        self._token_var = tk.StringVar()
        self._replays_var = tk.StringVar()
        # Read-only summary of the accounts found under the chosen HotS root.
        self._accounts_var = tk.StringVar()

        self._build_ui()
        self._prefill()
        self._token_var.trace_add("write", self._refresh_signout_button)
        self._refresh_signout_button()
        self._last_saved = None if is_first_run else self._validated_config()[0]
        # Armed only after the prefill so loading the stored values doesn't
        # count as a change.
        autosaved_vars = [
            self._api_var,
            self._token_var,
            self._replays_var,
            self._draft_enabled_var,
            self._draft_hotkey_var,
        ]
        if hasattr(self, "_auto_update_var"):
            autosaved_vars.append(self._auto_update_var)
        for var in autosaved_vars:
            var.trace_add("write", lambda *_: self._schedule_autosave())
        self._center()
        self._arm_dynamic_wrap()
        # After `_center`: the window is sized from the notebook, which the
        # wizard hides, so the order matters.
        self._show_view(initial_view(is_first_run=is_first_run, token=self._token_var.get()))
        self._check_connection()
        if not is_first_run:
            self._load_stats()
            if self._status_tracker is not None:
                self._refresh_live_stats()
            # The Update section (and `_update_status_label`/`_update_progress_bar`
            # it would refresh) only actually gets built when `IS_FROZEN` --
            # see `_build_config_tab` -- so this must stay in sync with that guard.
            if updater.IS_FROZEN and self._update_status is not None:
                self._refresh_update_status()
            if self._draft_capture_status is not None:
                self._refresh_draft_capture_status()

        root.after(50, lambda: self._api_entry.focus_set())

    # -- layout ---------------------------------------------------------

    def _build_tab(self, notebook: TabView, key: str, title: str, icon: str) -> ttk.Frame:
        page = ScrollPage(notebook)
        notebook.add(page, text=title, icon=icon)
        self._tabs[key] = (notebook, page, title)
        self._pages.append(page)
        return page.inner

    def _build_ui(self) -> None:
        outer = ttk.Frame(self._root, padding=(24, 8, 24, 20))
        outer.pack(fill="both", expand=True)

        # Footer first, packed to the bottom: pack serves widgets in order, so
        # the footer keeps its room however small the window gets and only
        # the tab pages (ScrollPage) scroll, between the tab bar and here.
        self._footer = ttk.Frame(outer, style="TFrame")
        self._footer.pack(side="bottom", fill="x", pady=(14, 0))
        self._error_label = ttk.Label(
            outer,
            text="",
            style="Muted.TLabel",
            foreground=_ERROR,
            wraplength=_LABEL_WRAPLENGTH,
            justify="left",
        )
        self._error_label.pack(side="bottom", anchor="w", pady=(10, 0))

        # Holds either the tab notebook or the onboarding wizard (see `_show_view`).
        self._content = ttk.Frame(outer, style="TFrame")
        self._content.pack(fill="both", expand=True)
        self._notebook = TabView(self._content)
        self._notebook.pack(fill="both", expand=True)
        notebook = self._notebook

        self._build_sync_tab(self._build_tab(notebook, "sync", "Synchronisation", "🔄"))
        self._build_draft_tab(self._build_tab(notebook, "draft_live", "Draft Live", "🎮"))
        self._build_config_tab(self._build_tab(notebook, "config", "Config", "⚙"))

        buttons = self._footer
        self._footer_buttons: dict[str, ttk.Button] = {}
        self._footer_tooltips: dict[str, Tooltip] = {}

        def icon_button(key: str, icon: str, tip: str, command) -> None:
            button = ttk.Button(
                buttons, text=icon, style="Icon.Secondary.Ghost.TButton", command=command
            )
            button.pack(side="left", padx=(0, 8))
            self._footer_buttons[key] = button
            self._footer_tooltips[key] = Tooltip(button, tip)

        if not self._is_first_run and self._sync_state is not None:
            icon_button(
                "debug", "🐞",
                "Debug : parties en erreur ou ignorées, avec un rapport à copier",
                self._open_debug_window,
            )
        icon_button("data_folder", "📁", "Ouvrir le dossier de données du daemon", self._open_data_folder)
        icon_button("site", "🌐", "Ouvrir le site HotS Analytics", self._open_site)

        # Fermer is the ghost one; Réduire (icon + text, solid) is the preferred action.
        self._close_button = ttk.Button(
            buttons, text="Fermer", style="Danger.Ghost.TButton", command=self._on_quit_clicked
        )
        self._close_button.pack(side="right")
        self._minimize_button = ttk.Button(
            buttons, text="🗕  Réduire", style="Primary.TButton", command=self._on_close
        )
        self._minimize_button.pack(side="right", padx=(0, 10))
        # Every setting is saved as soon as it changes (see `_autosave`);
        # this is the only feedback.
        self._saved_label = ttk.Label(buttons, text="", style="Muted.TLabel")
        self._saved_label.pack(side="right", padx=(0, 14))

    def _open_data_folder(self) -> None:
        open_config_folder()

    def _open_site(self) -> None:
        webbrowser.open(guess_web_base_url(self._api_var.get() or DEFAULT_API_BASE_URL))

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
        if updater.IS_FROZEN:
            self._build_update_section(parent)
        self._build_connexion_section(parent)
        self._build_stockage_section(parent)
        self._build_demarrage_section(parent)

    # -- Config tab: Connexion -----------------------------------------------

    def _build_connexion_section(self, parent: ttk.Frame) -> None:
        card = CollapsibleCard(parent, "CONNEXION", "🔌")
        card.pack(fill="x", pady=(0, 12))
        inner = card.body
        inner.grid_columnconfigure(0, weight=1, minsize=340)


        connect_row = ttk.Frame(inner, style="Panel.TFrame")
        connect_row.grid(row=1, column=0, columnspan=3, sticky="w", pady=(0, 4))

        self._connect_button = ttk.Button(
            connect_row,
            text="Connecter ce PC via le navigateur",
            style="Primary.TButton",
            command=self._connect_via_browser,
        )
        self._connect_button.pack(side="left")
        self._signout_button = ttk.Button(
            connect_row, text="Se déconnecter", style="Danger.Ghost.TButton", command=self._sign_out
        )
        self._signout_button.pack(side="left", padx=(10, 0))

        self._connect_status = ttk.Label(
            inner,
            text="",
            style="PanelMuted.TLabel",
            wraplength=_LABEL_WRAPLENGTH,
            justify="left",
        )
        self._connect_status.grid(row=2, column=0, columnspan=3, sticky="w", pady=(0, 12))

        self._api_entry, self._api_status, grid_row = self._build_field(
            inner,
            label="URL de l'API",
            var=self._api_var,
            start_row=3,
            on_change=self._on_api_or_token_changed,
        )
        self._token_entry, self._token_status, grid_row = self._build_field(
            inner,
            label="Token d'accès",
            var=self._token_var,
            start_row=grid_row,
            on_change=self._on_api_or_token_changed,
            show="•",
        )
        link = ttk.Label(
            inner, text="Générer / gérer mon token →", style="Link.TLabel", cursor="hand2"
        )
        link.grid(row=grid_row, column=0, columnspan=3, sticky="w")
        link.bind("<Button-1>", lambda _e: self._open_token_link())

    # -- Config tab: Stockage -------------------------------------------------

    def _build_stockage_section(self, parent: ttk.Frame) -> None:
        card = CollapsibleCard(parent, "STOCKAGE", "💾")
        card.pack(fill="x", pady=(0, 12))
        inner = card.body
        inner.grid_columnconfigure(0, weight=1, minsize=340)


        self._replays_entry, self._replays_status, grid_row = self._build_field(
            inner,
            label="Dossier des replays",
            var=self._replays_var,
            start_row=1,
            on_change=self._on_replays_changed,
        )
        browse = ttk.Button(
            inner, text="Parcourir…", style="Secondary.TButton", command=self._browse_replays_dir
        )
        browse.grid(row=grid_row, column=0, columnspan=3, sticky="w")

        # What will actually be watched: every account folder found under the
        # chosen root (see accounts_discovery). Shown rather than configured,
        # since discovery is what makes a smurf's replays upload with no setup.
        ttk.Label(
            inner,
            textvariable=self._accounts_var,
            style="Muted.TLabel",
            wraplength=520,
            justify="left",
        ).grid(row=grid_row + 1, column=0, columnspan=3, sticky="w", pady=(4, 0))

    # -- Config tab: Démarrage ------------------------------------------------

    def _build_demarrage_section(self, parent: ttk.Frame) -> None:
        if not autostart.is_supported():
            return
        card = CollapsibleCard(parent, "DÉMARRAGE", "🚀")
        card.pack(fill="x")
        inner = card.body

        # If Windows silently disabled this entry (Task Manager's Startup
        # tab, or its own startup-impact policy -- see
        # autostart.needs_repair()), repair it proactively here rather than
        # just reflecting "unchecked" and waiting for the player to notice
        # and re-toggle it themselves.
        repaired = autostart.needs_repair()
        if repaired:
            autostart.set_enabled(True)

        actual = autostart.is_enabled()
        self._autostart_var = tk.BooleanVar(value=actual)
        autostart_check = self._checkbutton(
            inner,
            text="Lancer au démarrage de Windows (en arrière-plan, sans ouvrir cette fenêtre)",
            variable=self._autostart_var,
            command=self._on_autostart_toggled,
        )
        autostart_check.grid(row=1, column=0, sticky="w")

        self._autostart_status = ttk.Label(
            inner, text="", style="PanelMuted.TLabel", wraplength=380, justify="left"
        )
        self._autostart_status.grid(row=2, column=0, sticky="w", pady=(8, 0))
        if repaired:
            # The caption must match what the checkbox actually shows: only
            # claim success if the repair write stuck (autostart.set_enabled
            # swallows OSError on registry-write failure -- see
            # autostart.py -- so `repaired` alone doesn't prove it worked).
            if actual:
                self._set_status(
                    self._autostart_status,
                    "✓ Réactivé automatiquement (Windows l'avait désactivé).",
                    _OK,
                )
            else:
                self._set_status(
                    self._autostart_status,
                    "✗ Windows a refusé la réactivation automatique (droits insuffisants ?).",
                    _ERROR,
                )

    def _checkbutton(
        self, parent, *, text: str, variable: tk.BooleanVar, command
    ) -> tk.Checkbutton:
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
        wrapper = tk.Frame(
            parent, bg=_FIELD_BG, highlightthickness=1, highlightbackground=_FIELD_BG
        )
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
        entry.bind(
            "<FocusIn>",
            lambda _e: wrapper.configure(
                bg=_FIELD_BG_FOCUS, highlightbackground=_ACCENT
            ),
        )
        entry.bind(
            "<FocusOut>",
            lambda _e: wrapper.configure(bg=_FIELD_BG, highlightbackground=_FIELD_BG),
        )
        entry.bind("<KeyRelease>", lambda _e: on_change())

        status = ttk.Label(parent, text="", style="PanelMuted.TLabel")
        status.grid(row=entry_row, column=1, columnspan=2, sticky="w", padx=(10, 0))

        return entry, status, entry_row + 1

    # -- Draft Live tab -----------------------------------------------------

    def _build_draft_tab(self, parent: ttk.Frame) -> None:
        self._build_raccourci_section(parent)
        self._build_capture_section(parent)
        self._build_etat_section(parent)

    # -- Draft Live tab: Raccourci ------------------------------------------

    def _build_raccourci_section(self, parent: ttk.Frame) -> None:
        card = CollapsibleCard(parent, "RACCOURCI", "⌨")
        card.pack(fill="x", pady=(0, 12))
        inner = card.body
        inner.grid_columnconfigure(0, weight=1, minsize=340)


        self._draft_enabled_var = tk.BooleanVar(value=True)
        enabled_check = self._checkbutton(
            inner,
            text="Activer la capture de draft en direct",
            variable=self._draft_enabled_var,
            command=self._on_draft_enabled_toggled,
        )
        enabled_check.grid(row=1, column=0, columnspan=3, sticky="w")

        self._draft_hotkey_var = tk.StringVar()

        hotkey_row = ttk.Frame(inner, style="Panel.TFrame")
        hotkey_row.grid(row=2, column=0, columnspan=3, sticky="w", pady=(10, 0))

        display_wrapper = tk.Frame(
            hotkey_row,
            bg=_FIELD_BG,
            highlightthickness=1,
            highlightbackground=_FIELD_BG,
        )
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
            hotkey_row,
            text="Modifier…",
            style="Secondary.TButton",
            command=self._start_hotkey_capture,
        )
        self._draft_hotkey_record_btn.pack(side="left", padx=(10, 0))

        self._draft_hotkey_status = ttk.Label(inner, text="", style="PanelMuted.TLabel")
        self._draft_hotkey_status.grid(
            row=3, column=0, columnspan=3, sticky="w", pady=(6, 0)
        )

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

        # Real registration status -- distinct from the syntax-only "✓
        # Raccourci valide" above, which used to be the only signal shown
        # and could stay green even when Windows never actually installed
        # the hook. Only shown once a live HotkeyManager exists (not on
        # first run, before the daemon has started once).
        if self._hotkey_manager is not None:
            status_row = ttk.Frame(inner, style="Panel.TFrame")
            status_row.grid(row=5, column=0, columnspan=3, sticky="w", pady=(10, 0))
            self._hotkey_registration_status = ttk.Label(
                status_row, text="", style="PanelMuted.TLabel", wraplength=360, justify="left"
            )
            self._hotkey_registration_status.pack(side="left")
            self._hotkey_retry_btn = ttk.Button(
                status_row,
                text="Réessayer",
                style="Warn.TButton",
                command=self._retry_hotkey_registration,
            )
            # Not packed here -- only shown while there's an error to retry,
            # see `_refresh_draft_capture_status`. Tracked via an explicit
            # flag rather than `winfo_ismapped()`: this button lives inside
            # a ttk.Notebook tab, and a widget in a non-selected tab reports
            # `winfo_ismapped() == False` even while still packed, so that
            # query can't distinguish "not packed" from "packed but on a
            # hidden tab".
            self._hotkey_retry_btn_shown = False

    def _retry_hotkey_registration(self) -> None:
        if self._hotkey_manager is None:
            return
        threading.Thread(
            target=self._hotkey_manager.retry, daemon=True, name="hots-hotkey-retry"
        ).start()

    # -- Draft Live tab: Capture ---------------------------------------------

    def _build_capture_section(self, parent: ttk.Frame) -> None:
        card = CollapsibleCard(parent, "CAPTURE", "📸")
        card.pack(fill="x", pady=(0, 12))
        inner = card.body


        # "Tester la capture" -- runs the same screenshot -> crop -> OCR
        # pipeline against whatever window has focus, without ever POSTing
        # anything, so a player can check hotkey/crop/OCR calibration
        # without needing to be mid-draft in an actual game (see
        # draft_capture.run_test_capture). Independent of the "Activer la
        # capture de draft en direct" checkbox above and of any saved
        # config -- available even on first run, before anything's saved.
        test_col = ttk.Frame(inner, style="Panel.TFrame")
        test_col.grid(row=1, column=0, sticky="nw", padx=(0, 20))
        self._test_capture_btn = ttk.Button(
            test_col,
            text="🔍 Tester la capture",
            style="Info.TButton",
            command=self._start_test_capture,
        )
        self._test_capture_btn.pack(anchor="w")
        ttk.Label(
            test_col,
            text="Aucun envoi. Vérifie le cadrage/OCR sur la fenêtre active — pour calibrer.",
            style="PanelMuted.TLabel",
            wraplength=190,
            justify="left",
        ).pack(anchor="w", pady=(4, 0))

        # "Capturer maintenant" -- a real (non-dry-run) capture, same as a
        # hotkey press, for when the player isn't mid-draft or the hotkey
        # itself isn't responding. Only shown once a live daemon exists to
        # hand the request to (not on first run).
        if self._on_manual_capture is not None:
            capture_col = ttk.Frame(inner, style="Panel.TFrame")
            capture_col.grid(row=1, column=1, sticky="nw")
            ttk.Button(
                capture_col,
                text="📤 Capturer maintenant",
                style="Primary.TButton",
                command=self._start_manual_capture,
            ).pack(anchor="w")
            ttk.Label(
                capture_col,
                text="Déclenche une vraie capture + envoi, comme le raccourci — utile hors "
                "partie ou si le raccourci ne répond pas.",
                style="PanelMuted.TLabel",
                wraplength=190,
                justify="left",
            ).pack(anchor="w", pady=(4, 0))

        self._test_capture_status_label = ttk.Label(inner, text="", style="PanelMuted.TLabel")
        self._test_capture_status_label.grid(
            row=2, column=0, columnspan=2, sticky="w", pady=(10, 0)
        )

    def _start_manual_capture(self) -> None:
        if self._on_manual_capture is not None:
            self._on_manual_capture()

    # -- Draft Live tab: État -------------------------------------------------

    def _build_etat_section(self, parent: ttk.Frame) -> None:
        if self._draft_capture_status is None:
            return
        card = CollapsibleCard(parent, "ÉTAT", "📊")
        card.pack(fill="x")
        inner = card.body

        self._draft_capture_animating = False
        self._draft_capture_status_label = ttk.Label(inner, text="", style="PanelMuted.TLabel")
        self._draft_capture_status_label.grid(row=1, column=0, columnspan=3, sticky="w")
        self._draft_capture_progress_bar = ttk.Progressbar(
            inner, orient="horizontal", length=200, mode="indeterminate"
        )
        # Not gridded here -- only shown while a capture is actually in
        # progress (see _refresh_draft_capture_status), so idle time (almost
        # always) doesn't show an empty bar doing nothing.

        self._hotkey_last_triggered_label = ttk.Label(inner, text="", style="PanelMuted.TLabel")
        self._hotkey_last_triggered_label.grid(
            row=3, column=0, columnspan=3, sticky="w", pady=(10, 0)
        )

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
            self._set_status(
                self._draft_hotkey_status, _truncate(f"✗ {err}", 60), _ERROR
            )
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
        self._set_status(
            self._draft_hotkey_status,
            "Appuyez sur une combinaison de touches… (Échap pour annuler)",
            _NEUTRAL,
        )
        threading.Thread(
            target=self._capture_hotkey_worker, daemon=True, name="hots-hotkey-capture"
        ).start()

    def _capture_hotkey_worker(self) -> None:
        try:
            import keyboard

            combo = keyboard.read_hotkey(suppress=True)
            error: str | None = None
        except (
            Exception
        ) as err:  # pragma: no cover -- exercised via error branch in tests
            combo = None
            error = str(err)
        self._after_if_open(self._finish_hotkey_capture, combo, error)

    def _finish_hotkey_capture(self, combo: str | None, error: str | None) -> None:
        self._hotkey_capturing = False
        self._draft_hotkey_record_btn.configure(state="normal")
        self._draft_hotkey_display.configure(fg=_TEXT)

        if error is not None:
            self._set_status(
                self._draft_hotkey_status,
                _truncate(f"✗ Capture impossible : {error}", 60),
                _ERROR,
            )
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

        Also refreshes the Raccourci section's real registration status and
        the État section's "dernier appui détecté" line on the same tick --
        one shared 500ms poll rather than a second timer, since both are
        cheap snapshot reads.
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
            self._draft_capture_progress_bar.grid(
                row=2, column=0, columnspan=3, sticky="ew", pady=(6, 0)
            )
            self._draft_capture_progress_bar.start(12)

        if status.phase is CapturePhase.IDLE:
            self._set_status(self._draft_capture_status_label, "", _NEUTRAL)
        elif status.phase is CapturePhase.ERROR:
            message = status.message or "Échec de la capture."
            self._set_status(
                self._draft_capture_status_label,
                _truncate(f"✗ {message}", _DRAFT_CAPTURE_STATUS_MAX_CHARS),
                _ERROR,
            )
        else:
            text = (
                "Capture en cours…"
                if status.phase is CapturePhase.CAPTURING
                else "Envoi de la capture…"
            )
            self._set_status(self._draft_capture_status_label, text, _NEUTRAL)

        self._refresh_hotkey_status()

        self._draft_capture_status_job = self._root.after(
            _LIVE_STATS_POLL_MS, self._refresh_draft_capture_status
        )

    def _refresh_hotkey_status(self) -> None:
        """Refreshes the Raccourci section's real registration status (the
        `HotkeyManager` actually installed the OS-level hook, not just that
        the combo's syntax parsed) and the État section's "dernier appui
        détecté" timestamp. Called from `_refresh_draft_capture_status`'s
        poll tick; a no-op if no live `HotkeyManager` was handed in (first
        run, before the daemon has started once).
        """
        if self._hotkey_manager is None:
            return
        snapshot = self._hotkey_manager.snapshot()

        if hasattr(self, "_hotkey_registration_status"):
            if snapshot.last_error:
                self._set_status(
                    self._hotkey_registration_status,
                    _truncate(f"✗ Échec de l'enregistrement — {snapshot.last_error}", 90),
                    _ERROR,
                )
                if not self._hotkey_retry_btn_shown:
                    self._hotkey_retry_btn.pack(side="left", padx=(10, 0))
                    self._hotkey_retry_btn_shown = True
            else:
                self._set_status(self._hotkey_registration_status, "", _NEUTRAL)
                if self._hotkey_retry_btn_shown:
                    self._hotkey_retry_btn.pack_forget()
                    self._hotkey_retry_btn_shown = False

        if hasattr(self, "_hotkey_last_triggered_label"):
            if snapshot.last_triggered_at is None:
                self._hotkey_last_triggered_label.configure(
                    text="Aucun appui détecté depuis l'ouverture.", foreground=_NEUTRAL
                )
            else:
                self._hotkey_last_triggered_label.configure(
                    text=f"Dernier appui du raccourci détecté : {_format_time_ago(snapshot.last_triggered_at)}",
                    foreground=_NEUTRAL,
                )

        self._set_tab_problem("draft_live", has_problem=bool(snapshot.last_error))

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
        threading.Thread(
            target=self._test_capture_worker, daemon=True, name="hots-test-capture"
        ).start()

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
                self._test_capture_status_label,
                _truncate(f"✗ {error}", _TEST_CAPTURE_STATUS_MAX_CHARS),
                _ERROR,
            )
            return
        assert result is not None
        self._set_status(
            self._test_capture_status_label,
            "✓ Capture terminée, voir la fenêtre de résultat.",
            _OK,
        )
        self._open_test_capture_window(result)

    def _crop_to_photo(self, crop: Image.Image | None) -> ImageTk.PhotoImage | None:
        if crop is None or crop.width == 0 or crop.height == 0:
            return None
        scale = _TEST_CAPTURE_THUMB_WIDTH / crop.width
        resized = crop.resize(
            (_TEST_CAPTURE_THUMB_WIDTH, max(1, round(crop.height * scale))),
            Image.LANCZOS,
        )
        return ImageTk.PhotoImage(resized)

    def _open_test_capture_window(
        self, result: draft_capture.TestCaptureResult
    ) -> None:
        win = tk.Toplevel(self._root)
        win.title("HotS Analytics - Test de capture")
        win.configure(bg=_BG)
        win.transient(self._root)

        body = ttk.Frame(win, padding=18)
        body.pack(fill="both", expand=True)

        # PhotoImage instances are garbage-collected by Tk the moment nothing
        # in Python still references them -- kept alive for the window's
        # whole lifetime by stashing them on it directly.
        photos: list[ImageTk.PhotoImage] = []
        win._test_capture_photos = photos  # type: ignore[attr-defined]

        def _build_team_column(
            title: str, team: TeamCropResult, ocr_results: list[OcrResult], column: int
        ) -> None:
            padx = (0, 0) if column == 0 else (28, 0)
            ttk.Label(body, text=title, style="Title.TLabel").grid(
                row=0, column=column, sticky="w", padx=padx
            )
            for i, (crop, read) in enumerate(
                zip(team.player_crops, ocr_results), start=1
            ):
                cell = ttk.Frame(body, style="TFrame")
                cell.grid(row=i, column=column, sticky="w", pady=(12, 0), padx=padx)

                photo = self._crop_to_photo(crop)
                if photo is not None:
                    photos.append(photo)
                    tk.Label(cell, image=photo, bg=_BG).pack(anchor="w")
                else:
                    tk.Label(
                        cell,
                        text="(pas de crop)",
                        bg=_BG,
                        fg=_TEXT_MUTED,
                        font=("Segoe UI", 9),
                    ).pack(anchor="w")

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

        ttk.Button(
            body, text="Fermer", style="Secondary.TButton", command=win.destroy
        ).grid(row=6, column=0, columnspan=2, sticky="e", pady=(18, 0))

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

        card = CollapsibleCard(parent, "SYNCHRONISATION", "🔄")
        card.pack(fill="x")
        inner = card.body

        head = ttk.Frame(inner, style="Panel.TFrame")
        head.pack(fill="x")
        ttk.Label(head, text=f"Daemon v{APP_VERSION}", style="PanelMuted.TLabel").pack(side="left")
        ttk.Label(head, text="·  API", style="PanelMuted.TLabel").pack(side="left", padx=(8, 4))
        self._api_version_label = ttk.Label(head, text="…", style="PanelMuted.TLabel")
        self._api_version_label.pack(side="left")

        tiles_spec: list[tuple[str, str]] = [("Parties enregistrées", "_games_count_label")]
        if self._status_tracker is not None:
            tiles_spec += [
                ("Trouvées dans le dossier", "_found_count_label"),
                ("Synchronisées (session)", "_synced_count_label"),
            ]
        self._tiles_frame = tk.Frame(inner, bg=_PANEL)
        self._tiles_frame.pack(fill="x", pady=(12, 0))
        self._tiles: list[tk.Frame] = []
        for title, attr in tiles_spec:
            tile = tk.Frame(self._tiles_frame, bg=_FIELD_BG)
            tk.Label(tile, text=title, bg=_FIELD_BG, fg=_TEXT_MUTED, font=("Segoe UI", 8), anchor="w").pack(
                fill="x", padx=12, pady=(8, 0)
            )
            value = tk.Label(tile, text="…", bg=_FIELD_BG, fg=_TEXT, font=("Segoe UI", 14, "bold"), anchor="w")
            value.pack(fill="x", padx=12, pady=(0, 8))
            setattr(self, attr, value)
            self._tiles.append(tile)
        self._tile_cols = 0
        self._layout_tiles(self._tiles_frame.winfo_reqwidth())
        self._tiles_frame.bind("<Configure>", lambda e: self._layout_tiles(e.width))

        if self._status_tracker is not None:
            progress_head = ttk.Frame(inner, style="Panel.TFrame")
            progress_head.pack(fill="x", pady=(16, 4))
            ttk.Label(progress_head, text="Progression", style="PanelMuted.TLabel").pack(side="left")
            self._sync_progress_label = ttk.Label(progress_head, text="", style="Panel.TLabel")
            self._sync_progress_label.pack(side="right")
            self._sync_progress_bar = ttk.Progressbar(
                inner, orient="horizontal", mode="determinate", maximum=100
            )
            self._sync_progress_bar.pack(fill="x")

            ttk.Label(inner, text="En cours de synchronisation", style="PanelMuted.TLabel").pack(
                anchor="w", pady=(14, 0)
            )
            self._currently_syncing_label = ttk.Label(
                inner, text="—", style="Panel.TLabel", wraplength=_LABEL_WRAPLENGTH, justify="left"
            )
            self._currently_syncing_label.pack(fill="x")
            self._skipped_count_label = ttk.Label(
                inner, text="", style="PanelMuted.TLabel", foreground=_NEUTRAL,
                wraplength=_LABEL_WRAPLENGTH, justify="left",
            )
            self._skipped_count_label.pack(fill="x", pady=(10, 0))
            self._sync_error_label = ttk.Label(
                inner, text="", style="PanelMuted.TLabel", foreground=_ERROR,
                wraplength=_LABEL_WRAPLENGTH, justify="left",
            )
            self._sync_error_label.pack(fill="x", pady=(6, 0))
            self._wrap_targets.append(
                (inner, (self._currently_syncing_label, self._skipped_count_label, self._sync_error_label))
            )

        self._activity_card: CollapsibleCard | None = None
        if self._sync_state is not None:
            sync_state = self._sync_state
            guard = self._dependency_guard
            self._activity_card = CollapsibleCard(parent, "ACTIVITÉ EN COURS", "📋")
            self._activity_card.pack(fill="both", expand=True, pady=(12, 0))
            self._sync_table = SyncTable(
                self._activity_card.body,
                sync_state=sync_state,
                scheduler=self._scheduler,
                min_parser_version=lambda: sync_state.get_meta("min_parser_version"),
                dependency_required=lambda: guard.required if guard is not None and guard.blocked else None,
                pause_parent=self._activity_card.header_actions,
            )
            self._sync_table.pack(fill="both", expand=True)

    def _layout_tiles(self, width: int) -> None:
        cols = recap_columns(width)
        if cols == self._tile_cols:
            return
        self._tile_cols = cols
        for index in range(3):
            self._tiles_frame.grid_columnconfigure(index, weight=1 if index < cols else 0, uniform="tile")
        for index, tile in enumerate(self._tiles):
            tile.grid(row=index // cols, column=index % cols, sticky="nsew", padx=4, pady=4)

    def _arm_dynamic_wrap(self) -> None:
        """Makes long labels re-wrap to the real width. Armed only after the
        initial sizing pass (`_center`) so provisional widths during the
        worst-case measurement can't shrink the measured size."""
        for container, labels in self._wrap_targets:
            def on_configure(event, labels=labels):
                for label in labels:
                    label.configure(wraplength=max(160, event.width - 8))
            container.bind("<Configure>", on_configure, add="+")

    def _refresh_live_stats(self) -> None:
        assert self._status_tracker is not None
        status = self._status_tracker.snapshot()

        self._found_count_label.configure(text=str(status.found))
        self._synced_count_label.configure(
            text=f"{status.synced} ok" + (f" · {status.failed} échouées" if status.failed else "")
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
            syncing_text = _truncate(
                ", ".join(sorted(status.currently_syncing)), _SYNCING_LABEL_MAX_CHARS
            )
        else:
            syncing_text = "—"
        self._currently_syncing_label.configure(text=syncing_text)

        progress = progress_summary(status.found, status.synced, status.failed)
        self._sync_progress_bar["value"] = progress.percent
        self._sync_progress_label.configure(text=progress.label)

        if status.last_error:
            error_text = _truncate(status.last_error, _ERROR_LABEL_MAX_CHARS)
            self._sync_error_label.configure(
                text=f"✗ Dernière erreur de synchronisation : {error_text}"
            )
        else:
            self._sync_error_label.configure(text="")

        if self._sync_table is not None:
            self._sync_table.refresh()
        self._live_stats_job = self._root.after(
            _LIVE_STATS_POLL_MS, self._refresh_live_stats
        )

    # -- Config tab: Mises à jour -----------------------------------------------------------

    def _build_update_section(self, parent: ttk.Frame) -> None:
        card = CollapsibleCard(parent, "MISES À JOUR", "⬆")
        card.pack(fill="x", pady=(0, 12))
        inner = card.body
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
                style="Primary.TButton",
                command=self._on_check_update_clicked,
            )
            self._check_update_button.pack(side="left")

        self._view_log_button = ttk.Button(
            button_row,
            text="Voir le journal",
            style="Secondary.TButton",
            command=self._open_update_log,
        )
        self._view_log_button.pack(
            side="left", padx=(10, 0) if self._update_status is not None else (0, 0)
        )

        # Always available (unlike the buttons above, needs no
        # `update_status` -- it's just a browser link) as a fallback with a
        # completely different failure surface than the automatic Velopack
        # install: downloading the release page's Setup.exe by hand, see
        # `updater.release_page_url`.
        # `_refresh_update_status` switches it to `Warn.TButton` while the
        # last automatic attempt is in `UpdatePhase.ERROR`, so it's easy to
        # spot exactly when it's actually needed.
        self._manual_download_button = ttk.Button(
            button_row,
            text="⬇ Mise à jour manuelle",
            style="Secondary.TButton",
            command=self._open_manual_download,
        )
        self._manual_download_button.pack(side="left", padx=(10, 0))

        if self._update_status is not None:
            # Built but left unpacked -- `_refresh_update_status` packs it in
            # only while the current status carries a `manual_fallback_path`,
            # which since the Velopack migration is always `None` (Velopack
            # owns its own staging directory, so there is no locally-staged
            # build to open -- see `updater.UpdateStatus.manual_fallback_path`).
            # Inert today, kept only because that field is still part of the
            # type; delete both together if it ever goes.
            self._fallback_path: Path | None = None
            self._open_fallback_button = ttk.Button(
                button_row,
                text="📁 Ouvrir le dossier",
                style="Secondary.TButton",
                command=self._open_fallback_folder,
            )

            self._update_status_label = ttk.Label(
                inner,
                text="",
                style="PanelMuted.TLabel",
                wraplength=420,
                justify="left",
            )
            self._update_status_label.grid(
                row=2, column=0, columnspan=2, sticky="w", pady=(12, 4)
            )

            self._update_progress_bar = ttk.Progressbar(
                inner, orient="horizontal", mode="determinate", maximum=100
            )
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

    def _open_manual_download(self) -> None:
        webbrowser.open(updater.release_page_url())

    def _open_fallback_folder(self) -> None:
        if self._fallback_path is not None:
            open_path(self._fallback_path.parent)

    def _refresh_update_status(self) -> None:
        assert self._update_status is not None
        status = self._update_status.snapshot()
        self._update_status_label.configure(
            text=_truncate(_format_update_status(status), _UPDATE_STATUS_MAX_CHARS)
        )
        self._update_progress_driver.apply(status)

        busy = status.phase in (
            UpdatePhase.CHECKING,
            UpdatePhase.DOWNLOADING,
            UpdatePhase.INSTALLING,
        )
        self._check_update_button.configure(state="disabled" if busy else "normal")

        self._manual_download_button.configure(
            style="Warn.TButton"
            if status.phase is UpdatePhase.ERROR
            else "Secondary.TButton"
        )

        if status.manual_fallback_path is not None:
            self._fallback_path = status.manual_fallback_path
            if not self._open_fallback_button.winfo_ismapped():
                self._open_fallback_button.pack(side="left", padx=(10, 0))
        elif self._open_fallback_button.winfo_ismapped():
            self._open_fallback_button.pack_forget()

        self._update_status_job = self._root.after(
            _LIVE_STATS_POLL_MS, self._refresh_update_status
        )

    # -- prefill ----------------------------------------------------------

    def _prefill(self) -> None:
        if self._is_first_run:
            existing = {}
        else:
            existing = read_config_file()

        self._api_var.set(existing.get("apiBaseUrl") or DEFAULT_API_BASE_URL)
        self._token_var.set(existing.get("accessToken") or "")

        # The field now holds the HotS *root* (Documents/Heroes of the Storm),
        # from which every account folder is discovered -- see
        # accounts_discovery.py.
        hots_dir = existing.get("hotsDir")
        if not hots_dir or not (Path(hots_dir) / "Accounts").is_dir():
            # Nothing saved, or the saved folder no longer exists (e.g. the
            # game/account moved) -- re-run autodetection rather than
            # prefilling a path that's known to be wrong. Left blank if that
            # doesn't find anything either, so the user browses manually.
            guessed = default_hots_dir()
            hots_dir = str(guessed) if guessed else ""
        self._replays_var.set(hots_dir)
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
        check = describe_replays_dir(self._replays_var.get())
        self._set_status(self._replays_status, check.status, _OK if check.ok else _ERROR)
        self._accounts_var.set(check.summary)

    def _browse_replays_dir(self) -> None:
        chosen = filedialog.askdirectory(
            title="Dossier des replays Heroes of the Storm"
        )
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

    def _connect_via_browser(self) -> None:
        """Starts the loopback browser handshake on a worker thread. The Tk
        thread only ever starts it and renders its result (see
        _after_if_open), matching this module's threading contract."""
        if self._connect_busy:
            return
        self._connect_busy = True
        self._auth_cancel = threading.Event()
        self._connect_button.configure(state="disabled")
        self._set_status(self._connect_status, "Ouverture du navigateur…", _NEUTRAL)
        threading.Thread(
            target=self._connect_worker, name="hots-browser-auth", daemon=True
        ).start()

    def _connect_worker(self) -> None:
        result = auth_flow.request_authorization(
            api_base_url=self._api_var.get().strip(),
            cancel_event=self._auth_cancel,
        )
        self._after_if_open(self._finish_connect, result)

    def _finish_connect(self, result: auth_flow.AuthorizationResult) -> None:
        self._connect_busy = False
        self._connect_button.configure(state="normal")
        if result.token:
            # Fill the field and reuse the existing debounced check, so the
            # user sees the token turn green before saving.
            self._token_var.set(result.token)
            self._set_status(self._connect_status, "✓ Connecté. Vérification du token…", _OK)
            self._on_api_or_token_changed()
        else:
            self._set_status(
                self._connect_status, f"✗ {result.error or 'Échec de la connexion.'}", _ERROR
            )

    def _check_connection(self) -> None:
        self._debounce_job = None
        base_url = self._api_var.get().strip()
        token = self._token_var.get().strip()
        if not base_url:
            self._set_status(self._api_status, "", _NEUTRAL)
            self._set_status(self._token_status, "", _NEUTRAL)
            return

        threading.Thread(
            target=self._check_connection_worker, args=(base_url, token), daemon=True
        ).start()

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
        self._after_if_open(
            self._apply_token_status, summary if summary is not None else "invalid"
        )

        version_info = api_client.fetch_version(base_url, token)
        self._after_if_open(self._apply_api_version, version_info)

    def _apply_api_version(self, info: dict | None) -> None:
        if hasattr(self, "_api_version_label"):
            self._api_version_label.configure(
                text=str(info.get("apiVersion", "—")) if info else "—"
            )

    def _apply_api_status(self, reachable: bool) -> None:
        if reachable:
            self._set_status(self._api_status, "✓ Connexion OK", _OK)
        else:
            self._set_status(self._api_status, "✗ Injoignable", _ERROR)

    def _apply_token_status(self, state: dict | str) -> None:
        token_state = state if isinstance(state, str) else "valid"
        if self._startup_check_pending:
            # Only the check made when the window opened may open the wizard:
            # a half-typed token in Config is "invalid" too.
            self._startup_check_pending = False
            next_view = view_after_token_check(self._current_view, token_state)
            if next_view is not self._current_view:
                self._show_view(next_view)
        if state == "unknown":
            self._set_status(self._token_status, "", _NEUTRAL)
        elif state == "invalid":
            self._set_status(self._token_status, "✗ Token invalide", _ERROR)
        else:
            self._set_status(self._token_status, "✓ Token valide", _OK)
            if hasattr(self, "_games_count_label"):
                self._games_count_label.configure(
                    text=str(state.get("gamesPlayed", "—"))
                )

    # -- stats (reopen only) ------------------------------------------------

    def _load_stats(self) -> None:
        existing = read_config_file()
        base_url = existing.get("apiBaseUrl")
        token = existing.get("accessToken")
        if base_url and token:
            threading.Thread(
                target=self._load_stats_worker, args=(base_url, token), daemon=True
            ).start()

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
        title = f"HotS Analytics - Debug ({len(records)} erreur(s)"
        title += f", {len(skipped)} ignorée(s))" if skipped else ")"
        win.title(title)
        win.configure(bg=_BG)
        win.geometry("760x520")
        win.transient(self._root)

        body = ttk.Frame(win, padding=16)
        body.pack(fill="both", expand=True)

        text_frame = tk.Frame(
            body, bg=_FIELD_BG, highlightthickness=1, highlightbackground=_FIELD_BG
        )
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

        ttk.Button(
            button_row, text="Fermer", style="Secondary.TButton", command=win.destroy
        ).pack(side="right")
        ttk.Button(
            button_row, text="Copier", style="Primary.TButton", command=_copy
        ).pack(side="right", padx=(0, 10))

    def _format_debug_report(self, records: list, skipped: list) -> str:
        header = [
            f"HotS Analytics - rapport de debug — daemon v{APP_VERSION}",
            f"{len(records)} partie(s) en erreur",
        ]
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
                lines.append(
                    f"Fichier présent : {'oui' if record.file_exists else 'non (déplacé ou supprimé)'}"
                )
                lines.append(f"Dernière tentative : {record.last_attempt_at}")
                lines.append(
                    f"Erreur          : {record.error_message or '(inconnue)'}"
                )
                if record.error_log:
                    lines.append("Log complet :")
                    lines.append(record.error_log)
                lines.append("")

        if skipped:
            lines.append("=" * 70)
            lines.append(
                f"Parties ignorées volontairement ({len(skipped)}) — ce ne sont pas des erreurs :"
            )
            lines.append("")
            for record in skipped:
                lines.append("-" * 70)
                lines.append(f"Fichier         : {record.file_path}")
                lines.append(f"Hash            : {record.replay_hash}")
                lines.append(
                    f"Fichier présent : {'oui' if record.file_exists else 'non (déplacé ou supprimé)'}"
                )
                lines.append(f"Dernière tentative : {record.last_attempt_at}")
                lines.append(
                    f"Raison          : {_SKIP_REASON_LABELS.get(record.reason, record.reason)}"
                )
                lines.append("")

        return "\n".join(lines)

    # -- onboarding -----------------------------------------------------------

    def _show_view(self, view: View) -> None:
        """Swaps between the classic notebook and the wizard in the same window."""
        self._current_view = view
        if self._onboarding is not None:
            self._onboarding.destroy()
            self._onboarding = None
        if view is View.MAIN:
            self._notebook.pack(fill="both", expand=True)
            return
        self._notebook.pack_forget()
        self._onboarding = OnboardingView(
            self._content,
            view=view,
            replays_var=self._replays_var,
            autostart_var=getattr(self, "_autostart_var", None),
            hooks=self._wizard_hooks(),
            version=APP_VERSION,
        )
        self._onboarding.pack(fill="both", expand=True)
        self._onboarding.start()

    def _wizard_hooks(self) -> OnboardingHooks:
        return OnboardingHooks(
            authorize=lambda cancel: auth_flow.request_authorization(
                api_base_url=self._api_var.get().strip(), cancel_event=cancel
            ),
            verify_token=lambda token: api_client.fetch_summary(self._api_var.get().strip(), token) is not None,
            open_token_page=lambda: webbrowser.open(
                guess_token_page_url(self._api_var.get() or DEFAULT_API_BASE_URL)
            ),
            schedule=self._after_if_open,
            browse_dir=self._browse_replays_dir,
            on_autostart_toggled=self._on_autostart_toggled,
            store_token=self._store_token,
            finish=self._finish_onboarding,
        )

    def _store_token(self, token: str) -> None:
        # Same path as the Config tab's browser button: fill the field and let
        # the debounced check + autosave do the rest.
        self._token_var.set(token)
        self._on_api_or_token_changed()

    def _finish_onboarding(self) -> None:
        error = self._flush_autosave()
        if error is not None:
            self._show_error(error)
            return
        # Always close, first run or reconnection: the daemon only picks the
        # new config/token up once this window returns, so the live trackers
        # this window holds would be stale anyway. app.py restarts the watcher
        # and reopens the full window (see `run_app` / `_on_open_settings`).
        if self._on_reconnected is not None:
            self._on_reconnected()
        self._on_close()

    def _refresh_signout_button(self, *_args) -> None:
        self._signout_button.state(["!disabled"] if self._token_var.get().strip() else ["disabled"])

    def _sign_out(self) -> None:
        """Local sign-out: stops syncing and forgets the token on this PC. The
        token itself stays in the user's list on the website."""
        if not messagebox.askyesno(
            "Se déconnecter",
            "Se déconnecter de HotS Analytics sur ce PC ? La synchronisation s'arrêtera "
            "jusqu'à la prochaine connexion.\n\n"
            "Le token reste dans ta liste sur le site : supprime-le là-bas pour le révoquer.",
            parent=self._root,
        ):
            return
        self._auth_cancel.set()
        if self._on_logout is not None:
            self._on_logout()
        clear_access_token()
        # The file now holds a blank token: forget what we last wrote, or
        # re-pasting the same token would look like "no change" to autosave.
        self._last_saved = None
        self._token_var.set("")  # autosave refuses a blank token, so nothing is rewritten
        self._set_status(self._token_status, "", _NEUTRAL)
        self._show_view(View.WIZARD_CONNECT)

    def _close_blocked_by(self, error: str | None) -> bool:
        """First run / startup with nothing valid to keep: closing would leave
        the daemon without a usable config. A signed-out PC reopened from the
        tray may close freely (nothing is syncing anyway)."""
        if error is None or self._last_saved is not None:
            return False
        signed_out = not self._token_var.get().strip()
        return not signed_out or self._is_first_run or self._require_login

    # -- autostart --------------------------------------------------------

    def _on_autostart_toggled(self) -> None:
        desired = self._autostart_var.get()
        autostart.set_enabled(desired)
        actual = autostart.is_enabled()
        self._autostart_var.set(actual)
        if desired and not actual:
            self._set_status(
                self._autostart_status,
                "✗ Windows a refusé l'activation (droits insuffisants ?).",
                _ERROR,
            )
        elif desired:
            self._set_status(self._autostart_status, "✓ Activé.", _OK)
        else:
            self._set_status(self._autostart_status, "", _NEUTRAL)

    # -- misc ---------------------------------------------------------------

    # A filled-circle emoji rather than a plain "*"/"!" -- ttk.Notebook tab
    # text can't be partially colored, but an emoji glyph renders in its own
    # color regardless of the tab's text color, which is what makes a red
    # marker possible here without custom tab drawing.
    _TAB_PROBLEM_MARKER = " 🔴"

    def _set_status(self, label: ttk.Label, text: str, color: str) -> None:
        label.configure(text=text, foreground=color)

    def _set_tab_problem(self, key: str, has_problem: bool) -> None:
        notebook, page, title = self._tabs[key]
        notebook.tab(page, text=title + self._TAB_PROBLEM_MARKER if has_problem else title)

    def _open_token_link(self) -> None:
        webbrowser.open(guess_settings_url(self._api_var.get() or DEFAULT_API_BASE_URL))

    def _center(self) -> None:
        """Sets the window's initial size (large enough for every tab's content) and centers it.

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
        # Resizable (and maximizable): pages scroll when the window is smaller
        # than their content, so the minimum can be well below the preferred size.
        self._root.minsize(min(width, 640), min(height, 480))
        x = (self._root.winfo_screenwidth() - width) // 2
        # Never open taller than the screen, and never place the title bar above the top.
        height = min(height, self._root.winfo_screenheight() - 80)
        y = max(0, (self._root.winfo_screenheight() - height) // 3)
        self._root.geometry(f"{width}x{height}+{x}+{y}")

    def _measure_worst_case_size(self) -> tuple[int, int]:
        """Temporarily fills every dynamically-updated label with
        max-length placeholder text, measures the window's required size
        with that worst case in place, then restores the real text.
        """
        placeholders: list[tuple[ttk.Label, str]] = [
            (self._error_label, "x" * _ERROR_LABEL_MAX_CHARS)
        ]
        if self._status_tracker is not None:
            placeholders.append(
                (self._currently_syncing_label, "x" * _SYNCING_LABEL_MAX_CHARS)
            )
            placeholders.append(
                (self._skipped_count_label, "x" * _SKIPPED_LABEL_MAX_CHARS)
            )
            placeholders.append(
                (
                    self._sync_error_label,
                    "✗ Dernière erreur de synchronisation : "
                    + "x" * _ERROR_LABEL_MAX_CHARS,
                )
            )
        if self._sync_table is not None:
            # The hover line under the sync table wraps over several lines
            # for a long error message.
            placeholders.append(
                (self._sync_table.detail_label, "x " * (DETAIL_MAX_CHARS // 2))
            )
        if hasattr(self, "_update_status_label"):
            placeholders.append(
                (self._update_status_label, "x" * _UPDATE_STATUS_MAX_CHARS)
            )
        if self._draft_capture_status is not None:
            # Can show an ERROR message up to _DRAFT_CAPTURE_STATUS_MAX_CHARS
            # long (see `_refresh_draft_capture_status`), not just the two
            # short fixed in-progress phrases -- same "x"*N filler pattern
            # as the other unbounded-text labels above.
            placeholders.append(
                (self._draft_capture_status_label, "x" * _DRAFT_CAPTURE_STATUS_MAX_CHARS)
            )
            placeholders.append(
                (
                    self._hotkey_last_triggered_label,
                    "Dernier appui du raccourci détecté : il y a 12345678 h",
                )
            )
        if hasattr(self, "_hotkey_registration_status"):
            placeholders.append((self._hotkey_registration_status, "x" * 90))
        placeholders.append(
            (self._test_capture_status_label, "x" * _TEST_CAPTURE_STATUS_MAX_CHARS)
        )

        originals = [(label, label.cget("text")) for label, _ in placeholders]
        for label, placeholder in placeholders:
            label.configure(text=placeholder)

        # The progress bar itself is normally hidden (grid_remove'd) until a
        # capture starts -- briefly showing it here too means its height is
        # already accounted for in the locked window size, so the window
        # doesn't need to grow the first time a real capture actually shows it.
        if self._draft_capture_status is not None:
            self._draft_capture_progress_bar.grid(
                row=2, column=0, columnspan=3, sticky="ew", pady=(6, 0)
            )

        # Same idea for the "Ouvrir le dossier" button: normally unpacked
        # until `_refresh_update_status` sees a `manual_fallback_path`, which
        # since the Velopack migration never happens (the field is always
        # `None`). Still briefly packed here so `button_row`'s worst-case
        # width -- one more button wider than the common case -- stays
        # accounted for as long as the widget exists at all.
        if hasattr(self, "_open_fallback_button"):
            self._open_fallback_button.pack(side="left", padx=(10, 0))

        self._root.update_idletasks()
        for page in self._pages:
            page.fit_request_to_content()
        self._root.update_idletasks()
        width, height = self._root.winfo_reqwidth(), self._root.winfo_reqheight()

        for label, original in originals:
            label.configure(text=original)
        if self._draft_capture_status is not None:
            self._draft_capture_progress_bar.grid_remove()
        if hasattr(self, "_open_fallback_button"):
            self._open_fallback_button.pack_forget()

        return width, height

    def _validated_config(self) -> tuple[tuple | None, str | None]:
        """The form's current values as a config tuple, or `(None, reason)`
        when something isn't valid yet. Has no UI side effect: the fields
        already show their own inline status while the user types."""
        api_base_url = self._api_var.get().strip()
        access_token = self._token_var.get().strip()
        hots_dir = self._replays_var.get().strip()

        if not api_base_url:
            return None, "L'URL de l'API est requise."
        if not access_token:
            return None, "Le token d'accès est requis."
        if not hots_dir or not (Path(hots_dir) / "Accounts").is_dir():
            return None, (
                "Le dossier Heroes of the Storm est invalide (il doit contenir un sous-dossier Accounts)."
            )

        draft_feature_enabled = self._draft_enabled_var.get()
        draft_hotkey = self._draft_hotkey_var.get().strip()
        if draft_feature_enabled:
            try:
                draft_hotkey = hotkey.validate(draft_hotkey)
            except hotkey.InvalidHotkeyError:
                return None, "Le raccourci de capture de draft est invalide."
        elif not draft_hotkey:
            # Disabled with a blank field (e.g. never touched on first
            # run): keep a sane default around in case it's re-enabled later.
            draft_hotkey = DEFAULT_DRAFT_HOTKEY

        auto_update_enabled = (
            self._auto_update_var.get() if hasattr(self, "_auto_update_var") else True
        )
        return (
            api_base_url.rstrip("/"),
            access_token,
            hots_dir,
            draft_feature_enabled,
            draft_hotkey,
            auto_update_enabled,
        ), None

    def _schedule_autosave(self) -> None:
        if self._closed:
            return
        if self._autosave_job is not None:
            self._root.after_cancel(self._autosave_job)
        self._autosave_job = self._root.after(_AUTOSAVE_MS, self._autosave)

    def _autosave(self) -> str | None:
        """Writes the form to the config file if it is valid and differs from
        what's on disk. Returns the validation error, if any, so `_on_close`
        can tell the user why a first-run setup isn't complete."""
        self._autosave_job = None
        if self._closed or self._hotkey_capturing:
            return None
        config, error = self._validated_config()
        if config is None:
            return error
        self._show_error("")
        if config == self._last_saved:
            return None
        api_base_url, access_token, hots_dir, draft_enabled, draft_hotkey, auto_update = config
        save_config(
            api_base_url,
            access_token,
            hots_dir,
            read_config_file().get("extraReplayDirs", ()) or (),
            draft_feature_enabled=draft_enabled,
            draft_hotkey=draft_hotkey,
            auto_update_enabled=auto_update,
        )
        logger.info("Configuration saved to %s", config_file_path())
        self._last_saved = config
        self._result["saved"] = True
        self._saved_label.configure(text="✓ Enregistré")
        return None

    def _flush_autosave(self) -> str | None:
        if self._autosave_job is not None:
            self._root.after_cancel(self._autosave_job)
        return self._autosave()

    def _on_quit_clicked(self) -> None:
        """"Fermer": stops the whole daemon (not just this window)."""
        if self._hotkey_capturing:
            messagebox.showinfo(
                "HotS Analytics",
                "Terminez la capture du raccourci (appuyez sur une combinaison de touches, "
                "ou Échap pour annuler) avant de fermer.",
                parent=self._root,
            )
            return
        if self._on_quit is not None and not messagebox.askyesno(
            "Fermer HotS Analytics",
            "Fermer complètement HotS Analytics ? La synchronisation des parties s'arrêtera.",
            parent=self._root,
        ):
            return
        self._flush_autosave()
        self._auth_cancel.set()
        self._stop_background_jobs()
        # Settings already written are applied on the next launch; restarting
        # the watcher here would just be undone by the quit.
        self._result["saved"] = False
        self._root.destroy()
        if self._on_quit is not None:
            self._on_quit()

    def _show_error(self, message: str) -> None:
        self._error_label.configure(text=_truncate(message, _ERROR_LABEL_MAX_CHARS))

    def _stop_background_jobs(self) -> None:
        # Marks the window as closing so `_after_if_open` drops any
        # still-in-flight worker-thread result instead of handing it to the
        # root we're about to destroy. Set here (the one place both `_save`
        # and `_on_close` call right before `root.destroy()`) rather than in
        # each of them separately.
        self._closed = True
        if self._onboarding is not None:
            self._onboarding.destroy()
            self._onboarding = None
        if self._autosave_job is not None:
            self._root.after_cancel(self._autosave_job)
            self._autosave_job = None
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
        # Release the loopback listener's wait loop immediately instead of
        # leaving the auth worker blocked for up to the full timeout.
        self._auth_cancel.set()
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
        error = self._flush_autosave()
        if self._close_blocked_by(error):
            # First run and nothing valid to keep yet: closing now would
            # leave the daemon without a configuration to start with.
            self._show_error(f"{error} Complétez la configuration, ou utilisez « Fermer » pour quitter.")
            return
        self._stop_background_jobs()
        self._root.destroy()
