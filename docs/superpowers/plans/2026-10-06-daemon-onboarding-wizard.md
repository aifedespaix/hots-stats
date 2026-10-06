# Daemon Onboarding Wizard, Token Fallback Page & Window Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a first-run/reconnect wizard in the daemon, a dedicated `/daemon/token` web page as manual fallback, and a tidier main window (tab order, responsive sync recap, collapsible activity panel, always-visible tabs + footer).

**Architecture:** All new decision logic lives in small tkinter-free modules (`onboarding.py`, `sync_layout.py`, additions to `urls.py`) that are unit-tested directly. The wizard is a self-contained `OnboardingView` widget (`gui_onboarding.py`) that talks to the window only through an injected `OnboardingHooks` dataclass, so it can be smoke-tested headless. `_SettingsWindow` swaps between the existing notebook and the wizard in one root window. The web side adds one page that reuses the existing `/tokens` API through `useTokens()`.

**Tech Stack:** Python 3 + tkinter/ttk + pytest (daemon, run from `daemon-python/`); Nuxt 3 + Nuxt UI + vitest (web, Bun workspaces).

**Spec:** `docs/superpowers/specs/2026-10-06-daemon-onboarding-wizard-design.md`

## Global Constraints

- All user-facing copy is French.
- No new Python dependencies (tkinter/ttk/Pillow only — already bundled by the Nuitka build).
- Tk widgets are only touched on the Tk thread; worker threads hand results back through `_after_if_open` (injected into the wizard as `hooks.schedule`).
- No API change. Do not touch `auth_flow.py`, the `/daemon/authorize` page, `PARSER_VERSION` / `MIN_PARSER_VERSION`.
- Commits end with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- CI gates must stay green: `bun run typecheck`, `bun run build`, daemon `pytest -q`.

### Deviations from the spec (found while reading the code; Task 9 updates the spec)

1. **Login has no return path** (`pages/login.vue` always lands on `/`). `/daemon/token` therefore cannot return the user to itself after login; the wizard copy says "connecte-toi, puis rouvre cette page depuis le daemon".
2. **Wizard loading bar** is cosmetic on a first run (there is no token to verify yet); the reconnect case already ran its token check.
3. **First-run exit:** today the setup window just closes and the daemon starts. To honor "redirect to the classic screen", `app.py` opens the full settings window right after the first-run daemon start (new `TrayController.open_settings()`).

### Additions requested after the first plan review

- **Config › Connexion gets a « Se déconnecter » button.** Local sign-out only: it stops the watcher, blanks `accessToken` in the config file (other settings kept) and shows the connect step. The token stays in the user's list on the website (the confirmation dialog says so). Because `load_config()` raises on a blank token, `run_app` must handle "config exists but no token" at startup by opening the connect window instead of exiting (Task 7).
- **Footer:** Debug / Dossier de données / Ouvrir le site (new) become icon-only ghost buttons with a hover/focus tooltip explaining the action (`Tooltip` widget, Task 4b). « 🗕 Réduire » keeps its text, gains an icon and becomes the solid `Primary` button (preferred action); « Fermer » becomes the ghost `Danger.Ghost` button.
- **Reconnecting always closes the window** (instead of showing a classic view backed by stale trackers); `app.py` restarts the watcher with the new token and reopens the full window (Task 7). This replaces "go straight to the classic window" for the reconnect case.

## Review Focus

- Signed-out config at startup (token blank in the file) → daemon must open the connect window, never exit with a `ConfigError` (Task 7 test on `has_access_token` + manual check).
- Sign-out must stop uploads and keep every other setting in the config file (Task 7 tests).
- Closing a signed-out window reopened from the tray must be allowed; closing the startup/first-run window without a valid config must still be blocked (Task 7 `_close_blocked_by` tests).
- Tooltips must disappear on leave, click and widget destruction (Task 4b tests).
- Pasted token with spaces/newline/quotes/wrong prefix → rejected without a network call (Task 1 tests).
- API unreachable at startup with a stored token → must **not** show the wizard (Task 1 `view_after_token_check` test).
- User editing the token field in Config (partial token → "invalid") → must **not** flip to the wizard; only the startup check may (Task 7 test).
- Window resized small → footer and tab bar stay visible, progress bar never wider than its container (Task 6 smoke tests).
- Auth cancelled / failed / window closed while auth thread still running → manual-fallback link appears, late result is dropped without raising (Task 5 tests).
- No HotS folder auto-detected on first run → "Continuer" disabled until a valid folder is chosen (Task 5 test).
- Clipboard denied in the browser → page falls back to "Copie-le ci-dessous" (Task 8, manual check — no component-test infra for pages in `apps/web`).

---

### Task 1: Pure onboarding logic

**Files:**
- Create: `daemon-python/src/onboarding.py`
- Test: `daemon-python/tests/test_onboarding.py`

**Interfaces:**
- Produces:
  - `class Step(Enum)`: `CONNECT`, `STORAGE`, `READY`; `STEP_LABELS: dict[Step, str]`
  - `class View(Enum)`: `WIZARD_FULL`, `WIZARD_CONNECT`, `MAIN`
  - `initial_view(*, is_first_run: bool, token: str) -> View`
  - `view_after_token_check(current: View, token_state: str) -> View` (`token_state` ∈ `"valid" | "invalid" | "unknown"`)
  - `normalize_pasted_token(text: str) -> str | None`
  - `class WizardFlow(view: View)`: `.step`, `.steps`, `.advance() -> Step | None`, `.back() -> Step`
  - `@dataclass(frozen=True) DirCheck(ok: bool, status: str, summary: str)`; `describe_replays_dir(value: str) -> DirCheck`

- [ ] **Step 1: Write the failing tests**

```python
# daemon-python/tests/test_onboarding.py
from pathlib import Path

from src.onboarding import (
    Step,
    View,
    WizardFlow,
    describe_replays_dir,
    initial_view,
    normalize_pasted_token,
    view_after_token_check,
)


def test_first_run_always_gets_the_full_wizard():
    assert initial_view(is_first_run=True, token="") is View.WIZARD_FULL
    assert initial_view(is_first_run=True, token="hots_pat_x") is View.WIZARD_FULL


def test_reopened_window_without_a_token_gets_the_connect_step_only():
    assert initial_view(is_first_run=False, token="") is View.WIZARD_CONNECT
    assert initial_view(is_first_run=False, token="   ") is View.WIZARD_CONNECT


def test_reopened_window_with_a_token_shows_the_main_view():
    assert initial_view(is_first_run=False, token="hots_pat_x") is View.MAIN


def test_invalid_token_at_startup_switches_to_the_connect_step():
    assert view_after_token_check(View.MAIN, "invalid") is View.WIZARD_CONNECT


def test_unreachable_api_or_valid_token_never_shows_the_wizard():
    assert view_after_token_check(View.MAIN, "unknown") is View.MAIN
    assert view_after_token_check(View.MAIN, "valid") is View.MAIN


def test_token_check_never_changes_a_wizard_that_is_already_showing():
    assert view_after_token_check(View.WIZARD_FULL, "invalid") is View.WIZARD_FULL


def test_pasted_token_is_trimmed_and_unquoted():
    assert normalize_pasted_token("  hots_pat_abc123\n") == "hots_pat_abc123"
    assert normalize_pasted_token('"hots_pat_abc123"') == "hots_pat_abc123"


def test_pasted_token_rejects_empty_inner_whitespace_and_wrong_prefix():
    assert normalize_pasted_token("") is None
    assert normalize_pasted_token("   ") is None
    assert normalize_pasted_token("hots_pat_abc 123") is None
    assert normalize_pasted_token("abc123") is None


def test_full_flow_walks_the_three_steps_then_finishes():
    flow = WizardFlow(View.WIZARD_FULL)
    assert flow.step is Step.CONNECT
    assert flow.advance() is Step.STORAGE
    assert flow.advance() is Step.READY
    assert flow.advance() is None
    assert flow.back() is Step.STORAGE
    assert flow.back() is Step.CONNECT
    assert flow.back() is Step.CONNECT


def test_connect_only_flow_finishes_after_the_first_step():
    flow = WizardFlow(View.WIZARD_CONNECT)
    assert flow.steps == [Step.CONNECT]
    assert flow.advance() is None


def _make_account(root: Path) -> None:
    (root / "Accounts" / "415612224" / "2-Hero-1-4929240" / "Replays" / "Multiplayer").mkdir(parents=True)


def test_describe_dir_blank_and_missing():
    assert describe_replays_dir("  ").ok is False
    assert describe_replays_dir("  ").status == "Sélectionnez un dossier"
    missing = describe_replays_dir(str(Path("/definitely/not/here")))
    assert missing.ok is False and missing.status == "✗ Introuvable"


def test_describe_dir_with_accounts(tmp_path):
    _make_account(tmp_path)
    check = describe_replays_dir(str(tmp_path))
    assert check.ok is True
    assert check.status == "✓ 1 compte(s) détecté(s)"
    assert "2-Hero-1-4929240" in check.summary and "0 replay(s)" in check.summary


def test_describe_dir_accounts_folder_without_toon(tmp_path):
    (tmp_path / "Accounts").mkdir()
    check = describe_replays_dir(str(tmp_path))
    assert check.ok is True and check.status == "✓ Dossier trouvé (aucun compte)"


def test_describe_dir_that_is_not_a_hots_folder(tmp_path):
    check = describe_replays_dir(str(tmp_path))
    assert check.ok is False and check.status == "✗ Pas un dossier Heroes of the Storm"
```

- [ ] **Step 2: Run to verify failure**

Run (from `daemon-python/`): `pytest tests/test_onboarding.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.onboarding'`.

- [ ] **Step 3: Implement**

```python
# daemon-python/src/onboarding.py
"""Pure logic behind the first-run / reconnect wizard (no tkinter), so it is
unit-tested directly. The Tk side lives in gui_onboarding.py."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from .accounts_discovery import discover_account_folders

# Mirrors TOKEN_PREFIX in apps/api/src/lib/tokens.ts.
TOKEN_PREFIX = "hots_pat_"


class Step(Enum):
    CONNECT = 1
    STORAGE = 2
    READY = 3


STEP_LABELS = {Step.CONNECT: "Connexion", Step.STORAGE: "Stockage", Step.READY: "C'est prêt"}


class View(Enum):
    WIZARD_FULL = "wizard_full"
    WIZARD_CONNECT = "wizard_connect"
    MAIN = "main"


def initial_view(*, is_first_run: bool, token: str) -> View:
    """First run -> the 3-step wizard. Later, no stored token -> connect step
    only. Otherwise the classic window (an invalid stored token is caught by
    the startup check, see `view_after_token_check`)."""
    if is_first_run:
        return View.WIZARD_FULL
    if not token.strip():
        return View.WIZARD_CONNECT
    return View.MAIN


def view_after_token_check(current: View, token_state: str) -> View:
    """Only a *rejected* token on the classic window flips to the wizard: an
    unreachable API ("unknown") must not lock the user out of their window."""
    if current is View.MAIN and token_state == "invalid":
        return View.WIZARD_CONNECT
    return current


def normalize_pasted_token(text: str) -> str | None:
    """The token as a user would paste it (maybe with spaces, a newline or
    quotes around it), or None when it can't be one."""
    cleaned = text.strip().strip("\"'`").strip()
    if not cleaned or any(ch.isspace() for ch in cleaned):
        return None
    if not cleaned.startswith(TOKEN_PREFIX):
        return None
    return cleaned


class WizardFlow:
    def __init__(self, view: View) -> None:
        self._full = view is View.WIZARD_FULL
        self.step = Step.CONNECT

    @property
    def steps(self) -> list[Step]:
        return list(Step) if self._full else [Step.CONNECT]

    def advance(self) -> Step | None:
        """Moves to the next step; None when the current one was the last."""
        steps = self.steps
        index = steps.index(self.step)
        if index + 1 >= len(steps):
            return None
        self.step = steps[index + 1]
        return self.step

    def back(self) -> Step:
        steps = self.steps
        index = steps.index(self.step)
        if index > 0:
            self.step = steps[index - 1]
        return self.step


@dataclass(frozen=True)
class DirCheck:
    ok: bool
    status: str  # short inline status next to the field
    summary: str  # multi-line "accounts found" text ("" when none)


def describe_replays_dir(value: str) -> DirCheck:
    """What the HotS-root field should say about `value`. Must be the HotS
    *root*, not one account's Replays folder: everything is discovered under
    Accounts/<id>/<toon>/Replays from here."""
    value = value.strip()
    if not value:
        return DirCheck(False, "Sélectionnez un dossier", "")
    root = Path(value)
    if not root.is_dir():
        return DirCheck(False, "✗ Introuvable", "")
    accounts = discover_account_folders(root)
    if accounts:
        summary = "\n".join(
            f"• {folder.toon_handle} — "
            f"{sum(1 for _ in folder.replays_dir.rglob('*.StormReplay'))} replay(s)"
            for folder in accounts
        )
        return DirCheck(True, f"✓ {len(accounts)} compte(s) détecté(s)", summary)
    if (root / "Accounts").is_dir():
        return DirCheck(True, "✓ Dossier trouvé (aucun compte)", "Aucun compte détecté sous Accounts/.")
    return DirCheck(False, "✗ Pas un dossier Heroes of the Storm", "")
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_onboarding.py -q` — Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/onboarding.py daemon-python/tests/test_onboarding.py
git commit -m "feat(daemon): pure onboarding logic (views, steps, token + folder checks)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Token page URL helpers

**Files:**
- Modify: `daemon-python/src/urls.py` (append after `daemon_authorize_url`)
- Test: `daemon-python/tests/test_urls.py` (append)

**Interfaces:**
- Produces: `daemon_token_url(web_base_url: str) -> str`, `guess_token_page_url(api_base_url: str) -> str`

- [ ] **Step 1: Failing tests** — append to `tests/test_urls.py` (extend the existing import line to include the two new names):

```python
from src.urls import daemon_token_url, guess_token_page_url


def test_daemon_token_url_strips_trailing_slash():
    assert daemon_token_url("https://app.example.com/") == "https://app.example.com/daemon/token"


def test_guess_token_page_url_follows_the_api_prefix_convention():
    assert (
        guess_token_page_url("https://api-hots-stats.aifedespaix.com")
        == "https://hots-stats.aifedespaix.com/daemon/token"
    )
```

- [ ] **Step 2:** `pytest tests/test_urls.py -q` → FAIL (ImportError).

- [ ] **Step 3: Implement** — append to `src/urls.py`:

```python
def daemon_token_url(web_base_url: str) -> str:
    """The dedicated manual-token page (fallback when the browser handshake fails)."""
    return f"{web_base_url.rstrip('/')}/daemon/token"


def guess_token_page_url(api_base_url: str) -> str:
    return daemon_token_url(guess_web_base_url(api_base_url))
```

- [ ] **Step 4:** `pytest tests/test_urls.py -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/urls.py daemon-python/tests/test_urls.py
git commit -m "feat(daemon): URL helpers for the manual token page" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Responsive sync-recap logic

**Files:**
- Create: `daemon-python/src/sync_layout.py`
- Test: `daemon-python/tests/test_sync_layout.py`

**Interfaces:**
- Produces: `recap_columns(width: int) -> int`; `@dataclass(frozen=True) Progress(percent: int, label: str, state: str)` with `state` ∈ `"idle" | "running" | "done"`; `progress_summary(found: int, synced: int, failed: int) -> Progress`

- [ ] **Step 1: Failing tests**

```python
# daemon-python/tests/test_sync_layout.py
from src.sync_layout import progress_summary, recap_columns


def test_recap_columns_follow_the_available_width():
    assert recap_columns(900) == 3
    assert recap_columns(640) == 3
    assert recap_columns(500) == 2
    assert recap_columns(380) == 2
    assert recap_columns(300) == 1
    assert recap_columns(0) == 1


def test_progress_with_nothing_found_is_idle():
    p = progress_summary(0, 0, 0)
    assert (p.percent, p.state) == (0, "idle")


def test_progress_running_shows_done_over_found():
    p = progress_summary(40, 10, 2)
    assert p.percent == 30 and p.state == "running" and p.label == "12 / 40 parties"


def test_progress_done_without_failures_says_everything_is_up_to_date():
    p = progress_summary(40, 40, 0)
    assert p.percent == 100 and p.state == "done" and p.label == "Tout est à jour"


def test_progress_done_with_failures_reports_them():
    p = progress_summary(40, 38, 2)
    assert p.state == "done" and p.label == "Terminé — 2 échec(s)"


def test_progress_never_exceeds_100_when_counts_race_ahead_of_found():
    assert progress_summary(5, 7, 0).percent == 100
```

- [ ] **Step 2:** `pytest tests/test_sync_layout.py -q` → FAIL (ModuleNotFoundError).

- [ ] **Step 3: Implement**

```python
# daemon-python/src/sync_layout.py
"""Pure helpers for the Synchronisation tab's recap panel (no tkinter)."""

from __future__ import annotations

from dataclasses import dataclass


def recap_columns(width: int) -> int:
    """How many stat tiles fit side by side in `width` pixels."""
    if width >= 640:
        return 3
    if width >= 380:
        return 2
    return 1


@dataclass(frozen=True)
class Progress:
    percent: int
    label: str
    state: str  # "idle" | "running" | "done"


def progress_summary(found: int, synced: int, failed: int) -> Progress:
    if found <= 0:
        return Progress(0, "Aucune partie trouvée", "idle")
    done = synced + failed
    percent = min(100, round(done / found * 100))
    if done >= found:
        label = "Tout est à jour" if failed == 0 else f"Terminé — {failed} échec(s)"
        return Progress(100, label, "done")
    return Progress(percent, f"{done} / {found} parties", "running")
```

- [ ] **Step 4:** `pytest tests/test_sync_layout.py -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/sync_layout.py daemon-python/tests/test_sync_layout.py
git commit -m "feat(daemon): pure helpers for the responsive sync recap" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `CollapsibleCard` header actions + `SyncTable` pause placement

**Files:**
- Modify: `daemon-python/src/gui_widgets.py` (`CollapsibleCard.__init__`, `_paint_header`)
- Modify: `daemon-python/src/sync_table.py` (`SyncTable.__init__` signature + `_build`)
- Test: `daemon-python/tests/test_gui_widgets.py` (create)

**Interfaces:**
- Produces: `CollapsibleCard.header_actions: tk.Frame` (right side of the header; clicking widgets inside does not toggle the card); `SyncTable(..., pause_parent: tk.Misc | None = None)` — when given, the pause button is created in that widget (packed `side="right"`) instead of the table's own top row.

- [ ] **Step 1: Failing tests**

```python
# daemon-python/tests/test_gui_widgets.py
import tkinter as tk
from tkinter import ttk

import pytest

from src.gui_widgets import CollapsibleCard


@pytest.fixture(scope="module")
def tk_root():
    try:
        root = tk.Tk()
    except tk.TclError:
        pytest.skip("Tk cannot create a root window here")
    root.attributes("-alpha", 0.0)  # invisible but mapped: a withdrawn root never maps its children
    yield root
    root.destroy()


def test_header_actions_sit_in_the_header_and_do_not_toggle_the_card(tk_root):
    card = CollapsibleCard(tk_root, "ACTIVITÉ", "📋")
    card.pack()
    button = ttk.Button(card.header_actions, text="Pause")
    button.pack(side="right")
    tk_root.update()

    assert card.header_actions.winfo_ismapped()
    assert button.winfo_ismapped()
    button.event_generate("<Button-1>")
    tk_root.update()
    assert card.expanded is True
    card.destroy()
```

- [ ] **Step 2:** `pytest tests/test_gui_widgets.py -q` → FAIL (`AttributeError: header_actions`).

- [ ] **Step 3: Implement.** In `CollapsibleCard.__init__`, create the actions frame **before** packing the title (so the title's `expand` can't squeeze it), and keep it out of the click/hover bindings:

```python
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
```
(replacing the existing `self._title = ...; self._title.pack(...)` pair) and in `_paint_header` add `self.header_actions` to the widget tuple:

```python
        for widget in (self._header, self._chevron, self._icon, self._title, self.header_actions):
            widget.configure(bg=bg)
```
In `sync_table.py`, add `pause_parent: tk.Misc | None = None` to `SyncTable.__init__` (keyword-only, after `height`), store `self._pause_parent = pause_parent` **before** `self._build(height)`, and in `_build` replace the pause button creation with:

```python
        self._pause_button = ttk.Button(
            self._pause_parent or top, text="Mettre en pause", style="Warn.TButton", command=self._toggle_pause
        )
        self._pause_button.pack(side="right")
```

- [ ] **Step 4:** `pytest tests/test_gui_widgets.py tests/test_sync_table.py -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/gui_widgets.py daemon-python/src/sync_table.py daemon-python/tests/test_gui_widgets.py
git commit -m "feat(daemon): header actions slot on CollapsibleCard, movable pause button" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4b: `Tooltip` widget and icon-button style

**Files:**
- Modify: `daemon-python/src/gui_widgets.py` (add `Tooltip`)
- Modify: `daemon-python/src/gui.py` (`_configure_button_styles`, last lines)
- Test: `daemon-python/tests/test_gui_widgets.py` (append)

**Interfaces:**
- Produces: `Tooltip(widget: tk.Misc, text: str, *, delay_ms: int = 400)` with `.text`, `.visible: bool`, `.show()`, `.hide()`; ttk style `"Icon.Secondary.Ghost.TButton"` (compact, emoji font, inherits the Secondary ghost look).

- [ ] **Step 1: Failing tests** — append to `tests/test_gui_widgets.py` (add `Tooltip` to the existing `from src.gui_widgets import ...` line):

```python
def test_tooltip_shows_on_demand_and_hides_on_leave(tk_root):
    button = ttk.Button(tk_root, text="i")
    button.pack()
    tk_root.update()
    tip = Tooltip(button, "Ouvrir le site")
    assert tip.visible is False
    tip.show()
    tk_root.update()
    assert tip.visible is True
    button.event_generate("<Leave>")
    tk_root.update()
    assert tip.visible is False
    button.destroy()


def test_tooltip_hides_on_click_and_when_its_widget_is_destroyed(tk_root):
    button = ttk.Button(tk_root, text="i")
    button.pack()
    tk_root.update()
    tip = Tooltip(button, "x")
    tip.show()
    button.event_generate("<ButtonPress-1>")
    tk_root.update()
    assert tip.visible is False
    tip.show()
    button.destroy()
    tk_root.update()
    assert tip.visible is False
```

- [ ] **Step 2:** `pytest tests/test_gui_widgets.py -q` → FAIL (ImportError: `Tooltip`).

- [ ] **Step 3: Implement.** Append to `gui_widgets.py`:

```python
class Tooltip:
    """A small popover shown after a short hover (or on keyboard focus) over
    `widget`, hidden on leave, click, focus-out or destruction. Shown above the
    widget (the footer buttons sit at the window's bottom edge), below it when
    there is no room."""

    def __init__(self, widget: tk.Misc, text: str, *, delay_ms: int = 400) -> None:
        self._widget = widget
        self.text = text
        self._delay_ms = delay_ms
        self._job: str | None = None
        self._window: tk.Toplevel | None = None
        widget.bind("<Enter>", self._schedule, add="+")
        widget.bind("<FocusIn>", self._schedule, add="+")
        for sequence in ("<Leave>", "<FocusOut>", "<ButtonPress>", "<Destroy>"):
            widget.bind(sequence, self._cancel_and_hide, add="+")

    @property
    def visible(self) -> bool:
        return self._window is not None

    def _schedule(self, _event: tk.Event | None = None) -> None:
        self._cancel()
        self._job = self._widget.after(self._delay_ms, self.show)

    def _cancel(self) -> None:
        if self._job is not None:
            try:
                self._widget.after_cancel(self._job)
            except tk.TclError:
                pass
            self._job = None

    def _cancel_and_hide(self, _event: tk.Event | None = None) -> None:
        self._cancel()
        self.hide()

    def show(self) -> None:
        self._cancel()
        if self._window is not None:
            return
        window = tk.Toplevel(self._widget)
        window.wm_overrideredirect(True)
        window.attributes("-topmost", True)
        frame = tk.Frame(window, bg=ACCENT, padx=1, pady=1)
        frame.pack()
        tk.Label(
            frame, text=self.text, bg=PANEL, fg=TEXT, font=(_FONT, 9), padx=10, pady=6,
            justify="left", wraplength=260,
        ).pack()
        window.update_idletasks()
        width, height = window.winfo_reqwidth(), window.winfo_reqheight()
        x = self._widget.winfo_rootx() + (self._widget.winfo_width() - width) // 2
        x = max(0, min(x, self._widget.winfo_screenwidth() - width))
        y = self._widget.winfo_rooty() - height - 6
        if y < 0:
            y = self._widget.winfo_rooty() + self._widget.winfo_height() + 6
        window.wm_geometry(f"+{x}+{y}")
        self._window = window

    def hide(self) -> None:
        if self._window is not None:
            try:
                self._window.destroy()
            except tk.TclError:
                pass
            self._window = None
```
And at the end of `gui._configure_button_styles` (inside the function, after the variants loop):

```python
    # Icon-only footer buttons (their meaning comes from a Tooltip): the
    # Secondary ghost look, compact and with an emoji-capable font.
    style.configure("Icon.Secondary.Ghost.TButton", padding=(9, 6), font=("Segoe UI Emoji", 12))
```

- [ ] **Step 4:** `pytest tests/test_gui_widgets.py -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/gui_widgets.py daemon-python/src/gui.py daemon-python/tests/test_gui_widgets.py
git commit -m "feat(daemon): hover tooltip widget and compact icon-button style" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `OnboardingView` widget

**Files:**
- Create: `daemon-python/src/gui_onboarding.py`
- Test: `daemon-python/tests/test_gui_onboarding.py`

**Interfaces:**
- Consumes: `onboarding.{Step, STEP_LABELS, View, WizardFlow, describe_replays_dir, normalize_pasted_token}`, `auth_flow.AuthorizationResult`, `gui_widgets` palette.
- Produces:
  - `@dataclass OnboardingHooks`: `authorize: Callable[[threading.Event], AuthorizationResult]`, `verify_token: Callable[[str], bool]` (runs on a worker thread), `open_token_page: Callable[[], None]`, `schedule: Callable[..., None]` (thread-safe "run on the Tk thread"), `browse_dir: Callable[[], None]`, `on_autostart_toggled: Callable[[], None]`, `store_token: Callable[[str], None]`, `finish: Callable[[], None]`
  - `class OnboardingView(parent, *, view: View, replays_var: tk.StringVar, autostart_var: tk.BooleanVar | None, hooks: OnboardingHooks, version: str)` with `.start(animate: bool = True)`, `.destroy()`, attributes read by tests: `.flow` (`WizardFlow`), `._status` (status label), `._manual_link`, `._continue_button`.

- [ ] **Step 1: Write the failing tests**

```python
# daemon-python/tests/test_gui_onboarding.py
import threading
import time
import tkinter as tk
from pathlib import Path

import pytest

from src import gui
from src.auth_flow import AuthorizationResult
from src.gui_onboarding import OnboardingHooks, OnboardingView
from src.onboarding import Step, View


@pytest.fixture(scope="module")
def tk_root():
    try:
        root = tk.Tk()
    except tk.TclError:
        pytest.skip("Tk cannot create a root window here")
    root.attributes("-alpha", 0.0)  # invisible but mapped: a withdrawn root never maps its children
    gui._apply_dark_style()
    yield root
    root.destroy()


class _Env:
    """Drives the view with fake hooks. `schedule` queues instead of running,
    because worker threads must never touch Tk: tests pump from the Tk thread."""

    def __init__(self, root, view, *, auth_result=None, verify_ok=True, autostart=False):
        self.root = root
        self.pending: list = []
        self.stored: list[str] = []
        self.finished = 0
        self.opened_token_page = 0
        self.verified: list[str] = []
        self.replays_var = tk.StringVar(master=root, value="")
        self.autostart_var = tk.BooleanVar(master=root, value=False) if autostart else None
        self.auth_result = auth_result or AuthorizationResult(token="hots_pat_ok")

        def verify(token):
            self.verified.append(token)
            return verify_ok

        hooks = OnboardingHooks(
            authorize=lambda cancel: self.auth_result,
            verify_token=verify,
            open_token_page=lambda: setattr(self, "opened_token_page", self.opened_token_page + 1),
            schedule=lambda fn, *a: self.pending.append((fn, a)),
            browse_dir=lambda: None,
            on_autostart_toggled=lambda: None,
            store_token=self.stored.append,
            finish=lambda: setattr(self, "finished", self.finished + 1),
        )
        self.frame = tk.Frame(root)
        self.frame.pack()
        self.view = OnboardingView(
            self.frame,
            view=view,
            replays_var=self.replays_var,
            autostart_var=self.autostart_var,
            hooks=hooks,
            version="9.9.9",
        )
        self.view.pack()
        self.view.start(animate=False)
        root.update()

    def pump(self, until, timeout=3.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.root.update()
            while self.pending:
                fn, args = self.pending.pop(0)
                fn(*args)
            if until():
                return
            time.sleep(0.01)
        raise AssertionError("condition not reached in time")

    def close(self):
        self.view.destroy()
        self.frame.destroy()


def _hots_root(tmp_path: Path) -> Path:
    (tmp_path / "Accounts" / "1" / "2-Hero-1-1" / "Replays" / "Multiplayer").mkdir(parents=True)
    return tmp_path


def test_successful_browser_auth_stores_the_token_and_moves_to_storage(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL)
    assert env.view.flow.step is Step.CONNECT
    env.view._start_connect()
    env.pump(lambda: env.view.flow.step is Step.STORAGE)
    assert env.stored == ["hots_pat_ok"]
    env.close()


def test_failed_auth_shows_the_error_and_offers_the_manual_fallback(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL, auth_result=AuthorizationResult(error="Délai dépassé. Réessaie la connexion."))
    env.view._start_connect()
    env.pump(lambda: env.view._manual_link.winfo_ismapped())
    assert "Délai dépassé" in env.view._status.cget("text")
    assert env.stored == []
    env.close()


def test_manual_token_is_rejected_locally_without_a_network_call(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL)
    env.view._toggle_manual()
    env.view._paste_var.set("pas un token")
    env.view._validate_manual()
    assert env.verified == []
    assert "hots_pat_" in env.view._status.cget("text")
    env.close()


def test_manual_token_is_verified_then_stored(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL)
    env.view._toggle_manual()
    env.view._paste_var.set('  "hots_pat_abc"\n')
    env.view._validate_manual()
    env.pump(lambda: env.stored == ["hots_pat_abc"])
    assert env.verified == ["hots_pat_abc"]
    env.close()


def test_manual_token_refused_by_the_server_is_not_stored(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL, verify_ok=False)
    env.view._toggle_manual()
    env.view._paste_var.set("hots_pat_abc")
    env.view._validate_manual()
    env.pump(lambda: "refusé" in env.view._status.cget("text"))
    assert env.stored == []
    env.close()


def test_connect_only_view_finishes_after_a_successful_connection(tk_root):
    env = _Env(tk_root, View.WIZARD_CONNECT)
    env.view._start_connect()
    env.pump(lambda: env.finished == 1)
    env.close()


def test_storage_step_blocks_continue_until_the_folder_is_valid(tk_root, tmp_path):
    env = _Env(tk_root, View.WIZARD_FULL)
    env.view._render(Step.STORAGE)
    tk_root.update()
    assert env.view._continue_button.instate(["disabled"])
    env.replays_var.set(str(_hots_root(tmp_path)))
    tk_root.update()
    assert not env.view._continue_button.instate(["disabled"])
    env.close()


def test_a_late_auth_result_after_the_view_is_destroyed_is_dropped(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL)
    env.view._start_connect()
    env.view.destroy()
    for fn, args in env.pending or []:
        fn(*args)  # must not raise
    env.pump(lambda: True)
    env.frame.destroy()


def test_ready_step_finishes_the_wizard(tk_root, tmp_path):
    env = _Env(tk_root, View.WIZARD_FULL)
    env.replays_var.set(str(_hots_root(tmp_path)))
    env.view._render(Step.READY)
    env.view._finish_button.invoke()
    assert env.finished == 1
    env.close()
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_gui_onboarding.py -q` → FAIL (`ModuleNotFoundError: src.gui_onboarding`).

- [ ] **Step 3: Implement `gui_onboarding.py`**

```python
# daemon-python/src/gui_onboarding.py
"""The first-run / reconnect wizard as a self-contained Tk widget.

It owns no application state: the window hands it the shared `replays_var` /
`autostart_var` and an `OnboardingHooks` bundle, so every side effect (browser
handshake, token check, saving) stays in gui.py and this widget can be
smoke-tested headless. Worker threads never touch Tk: results come back through
`hooks.schedule` (gui.py's `_after_if_open`)."""

from __future__ import annotations

import base64
import io
import threading
import tkinter as tk
from dataclasses import dataclass
from tkinter import ttk
from typing import Callable

from PIL import Image, ImageTk

from ._icon_data import TRAY_ICON_PNG_BASE64
from .auth_flow import AuthorizationResult
from .gui_widgets import ACCENT, BG, ERROR, FIELD_BG, FIELD_BG_FOCUS, OK, PANEL, TEXT, TEXT_MUTED
from .onboarding import (
    STEP_LABELS,
    Step,
    View,
    WizardFlow,
    describe_replays_dir,
    normalize_pasted_token,
)

_FONT = "Segoe UI"
_CONNECTED_PAUSE_MS = 700
_WRAP = 440


@dataclass
class OnboardingHooks:
    authorize: Callable[[threading.Event], AuthorizationResult]
    verify_token: Callable[[str], bool]  # runs on a worker thread
    open_token_page: Callable[[], None]
    schedule: Callable[..., None]  # thread-safe "call this on the Tk thread"
    browse_dir: Callable[[], None]
    on_autostart_toggled: Callable[[], None]
    store_token: Callable[[str], None]
    finish: Callable[[], None]


class Stepper(tk.Frame):
    """① Connexion — ② Stockage — ③ C'est prêt, with done/active/todo states."""

    def __init__(self, parent: tk.Misc, labels: list[str]) -> None:
        super().__init__(parent, bg=BG)
        self._items: list[tuple[tk.Label, tk.Label]] = []
        for index, text in enumerate(labels):
            if index:
                tk.Frame(self, bg=FIELD_BG, height=2, width=28).pack(side="left", padx=8)
            dot = tk.Label(self, text=str(index + 1), width=2, font=(_FONT, 9, "bold"), bg=FIELD_BG, fg=TEXT_MUTED)
            dot.pack(side="left")
            name = tk.Label(self, text=text, bg=BG, fg=TEXT_MUTED, font=(_FONT, 10))
            name.pack(side="left", padx=(6, 0))
            self._items.append((dot, name))

    def set_active(self, index: int) -> None:
        for i, (dot, name) in enumerate(self._items):
            if i < index:
                dot.configure(text="✓", bg=OK, fg=BG)
                name.configure(fg=TEXT, font=(_FONT, 10))
            elif i == index:
                dot.configure(text=str(i + 1), bg=ACCENT, fg=BG)
                name.configure(fg=TEXT, font=(_FONT, 10, "bold"))
            else:
                dot.configure(text=str(i + 1), bg=FIELD_BG, fg=TEXT_MUTED)
                name.configure(fg=TEXT_MUTED, font=(_FONT, 10))


def _load_logo(master: tk.Misc, size: int = 72) -> ImageTk.PhotoImage:
    image = Image.open(io.BytesIO(base64.b64decode(TRAY_ICON_PNG_BASE64))).convert("RGBA")
    return ImageTk.PhotoImage(image.resize((size, size), Image.LANCZOS), master=master)


class OnboardingView(tk.Frame):
    LOADING_MS = 900

    def __init__(
        self,
        parent: tk.Misc,
        *,
        view: View,
        replays_var: tk.StringVar,
        autostart_var: tk.BooleanVar | None,
        hooks: OnboardingHooks,
        version: str,
    ) -> None:
        super().__init__(parent, bg=BG)
        self.flow = WizardFlow(view)
        self._full = view is View.WIZARD_FULL
        self._replays_var = replays_var
        self._autostart_var = autostart_var
        self._hooks = hooks
        self._alive = True
        self._jobs: list[str] = []
        self._busy = False
        self._cancel = threading.Event()
        self._paste_var = tk.StringVar(master=self)
        self._logo = _load_logo(self)
        self._continue_button: ttk.Button | None = None
        self._finish_button: ttk.Button | None = None

        header = tk.Frame(self, bg=BG)
        header.pack(pady=(8, 14))
        tk.Label(header, image=self._logo, bg=BG).pack()
        tk.Label(header, text="HotS Analytics", bg=BG, fg=TEXT, font=(_FONT, 20, "bold")).pack(pady=(6, 0))
        tk.Label(header, text=f"v{version}", bg=BG, fg=TEXT_MUTED, font=(_FONT, 9)).pack()

        self._stepper: Stepper | None = None
        if self._full:
            self._stepper = Stepper(self, [STEP_LABELS[s] for s in self.flow.steps])
            self._stepper.pack(pady=(0, 14))

        self._body = tk.Frame(self, bg=BG)
        self._body.pack(fill="both", expand=True, padx=24)
        self._trace = replays_var.trace_add("write", self._on_replays_changed)

    # -- lifecycle --------------------------------------------------------

    def start(self, animate: bool = True) -> None:
        if not animate:
            self._render(Step.CONNECT)
            return
        self._clear()
        tk.Label(self._body, text="Préparation…", bg=BG, fg=TEXT_MUTED, font=(_FONT, 10)).pack(pady=(30, 8))
        bar = ttk.Progressbar(self._body, mode="determinate", maximum=100, length=260)
        bar.pack()
        steps = 20

        def tick(i: int = 0) -> None:
            if not self._alive:
                return
            bar["value"] = i * 100 / steps
            if i >= steps:
                self._render(Step.CONNECT)
                return
            self._later(self.LOADING_MS // steps, tick, i + 1)

        tick()

    def destroy(self) -> None:
        self._alive = False
        self._cancel.set()  # releases a pending loopback wait immediately
        for job in self._jobs:
            try:
                self.after_cancel(job)
            except tk.TclError:
                pass
        self._jobs.clear()
        try:
            self._replays_var.trace_remove("write", self._trace)
        except tk.TclError:
            pass
        super().destroy()

    def _later(self, ms: int, func: Callable, *args) -> None:
        self._jobs.append(self.after(ms, func, *args))

    # -- rendering helpers ------------------------------------------------

    def _clear(self) -> None:
        for child in self._body.winfo_children():
            child.destroy()
        self._continue_button = None
        self._finish_button = None

    def _heading(self, title: str, subtitle: str) -> None:
        tk.Label(self._body, text=title, bg=BG, fg=TEXT, font=(_FONT, 15, "bold")).pack()
        tk.Label(
            self._body, text=subtitle, bg=BG, fg=TEXT_MUTED, font=(_FONT, 10), wraplength=_WRAP, justify="center"
        ).pack(pady=(4, 0))

    def _link(self, parent: tk.Misc, text: str, command: Callable[[], None]) -> tk.Label:
        label = tk.Label(parent, text=text, bg=BG, fg=ACCENT, font=(_FONT, 9, "underline"), cursor="hand2")
        label.bind("<Button-1>", lambda _e: command())
        return label

    def _set_status(self, text: str, color: str) -> None:
        self._status.configure(text=text, fg=color)

    def _nav(self, *, back: bool, next_text: str, next_cmd: Callable[[], None], enabled: bool = True) -> ttk.Button:
        bar = tk.Frame(self._body, bg=BG)
        bar.pack(side="bottom", fill="x", pady=(18, 0))
        if back:
            ttk.Button(bar, text="← Retour", style="Secondary.TButton", command=self._back).pack(side="left")
        button = ttk.Button(bar, text=next_text, style="Primary.TButton", command=next_cmd)
        button.pack(side="right")
        if not enabled:
            button.state(["disabled"])
        return button

    def _render(self, step: Step) -> None:
        if not self._alive:
            return
        self.flow.step = step
        if self._stepper is not None:
            self._stepper.set_active(self.flow.steps.index(step))
        self._clear()
        {Step.CONNECT: self._build_connect, Step.STORAGE: self._build_storage, Step.READY: self._build_ready}[step]()

    def _advance(self) -> None:
        if not self._alive:
            return
        nxt = self.flow.advance()
        if nxt is None:
            self._hooks.finish()
        else:
            self._render(nxt)

    def _back(self) -> None:
        self._render(self.flow.back())

    # -- step 1: connect --------------------------------------------------

    def _build_connect(self) -> None:
        body = self._body
        if self._full:
            self._heading("Connecte ton compte", "Autorise ce PC depuis ton navigateur. C'est rapide, et sans mot de passe à copier.")
        else:
            self._heading("Reconnexion nécessaire", "Le token de ce PC n'est plus valide. Autorise-le à nouveau depuis ton navigateur.")

        self._connect_button = ttk.Button(
            body, text="🌐  Se connecter via le navigateur", style="Primary.TButton", command=self._start_connect
        )
        self._connect_button.pack(pady=(18, 6), ipadx=18, ipady=6)
        self._cancel_link = self._link(body, "Annuler", self._cancel_connect)
        self._status = tk.Label(body, text="", bg=BG, fg=TEXT_MUTED, font=(_FONT, 9), wraplength=_WRAP, justify="center")
        self._status.pack(pady=(4, 10))

        guide = tk.Frame(body, bg=PANEL)
        guide.pack(fill="x", pady=(0, 10))
        for text in (
            "1.  Ton navigateur s'ouvre sur HotS Analytics.",
            "2.  Connecte-toi si besoin, puis clique sur « Autoriser ce PC ».",
            "3.  Reviens ici : la suite se fait toute seule.",
        ):
            tk.Label(guide, text=text, bg=PANEL, fg=TEXT, font=(_FONT, 9), anchor="w").pack(fill="x", padx=14, pady=3)

        self._manual_link = self._link(body, "Ça ne marche pas ? Récupérer le token manuellement", self._toggle_manual)
        self._manual_frame = tk.Frame(body, bg=BG)

    def _start_connect(self) -> None:
        if self._busy:
            return
        self._busy = True
        self._cancel = threading.Event()
        cancel = self._cancel
        self._connect_button.state(["disabled"])
        self._cancel_link.pack(after=self._connect_button)
        self._set_status("Navigateur ouvert : termine l'autorisation, puis reviens ici.", TEXT_MUTED)

        def work() -> None:
            result = self._hooks.authorize(cancel)
            self._hooks.schedule(self._on_auth_result, result)

        threading.Thread(target=work, name="hots-wizard-auth", daemon=True).start()

    def _cancel_connect(self) -> None:
        self._cancel.set()

    def _on_auth_result(self, result: AuthorizationResult) -> None:
        if not self._alive:
            return
        self._busy = False
        self._connect_button.state(["!disabled"])
        self._cancel_link.pack_forget()
        if result.token:
            self._token_accepted(result.token)
            return
        self._set_status(f"✗ {result.error or 'Échec de la connexion.'}", ERROR)
        if not self._manual_link.winfo_ismapped():
            self._manual_link.pack(pady=(0, 6))

    def _token_accepted(self, token: str) -> None:
        self._hooks.store_token(token)
        self._set_status("✓ Connecté !", OK)
        self._later(_CONNECTED_PAUSE_MS, self._advance)

    def _toggle_manual(self) -> None:
        if self._manual_frame.winfo_ismapped():
            self._manual_frame.pack_forget()
            return
        frame = self._manual_frame
        for child in frame.winfo_children():
            child.destroy()
        tk.Label(
            frame,
            text="Ouvre la page des tokens, génère-en un (il est copié automatiquement), puis colle-le ici.",
            bg=BG, fg=TEXT_MUTED, font=(_FONT, 9), wraplength=_WRAP, justify="center",
        ).pack(pady=(4, 6))
        ttk.Button(frame, text="Ouvrir la page des tokens", style="Secondary.TButton", command=self._hooks.open_token_page).pack()
        tk.Label(
            frame,
            text="Pas encore connecté sur le site ? Connecte-toi, puis rouvre cette page depuis ici.",
            bg=BG, fg=TEXT_MUTED, font=(_FONT, 8), wraplength=_WRAP, justify="center",
        ).pack(pady=(4, 8))
        wrapper = tk.Frame(frame, bg=FIELD_BG, highlightthickness=1, highlightbackground=FIELD_BG)
        wrapper.pack(fill="x")
        entry = tk.Entry(
            wrapper, textvariable=self._paste_var, bg=FIELD_BG, fg=TEXT, insertbackground=TEXT,
            relief="flat", font=(_FONT, 10),
        )
        entry.pack(fill="x", padx=10, pady=8)
        entry.bind("<FocusIn>", lambda _e: wrapper.configure(bg=FIELD_BG_FOCUS, highlightbackground=ACCENT))
        entry.bind("<FocusOut>", lambda _e: wrapper.configure(bg=FIELD_BG, highlightbackground=FIELD_BG))
        self._validate_button = ttk.Button(frame, text="Valider", style="Primary.TButton", command=self._validate_manual)
        self._validate_button.pack(pady=(8, 0))
        frame.pack(fill="x", pady=(4, 0))
        entry.focus_set()

    def _validate_manual(self) -> None:
        token = normalize_pasted_token(self._paste_var.get())
        if token is None:
            self._set_status("✗ Ce n'est pas un token valide : il commence par « hots_pat_ » et ne contient pas d'espace.", ERROR)
            return
        self._validate_button.state(["disabled"])
        self._set_status("Vérification du token…", TEXT_MUTED)

        def work() -> None:
            ok = self._hooks.verify_token(token)
            self._hooks.schedule(self._on_manual_result, token, ok)

        threading.Thread(target=work, name="hots-wizard-verify", daemon=True).start()

    def _on_manual_result(self, token: str, ok: bool) -> None:
        if not self._alive:
            return
        self._validate_button.state(["!disabled"])
        if ok:
            self._token_accepted(token)
        else:
            self._set_status("✗ Le serveur a refusé ce token. Génère-en un nouveau sur la page des tokens.", ERROR)

    # -- step 2: storage --------------------------------------------------

    def _build_storage(self) -> None:
        body = self._body
        self._heading("Où sont tes replays ?", "On les détecte automatiquement. Change le dossier seulement si besoin.")
        self._continue_button = self._nav(back=True, next_text="Continuer →", next_cmd=self._advance, enabled=False)

        row = tk.Frame(body, bg=BG)
        row.pack(fill="x", pady=(16, 0))
        wrapper = tk.Frame(row, bg=FIELD_BG, highlightthickness=1, highlightbackground=FIELD_BG)
        wrapper.pack(side="left", fill="x", expand=True)
        tk.Entry(
            wrapper, textvariable=self._replays_var, bg=FIELD_BG, fg=TEXT, insertbackground=TEXT,
            relief="flat", font=(_FONT, 10),
        ).pack(fill="x", padx=10, pady=8)
        ttk.Button(row, text="Parcourir…", style="Secondary.TButton", command=self._hooks.browse_dir).pack(side="left", padx=(8, 0))

        self._dir_status = tk.Label(body, text="", bg=BG, fg=TEXT_MUTED, font=(_FONT, 9), anchor="w")
        self._dir_status.pack(fill="x", pady=(6, 0))
        self._dir_summary = tk.Label(body, text="", bg=BG, fg=TEXT_MUTED, font=(_FONT, 9), anchor="w", justify="left", wraplength=_WRAP)
        self._dir_summary.pack(fill="x", pady=(2, 0))

        if self._autostart_var is not None:
            tk.Checkbutton(
                body, text="Lancer HotS Analytics au démarrage de Windows (en arrière-plan)",
                variable=self._autostart_var, command=self._on_autostart,
                bg=BG, fg=TEXT, selectcolor=FIELD_BG, activebackground=BG, activeforeground=TEXT,
                highlightthickness=0, borderwidth=0, font=(_FONT, 9), anchor="w",
            ).pack(fill="x", pady=(16, 0))
        self._refresh_dir()

    def _on_autostart(self) -> None:
        self._hooks.on_autostart_toggled()

    def _on_replays_changed(self, *_args) -> None:
        if self._alive and self.flow.step is Step.STORAGE and self._continue_button is not None:
            self._refresh_dir()

    def _refresh_dir(self) -> None:
        check = describe_replays_dir(self._replays_var.get())
        self._dir_status.configure(text=check.status, fg=OK if check.ok else ERROR)
        self._dir_summary.configure(text=check.summary)
        if self._continue_button is not None:
            self._continue_button.state(["!disabled"] if check.ok else ["disabled"])

    # -- step 3: ready ----------------------------------------------------

    def _build_ready(self) -> None:
        body = self._body
        self._heading("Tout est prêt !", "HotS Analytics va synchroniser tes parties en arrière-plan.")
        self._finish_button = self._nav(back=True, next_text="Accéder à l'app →", next_cmd=self._hooks.finish)

        recap = tk.Frame(body, bg=PANEL)
        recap.pack(fill="x", pady=(16, 0))
        lines = [
            "✓  Compte connecté",
            f"✓  Dossier surveillé : {self._replays_var.get().strip()}",
        ]
        if self._autostart_var is not None:
            lines.append("✓  Lancement avec Windows : " + ("activé" if self._autostart_var.get() else "désactivé"))
        for text in lines:
            tk.Label(
                recap, text=text, bg=PANEL, fg=TEXT, font=(_FONT, 9), anchor="w", justify="left", wraplength=_WRAP,
            ).pack(fill="x", padx=14, pady=4)
```

Notes for the implementer: `Primary.TButton` / `Secondary.TButton` come from `gui._configure_button_styles` (called by `gui._apply_dark_style()`); the fixture calls it. If `Image.LANCZOS` is deprecated in the installed Pillow, use `Image.Resampling.LANCZOS`.

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_gui_onboarding.py -q` → all PASS. If the headless Tk root can't be created the module is skipped; run it on a desktop session before moving on.

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/gui_onboarding.py daemon-python/tests/test_gui_onboarding.py
git commit -m "feat(daemon): onboarding wizard widget (connect, storage, ready, manual token fallback)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Main window layout — fixed tabs/footer, tab order, Update in Config, responsive sync panel

**Files:**
- Modify: `daemon-python/src/gui.py` (`_build_ui`, `_build_config_tab`, `_build_update_tab`→`_build_update_section`, `_build_sync_tab`, `_refresh_live_stats`, `_apply_api_version` usage, `__init__` for wrap arming, docstring at top)
- Modify: `daemon-python/src/sync_table.py` (banner text mentions the Update tab)
- Test: `daemon-python/tests/test_gui_window.py` (create)

**Interfaces:**
- Consumes: `sync_layout.{recap_columns, progress_summary}`, `CollapsibleCard.header_actions`, `SyncTable(pause_parent=)`.
- Produces: `_SettingsWindow._notebook` (the `TabView`), `_SettingsWindow._footer` (footer frame), tab keys order `["sync", "draft_live", "config"]` (+ no `"update"` key).

- [ ] **Step 1: Write the failing smoke tests**

```python
# daemon-python/tests/test_gui_window.py
import tkinter as tk
from unittest import mock

import pytest

from src import gui
from src.status import StatusTracker


@pytest.fixture(scope="module")
def tk_root():
    try:
        root = tk.Tk()
    except tk.TclError:
        pytest.skip("Tk cannot create a root window here")
    root.attributes("-alpha", 0.0)  # invisible but mapped: a withdrawn root never maps its children
    yield root
    root.destroy()


@pytest.fixture
def window(tk_root, tmp_path):
    (tmp_path / "Accounts" / "1" / "2-Hero-1-1" / "Replays" / "Multiplayer").mkdir(parents=True)
    existing = {"apiBaseUrl": "https://api.example.com", "accessToken": "hots_pat_x", "hotsDir": str(tmp_path)}
    top = tk.Toplevel(tk_root)
    top.attributes("-alpha", 0.0)
    with (
        mock.patch.object(gui, "read_config_file", return_value=existing),
        mock.patch.object(gui.api_client, "ping_health", return_value=False),
        mock.patch.object(gui.api_client, "fetch_summary", return_value=None),
        mock.patch.object(gui.api_client, "fetch_version", return_value=None),
        mock.patch.object(gui.autostart, "is_supported", return_value=False),
        mock.patch.object(gui.updater, "IS_FROZEN", False),
    ):
        win = gui._SettingsWindow(
            top, is_first_run=False, result={"saved": False}, status_tracker=StatusTracker()
        )
        top.update()
        yield win, top
        win._stop_background_jobs()
    top.destroy()


def test_tabs_are_sync_then_draft_then_config(window):
    win, _top = window
    assert list(win._tabs) == ["sync", "draft_live", "config"]


def test_footer_has_icon_only_buttons_with_tooltips_and_the_right_emphasis(window):
    win, _top = window
    assert {"data_folder", "site"} <= set(win._footer_tooltips)
    assert all(tip.text for tip in win._footer_tooltips.values())
    for key in win._footer_tooltips:
        assert str(win._footer_buttons[key].cget("style")) == "Icon.Secondary.Ghost.TButton"
        assert win._footer_buttons[key].cget("text") in ("🐞", "📁", "🌐")
    assert str(win._minimize_button.cget("style")) == "Primary.TButton"
    assert "Réduire" in win._minimize_button.cget("text")
    assert str(win._close_button.cget("style")) == "Danger.Ghost.TButton"


def test_site_button_opens_the_dashboard(window):
    win, _top = window
    with mock.patch.object(gui.webbrowser, "open") as opened:
        win._open_site()
    opened.assert_called_once_with("https://app.example.com")


def test_footer_and_tab_bar_stay_visible_when_the_window_is_small(window):
    win, top = window
    top.geometry("640x480")
    top.update()
    bottom = top.winfo_rooty() + top.winfo_height()
    assert win._footer.winfo_ismapped()
    assert win._footer.winfo_rooty() + win._footer.winfo_height() <= bottom
    assert win._notebook._bar.winfo_ismapped()
    assert win._notebook._bar.winfo_rooty() - top.winfo_rooty() <= 20  # small top margin


def test_progress_bar_never_overflows_a_narrow_window(window):
    win, top = window
    top.geometry("560x520")
    top.update()
    right_edge = top.winfo_rootx() + top.winfo_width()
    bar = win._sync_progress_bar
    assert bar.winfo_rootx() + bar.winfo_width() <= right_edge


def test_activity_panel_is_a_collapsible_card_titled_activite_en_cours(window):
    win, _top = window
    assert win._activity_card is not None
```
(`test_activity_panel…` needs a `sync_state`; if the fixture passes none the card is absent — add `sync_state=mock.Mock()`-style fake only if `SyncTable` accepts it; otherwise drop this test and verify the card visually in Step 6. Prefer reusing `_FakeState` from `tests/test_sync_table.py` by copying the 15-line class into this file.)

- [ ] **Step 2: Run to verify failure**

`pytest tests/test_gui_window.py -q` → FAIL (`list(win._tabs)` is `["config", "draft_live", "sync"]`; `_footer`/`_notebook` don't exist).

- [ ] **Step 3a: `_build_ui` — fixed footer, scroll only in the tab area, small top margin.** Replace the whole method (currently `gui.py:748-795`):

```python
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
```
Also initialize `self._wrap_targets: list[tuple[tk.Misc, tuple[ttk.Label, ...]]] = []` in `__init__` (next to `self._pages`). Import `Tooltip` from `.gui_widgets` and `guess_web_base_url` from `.urls`, and add next to `_open_data_folder`:

```python
    def _open_site(self) -> None:
        webbrowser.open(guess_web_base_url(self._api_var.get() or DEFAULT_API_BASE_URL))
```

- [ ] **Step 3b: Update merged into Config.** In `_build_config_tab` add the update section first:

```python
    def _build_config_tab(self, parent: ttk.Frame) -> None:
        if updater.IS_FROZEN:
            self._build_update_section(parent)
        self._build_connexion_section(parent)
        self._build_stockage_section(parent)
        self._build_demarrage_section(parent)
```
Rename `_build_update_tab` → `_build_update_section` and change its first lines to `card = CollapsibleCard(parent, "MISES À JOUR", "⬆")` / `card.pack(fill="x", pady=(0, 12))`. In `_build_demarrage_section`, nothing changes. Update comments that mention "Update tab" (module docstring: "(Config / Draft Live / Synchronisation / Update)" → "(Synchronisation / Draft Live / Config)"; `__init__` comment about "The Update tab (and …)"; `run_settings_window` docstring "Update tab's live progress" → "Config's update section"; `_measure_worst_case_size` is unaffected since it uses `hasattr`). In `sync_table.py::_update_controls` change "Ouvrez l'onglet Mise à jour." to "Ouvrez Config › Mises à jour.". Then:

Run: `grep -rn "onglet Update\|onglet Mise à jour\|Update tab" daemon-python --include=*.py --include=*.md` and fix any remaining user-facing/docs reference (README.md included).

- [ ] **Step 3c: Responsive sync recap + collapsible activity panel.** Add imports `from .sync_layout import progress_summary, recap_columns`. Replace the body of `_build_sync_tab` after the first-run stub with:

```python
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
```
In `__init__`, call `self._arm_dynamic_wrap()` right after `self._center()`. In `_refresh_live_stats`, replace the `done = …` / `self._sync_progress_bar["value"] = …` block and the three label configures with:

```python
        self._found_count_label.configure(text=str(status.found))
        self._synced_count_label.configure(
            text=f"{status.synced} ok" + (f" · {status.failed} échouées" if status.failed else "")
        )
        ...
        progress = progress_summary(status.found, status.synced, status.failed)
        self._sync_progress_bar["value"] = progress.percent
        self._sync_progress_label.configure(text=progress.label)
```
(keep the existing skipped/currently-syncing/error label code unchanged). `_apply_token_status` still sets `_games_count_label` (now a `tk.Label`; `.configure(text=…)` works unchanged). Update `_measure_worst_case_size` only if the tests show the window opening taller than the screen; the `hasattr(self, "_update_status_label")` guard already covers the moved section.

- [ ] **Step 4: Run to verify pass**

`pytest tests/test_gui_window.py tests/test_sync_table.py tests/test_gui_widgets.py -q` → PASS.

- [ ] **Step 5: Run the whole daemon suite**

`pytest -q` → PASS (no regressions).

- [ ] **Step 6: Manual check** — `python -m src.main`, open settings from the tray: shrink the window to its minimum; confirm tabs and footer never leave the screen, the progress bar never exceeds the card, tiles reflow 3→2→1 columns, the activity card folds with its pause button staying clickable, and the Update section sits at the top of Config (frozen build only).

- [ ] **Step 7: Commit**

```bash
git add daemon-python/src/gui.py daemon-python/src/sync_table.py daemon-python/tests/test_gui_window.py
git commit -m "feat(daemon): sync first, Update merged into Config, fixed tabs/footer, responsive sync recap, collapsible activity panel" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Wire the wizard into the window, the app and the tray

**Files:**
- Modify: `daemon-python/src/gui.py` (imports, `__init__`, `_check_replays_dir`, `_apply_token_status`, new `_show_view`, `_wizard_hooks`, `_store_token`, `_finish_onboarding`)
- Modify: `daemon-python/src/tray.py` (new `open_settings`)
- Modify: `daemon-python/src/app.py` (signed-out startup, logout stop, reopen the full window after a first run / reconnection)
- Modify: `daemon-python/src/config.py` (`has_access_token`, `clear_access_token`)
- Test: `daemon-python/tests/test_gui_window.py` (append), `daemon-python/tests/test_config.py` (append)

**Interfaces:**
- Consumes: Task 1 (`View`, `initial_view`, `view_after_token_check`, `describe_replays_dir`), Task 2 (`guess_token_page_url`), Task 5 (`OnboardingView`, `OnboardingHooks`).
- Produces: `_SettingsWindow._current_view: View`, `_SettingsWindow._startup_check_pending: bool`, `_SettingsWindow._show_view(view)`, `_SettingsWindow._sign_out()`, `_SettingsWindow._close_blocked_by(error) -> bool`, `TrayController.open_settings()`, `config.has_access_token() -> bool`, `config.clear_access_token() -> None`; new keyword-only parameters on `run_settings_window` and `_SettingsWindow`: `on_logout: Callable[[], None] | None = None` (stop the watcher), `on_reconnected: Callable[[], None] | None = None` (the wizard finished a reconnection), `require_login: bool = False` (startup window that must not close without a token).

- [ ] **Step 1: Failing tests** — append to `tests/test_gui_window.py`:

```python
from src.onboarding import View


def test_only_the_startup_token_check_can_open_the_wizard(window):
    win, _top = window
    win._startup_check_pending = False
    win._show_view(View.MAIN)
    win._apply_token_status("invalid")  # user typing a partial token in Config
    assert win._current_view is View.MAIN

    win._startup_check_pending = True
    win._apply_token_status("invalid")  # the check made when the window opened
    assert win._current_view is View.WIZARD_CONNECT
    assert win._onboarding is not None


def test_an_unreachable_api_at_startup_keeps_the_main_view(window):
    win, _top = window
    win._startup_check_pending = True
    win._apply_token_status("unknown")
    assert win._current_view is View.MAIN
    assert win._startup_check_pending is False


def test_window_without_a_stored_token_opens_on_the_connect_step(tk_root, tmp_path):
    existing = {"apiBaseUrl": "https://api.example.com", "accessToken": "", "hotsDir": str(tmp_path)}
    (tmp_path / "Accounts").mkdir()
    top = tk.Toplevel(tk_root)
    top.attributes("-alpha", 0.0)
    with (
        mock.patch.object(gui, "read_config_file", return_value=existing),
        mock.patch.object(gui.api_client, "ping_health", return_value=False),
        mock.patch.object(gui.autostart, "is_supported", return_value=False),
        mock.patch.object(gui.updater, "IS_FROZEN", False),
    ):
        win = gui._SettingsWindow(top, is_first_run=False, result={"saved": False})
        top.update()
        assert win._current_view is View.WIZARD_CONNECT
        win._stop_background_jobs()
    top.destroy()


def test_finishing_the_wizard_notifies_the_app_then_closes_the_window(window):
    win, _top = window
    win._on_reconnected = mock.Mock()
    win._on_close = mock.Mock()
    win._finish_onboarding()  # the saved config equals the form, so nothing is written
    win._on_reconnected.assert_called_once_with()
    win._on_close.assert_called_once_with()


def test_sign_out_stops_the_watcher_clears_the_token_and_shows_the_connect_step(window):
    win, _top = window
    win._on_logout = mock.Mock()
    with (
        mock.patch.object(gui.messagebox, "askyesno", return_value=True),
        mock.patch.object(gui, "clear_access_token") as cleared,
    ):
        win._sign_out()
    win._on_logout.assert_called_once_with()
    cleared.assert_called_once_with()
    assert win._token_var.get() == ""
    assert win._current_view is View.WIZARD_CONNECT


def test_sign_out_does_nothing_when_the_user_declines(window):
    win, _top = window
    win._on_logout = mock.Mock()
    with (
        mock.patch.object(gui.messagebox, "askyesno", return_value=False),
        mock.patch.object(gui, "clear_access_token") as cleared,
    ):
        win._sign_out()
    win._on_logout.assert_not_called()
    cleared.assert_not_called()
    assert win._token_var.get() == "hots_pat_x"


def test_sign_out_button_is_disabled_without_a_token(window):
    win, _top = window
    assert not win._signout_button.instate(["disabled"])
    win._token_var.set("")
    assert win._signout_button.instate(["disabled"])


def test_closing_is_only_blocked_when_there_is_nothing_valid_to_keep(window):
    win, _top = window
    assert win._close_blocked_by(None) is False
    win._last_saved = None  # nothing valid saved yet...
    win._token_var.set("")  # ...and signed out, reopened from the tray
    assert win._close_blocked_by("Le token d'accès est requis.") is False
    win._require_login = True  # the startup window must not close unconnected
    assert win._close_blocked_by("Le token d'accès est requis.") is True
    win._require_login = False
    win._token_var.set("hots_pat_x")  # a token but an invalid config (e.g. bad folder)
    assert win._close_blocked_by("Le dossier Heroes of the Storm est invalide.") is True
```

Append to `tests/test_config.py` (add `import json` and `from src import config` if not already imported there):

```python
def _write_config(tmp_path, monkeypatch, values):
    path = tmp_path / "config.json"
    path.write_text(json.dumps(values), encoding="utf-8")
    monkeypatch.setattr(config, "config_file_path", lambda: path)
    monkeypatch.delenv("HOTS_ACCESS_TOKEN", raising=False)
    return path


def test_clear_access_token_blanks_only_the_token(tmp_path, monkeypatch):
    path = _write_config(
        tmp_path, monkeypatch,
        {"apiBaseUrl": "https://a", "accessToken": "hots_pat_x", "hotsDir": "C:/h", "draftHotkey": "F9"},
    )
    assert config.has_access_token() is True
    config.clear_access_token()
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["accessToken"] == ""
    assert saved["hotsDir"] == "C:/h" and saved["draftHotkey"] == "F9" and saved["apiBaseUrl"] == "https://a"
    assert config.has_access_token() is False


def test_clear_access_token_without_a_config_file_does_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "config_file_path", lambda: tmp_path / "missing.json")
    monkeypatch.delenv("HOTS_ACCESS_TOKEN", raising=False)
    config.clear_access_token()
    assert not (tmp_path / "missing.json").exists()
    assert config.has_access_token() is False


def test_has_access_token_accepts_the_environment_override(tmp_path, monkeypatch):
    _write_config(tmp_path, monkeypatch, {"accessToken": ""})
    monkeypatch.setenv("HOTS_ACCESS_TOKEN", "hots_pat_env")
    assert config.has_access_token() is True
```

- [ ] **Step 2:** `pytest tests/test_gui_window.py -q` → the new tests FAIL (`_show_view` missing).

- [ ] **Step 3a: gui.py imports and `__init__`.** Add:

```python
from .gui_onboarding import OnboardingHooks, OnboardingView
from .onboarding import View, describe_replays_dir, initial_view, view_after_token_check
from .urls import DEFAULT_API_BASE_URL, guess_settings_url, guess_token_page_url
```
(extend the existing `.urls` import). In `__init__`, next to `self._connect_busy`, add `self._onboarding: OnboardingView | None = None`, `self._current_view = View.MAIN`, `self._startup_check_pending = True`. After `self._center()` / `self._arm_dynamic_wrap()` and **before** `self._check_connection()` add:

```python
        # After `_center`: the window is sized from the notebook, which the
        # wizard hides, so the order matters.
        self._show_view(initial_view(is_first_run=is_first_run, token=self._token_var.get()))
```

- [ ] **Step 3b: refactor `_check_replays_dir`** (DRY with the wizard):

```python
    def _check_replays_dir(self) -> None:
        check = describe_replays_dir(self._replays_var.get())
        self._set_status(self._replays_status, check.status, _OK if check.ok else _ERROR)
        self._accounts_var.set(check.summary)
```

- [ ] **Step 3c: new methods** (place under a `# -- onboarding --` section before `# -- autostart --`):

```python
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
```
In `_apply_token_status`, at the top, add:

```python
        token_state = state if isinstance(state, str) else "valid"
        if self._startup_check_pending:
            # Only the check made when the window opened may open the wizard:
            # a half-typed token in Config is "invalid" too.
            self._startup_check_pending = False
            next_view = view_after_token_check(self._current_view, token_state)
            if next_view is not self._current_view:
                self._show_view(next_view)
```
Also in `_on_close` and `_on_quit_clicked` the existing `self._auth_cancel.set()` stays; the view cancels its own event in `destroy()` — `_stop_background_jobs` should also destroy it: add `if self._onboarding is not None: self._onboarding.destroy(); self._onboarding = None` there (before `self._closed` handling is fine).

- [ ] **Step 3d: tray + app.** `tray.py`, add a public method next to `_handle_open_settings`:

```python
    def open_settings(self) -> None:
        """Opens the settings window as a tray click would (no-op if one is already open)."""
        self._handle_open_settings(self._icon, None)
```
(its callback ignores both arguments; the type hint on `_item` can stay as is.) In `app.py`, right after `daemon.start(config, announce_initial_scan=first_run)`:

```python
    if first_run:
        # The wizard just closed: land on the classic window (with live sync
        # stats) instead of leaving only a tray icon.
        tray.open_settings()
```
`tray.run()` blocks later; `open_settings` only spawns the window thread, which is safe before `run()`.

- [ ] **Step 3e: Sign-out, reconnection and signed-out startup.**

`config.py` — add after `read_config_file`:

```python
def has_access_token() -> bool:
    """True when a token is available (environment override or config file)."""
    if os.environ.get("HOTS_ACCESS_TOKEN"):
        return True
    try:
        return bool(read_config_file().get("accessToken"))
    except ConfigError:
        return False


def clear_access_token() -> None:
    """Signs this PC out: blanks the stored token and keeps every other setting.
    `load_config()` raises on a blank token, so `run_app` checks
    `has_access_token()` before loading (see app.py)."""
    values = read_config_file()
    if not values:
        return
    values["accessToken"] = ""
    config_file_path().write_text(json.dumps(values, indent=2), encoding="utf-8")
```

`gui.py` — import `clear_access_token` from `.config`; add the three keyword-only parameters (`on_logout`, `on_reconnected`, `require_login`) to `run_settings_window` and `_SettingsWindow.__init__` (pass them through; document them in `run_settings_window`'s docstring), store `self._on_logout`, `self._on_reconnected`, `self._require_login`. In `_build_connexion_section`, right after `self._connect_button.pack(side="left")`:

```python
        self._signout_button = ttk.Button(
            connect_row, text="Se déconnecter", style="Danger.Ghost.TButton", command=self._sign_out
        )
        self._signout_button.pack(side="left", padx=(10, 0))
```
In `__init__`, right after `self._prefill()`:

```python
        self._token_var.trace_add("write", self._refresh_signout_button)
        self._refresh_signout_button()
```
New methods (in the `# -- onboarding --` section):

```python
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
```
In `_on_close`, replace `if error is not None and self._last_saved is None:` with `if self._close_blocked_by(error):` (body unchanged).

`app.py` — import `has_access_token` from `.config`. Replace the first-run block and `_on_open_settings`:

```python
    first_run = not config_exists()
    # Signed out (token blanked by the settings window's "Se déconnecter"):
    # load_config() would raise, so ask for a connection instead of exiting.
    needs_login = not first_run and not has_access_token()
    if first_run:
        logger.info("No configuration found, opening first-run setup window.")
        if not run_settings_window(is_first_run=True):
            logger.info("Setup was cancelled, exiting.")
            return 1
    elif needs_login:
        logger.info("No access token (signed out), opening the connect window.")
        if not run_settings_window(is_first_run=False, require_login=True):
            logger.info("Connection was cancelled, exiting.")
            return 1
```
```python
    def _on_logout() -> None:
        # `stop()` can block for several seconds: keep it off the Tk thread.
        threading.Thread(target=daemon.stop, name="hots-logout-stop", daemon=True).start()

    reopen_after_close = threading.Event()

    def _on_open_settings() -> None:
        reopen_after_close.clear()
        saved = run_settings_window(
            is_first_run=False,
            status_tracker=daemon.status,
            sync_state=daemon.sync_state,
            update_status=update_status,
            draft_capture_status=daemon.draft_capture_status,
            hotkey_manager=daemon.hotkey_manager,
            on_manual_capture=daemon.trigger_draft_capture,
            scheduler=daemon.scheduler,
            dependency_guard=daemon.dependency_guard,
            on_quit=lambda: tray.quit(),
            on_logout=_on_logout,
            on_reconnected=reopen_after_close.set,
        )
        if saved:
            try:
                new_config = load_config()
            except ConfigError as err:
                logger.error("New configuration is invalid, keeping the previous one running: %s", err)
                return
            logger.info("Configuration changed, restarting the replay watcher.")
            daemon.start(new_config)
        if reopen_after_close.is_set():
            # Reconnected: the watcher now runs with the new token, so land back
            # on the classic window with fresh live stats.
            _on_open_settings()
```
and change the post-start block from `if first_run:` to `if first_run or needs_login:` (same `tray.open_settings()` body). `daemon.start()` begins with `self.stop()`, so restarting after a sign-out already stopped the watcher is safe.

- [ ] **Step 4:** `pytest tests/test_gui_window.py tests/test_onboarding.py tests/test_gui_onboarding.py tests/test_config.py -q` → PASS; then `pytest -q` → PASS.

- [ ] **Step 5: Manual end-to-end check** (needs the web app: `bun run dev:api`, `bun run dev:web`)
  1. Delete `%APPDATA%/hots-analytics/config.json` (note its path via the "Dossier de données" button first), run `python -m src.main` → logo + loading bar → step ①.
  2. Click « Se connecter via le navigateur » → authorize in the browser → daemon moves to ② → ③ → « Accéder à l'app » → the classic window opens on Synchronisation.
  3. Revoke the token on `/upload`, reopen the window from the tray → connect-only wizard; reconnect → the window closes, the watcher restarts, and the full window reopens on Synchronisation.
  3b. Config › Connexion › « Se déconnecter » → confirm → connect step; uploads stop (the sync table stops moving); quit and relaunch the daemon → it opens the connect window instead of exiting; reconnect → full window reopens. Reopen from the tray after a sign-out and press « Réduire » → closes without the "Complétez la configuration" error.
  3c. Footer: hover each icon button for ~0.4 s → tooltip above it; click → tooltip disappears; the 🌐 button opens the site; « 🗕 Réduire » is solid, « Fermer » is a red outline.
  4. Block the API port, retry step ① → error + manual link; paste a token → accepted.

- [ ] **Step 6: Commit**

```bash
git add daemon-python/src/gui.py daemon-python/src/tray.py daemon-python/src/app.py daemon-python/tests/test_gui_window.py
git commit -m "feat(daemon): onboarding wizard on first run and when the token is rejected" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Web page `/daemon/token`

**Files:**
- Create: `apps/web/app/utils/tokenPage.ts`
- Test: `apps/web/app/utils/tokenPage.test.ts`
- Create: `apps/web/app/pages/daemon/token.vue`

**Interfaces:**
- Consumes: `useTokens()` (`tokens`, `pending`, `revealed`, `creating`, `deletingId`, `createToken(): Promise<string>`, `deleteToken(id)`), `auth` route middleware, `blank` layout.
- Produces: `otherTokenIds(tokens: readonly { id: string }[], keepId: string | null): string[]`.

- [ ] **Step 1: Failing test** (match the import style of `daemonAuthorization.test.ts` in the same folder):

```ts
// apps/web/app/utils/tokenPage.test.ts
import { describe, expect, it } from "vitest";
import { otherTokenIds } from "./tokenPage";

describe("otherTokenIds", () => {
  const tokens = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("returns every token except the one to keep", () => {
    expect(otherTokenIds(tokens, "b")).toEqual(["a", "c"]);
  });

  it("returns everything when nothing is kept", () => {
    expect(otherTokenIds(tokens, null)).toEqual(["a", "b", "c"]);
  });

  it("returns nothing for an empty list", () => {
    expect(otherTokenIds([], "x")).toEqual([]);
  });
});
```

- [ ] **Step 2:** `bun run --filter './apps/web' test app/utils/tokenPage.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// apps/web/app/utils/tokenPage.ts
/** Ids of every token except `keepId` — what "Tout supprimer sauf celui-ci" deletes. */
export function otherTokenIds(tokens: readonly { id: string }[], keepId: string | null): string[] {
  return tokens.filter((t) => t.id !== keepId).map((t) => t.id);
}
```

```vue
<!-- apps/web/app/pages/daemon/token.vue -->
<script setup lang="ts">
import { useClipboard } from "@vueuse/core";
import { otherTokenIds } from "~/utils/tokenPage";

definePageMeta({ layout: "blank", middleware: "auth" });

useSeoMeta({
  title: "Token pour le daemon",
  robots: "noindex, nofollow",
});

const { tokens, pending, revealed, creating, deletingId, createToken, deleteToken } = useTokens();

const newTokenId = ref<string | null>(null);
const newToken = computed(() => (newTokenId.value ? (revealed.value[newTokenId.value] ?? "") : ""));
const { copy, copied } = useClipboard({ source: newToken, copiedDuring: 5000 });
const copyFailed = ref(false);
const failure = ref<string | null>(null);

async function copyNow() {
  copyFailed.value = false;
  try {
    await copy(newToken.value);
    if (!copied.value) copyFailed.value = true;
  } catch {
    copyFailed.value = true;
  }
}

async function onGenerate() {
  failure.value = null;
  try {
    newTokenId.value = (await createToken()) ?? null;
    await copyNow();
  } catch {
    failure.value = "Impossible de créer le token. Réessaie dans un instant.";
  }
}

// Same two-click guard as TokenCard: a destructive bulk action shouldn't fire on a misclick.
const confirmingPurge = ref(false);
const purging = ref(false);
let purgeTimer: ReturnType<typeof setTimeout> | null = null;

async function onPurgeOthers() {
  if (!confirmingPurge.value) {
    confirmingPurge.value = true;
    purgeTimer = setTimeout(() => (confirmingPurge.value = false), 3000);
    return;
  }
  if (purgeTimer) clearTimeout(purgeTimer);
  confirmingPurge.value = false;
  purging.value = true;
  try {
    for (const id of otherTokenIds(tokens.value, newTokenId.value)) await deleteToken(id);
  } finally {
    purging.value = false;
  }
}

onUnmounted(() => {
  if (purgeTimer) clearTimeout(purgeTimer);
});

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("fr-FR") : "jamais";
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center p-4 sm:p-8">
    <div class="w-full max-w-lg space-y-5">
      <div class="flex items-center gap-2.5">
        <img src="/favicon.svg" alt="" width="32" height="32" class="h-8 w-8">
        <h1 class="font-heading text-2xl">Token pour le daemon</h1>
      </div>

      <ol class="space-y-1.5 text-sm text-muted">
        <li><span class="text-foreground">1.</span> Génère ton token ci-dessous.</li>
        <li><span class="text-foreground">2.</span> Il est copié automatiquement.</li>
        <li><span class="text-foreground">3.</span> Retourne dans le daemon et colle-le dans le champ prévu.</li>
      </ol>

      <UCard>
        <div class="space-y-4">
          <UButton block size="lg" icon="i-heroicons-key" :loading="creating" @click="onGenerate">
            Générer mon token
          </UButton>

          <p v-if="failure" class="text-sm text-error">{{ failure }}</p>

          <div v-if="newToken" class="space-y-2 rounded-lg border border-brand/40 bg-brand/5 p-3">
            <p v-if="copied" class="flex items-center gap-1.5 text-sm font-medium text-success">
              <UIcon name="i-heroicons-check-circle" class="h-4 w-4" />
              Copié ! Colle-le maintenant dans la fenêtre du daemon.
            </p>
            <p v-else-if="copyFailed" class="text-sm text-warning">
              La copie automatique a été refusée par le navigateur. Copie-le ci-dessous.
            </p>
            <code class="block break-all rounded bg-background/60 p-2 font-mono text-xs text-foreground">{{ newToken }}</code>
            <UButton size="sm" variant="soft" icon="i-heroicons-clipboard" @click="copyNow">Copier à nouveau</UButton>
            <p class="text-xs text-muted">Ce token ne sera plus jamais affiché en clair : garde cette page ouverte jusqu'à l'avoir collé.</p>
          </div>
        </div>
      </UCard>

      <UCard>
        <div class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="font-heading text-sm font-medium">Tes tokens existants</h2>
            <UButton
              v-if="tokens.length > (newTokenId ? 1 : 0)"
              size="xs"
              color="error"
              variant="soft"
              :loading="purging"
              @click="onPurgeOthers"
            >
              {{ confirmingPurge ? "Confirmer la suppression" : newTokenId ? "Tout supprimer sauf celui-ci" : "Tout supprimer" }}
            </UButton>
          </div>

          <p v-if="!pending && tokens.length === 0" class="py-3 text-center text-xs text-muted">Aucun token actif.</p>

          <ul v-else class="space-y-2">
            <li
              v-for="token in tokens"
              :key="token.id"
              class="flex items-center gap-3 rounded-lg border border-border bg-surface p-2.5"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm text-foreground">
                  {{ token.name }}
                  <span v-if="token.id === newTokenId" class="ml-1 text-xs text-brand">(nouveau)</span>
                </p>
                <p class="text-xs text-muted">Dernière utilisation : {{ formatDate(token.lastUsedAt) }}</p>
              </div>
              <UButton
                size="xs"
                color="error"
                variant="ghost"
                icon="i-heroicons-trash"
                :loading="deletingId === token.id"
                aria-label="Supprimer ce token"
                @click="deleteToken(token.id)"
              />
            </li>
          </ul>
        </div>
      </UCard>
    </div>
  </main>
</template>
```
Notes: unauthenticated visitors are redirected to `/login` by the existing `auth` middleware and land on `/` afterwards (no return path — see Deviations). Deleting an individual token here is a single click, like the existing `TokenManager`'s hard delete minus its two-click guard — if you want parity, reuse `UploadTokenCard` instead of the inline row.

- [ ] **Step 4:** `bun run --filter './apps/web' test app/utils/tokenPage.test.ts` → PASS; `bun run typecheck` → PASS.

- [ ] **Step 5: Manual check** — `bun run dev:api` + `bun run dev:web`, sign in, open `/daemon/token`: generate → token shown + "Copié !" banner; deny clipboard permission in the browser → "Copie-le ci-dessous" fallback; create a second token, press « Tout supprimer sauf celui-ci » twice → only the new one remains; check the page at 360 px width.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/utils/tokenPage.ts apps/web/app/utils/tokenPage.test.ts apps/web/app/pages/daemon/token.vue
git commit -m "feat(web): dedicated /daemon/token page for manual daemon token retrieval" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Spec corrections, graph refresh, final verification

**Files:**
- Modify: `docs/superpowers/specs/2026-10-06-daemon-onboarding-wizard-design.md`

- [ ] **Step 1: Align the spec with the three deviations** — in §2 replace "unauthenticated users are redirected to `/login` and returned here afterwards" with "unauthenticated users are redirected to `/login` by the existing `auth` middleware (login has no return path, so the wizard tells them to reopen the page from the daemon after signing in)"; in §1 "Startup" replace the sentence about the progress bar being tied to the real connection check with "a ~1 s cosmetic progress bar on first run (no token to verify yet); the reconnect case already ran its token check before the wizard shows"; in §1 "③ C'est prêt" add "On a first run the setup window closes, the daemon starts, and `app.py` reopens the full settings window (`TrayController.open_settings()`)".

Also record the later additions in the spec: in §3 add the footer rules (Debug / Dossier de données / Ouvrir le site as icon-only ghost buttons with hover tooltips; « 🗕 Réduire » solid primary; « Fermer » ghost danger) and the Config › Connexion « Se déconnecter » button (local sign-out: stops syncing, blanks the token, keeps other settings; the token stays in the website list); in §1 state that reconnecting closes the window, the watcher restarts, and the full window reopens, and that a signed-out startup opens the connect window instead of exiting.

- [ ] **Step 2: Refresh the knowledge graph** (project rule): `graphify update .`

- [ ] **Step 3: Full verification**

```bash
cd daemon-python && pytest -q
cd .. && bun run typecheck && bun run build
bun run --filter './apps/web' test
```
Expected: all PASS. Report any failure with its output rather than claiming success.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-06-daemon-onboarding-wizard-design.md
git commit -m "docs(daemon): align onboarding spec with implementation findings" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (incl. later additions):** footer icons + tooltips + button emphasis → Tasks 4b, 6; « Se déconnecter » + signed-out startup → Task 7. §1 wizard → Tasks 1, 5, 7; manual fallback + paste field → Task 5; reconnect-only view (option A) → Tasks 1, 7; §2 web page → Task 8 (+ URL helpers Task 2); §3 tab order / Update→Config / fixed tabs+footer / margin / responsive recap / collapsible activity panel → Tasks 3, 4, 6; classic window after first run → Task 7. Tests per the spec's Testing section are in each task. No gaps.

**Placeholder scan:** none ("TBD"/"TODO" absent). Task 6's `test_activity_panel…` carries an explicit conditional instruction rather than a vague step.

**Type consistency:** `View`/`Step`/`WizardFlow`/`DirCheck`/`describe_replays_dir` (Task 1) are used with the same names in Tasks 5 and 7; `OnboardingHooks` fields in Task 5 match `_wizard_hooks` in Task 7; `CollapsibleCard.header_actions` / `SyncTable(pause_parent=)` (Task 4) match their use in Task 6; `guess_token_page_url` (Task 2) is used in Task 7; `progress_summary`/`recap_columns` (Task 3) match Task 6.

**Review Focus coverage:** each line has an owning test (Tasks 1, 5, 6, 7) except the clipboard-denied web case, which is a manual check (Task 8 Step 5) because `apps/web` has no page-level test setup.
