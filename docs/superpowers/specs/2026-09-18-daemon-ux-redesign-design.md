# Daemon Settings-Window UX Redesign — Design (C2)

## Context

`daemon-python/src/gui.py` (about 2 150 lines) is the daemon's entire UI: a fixed-size,
non-resizable `tk.Tk` window with a `ttk.Notebook` of four tabs (Config / Draft Live /
Synchronisation / Update), a standalone update-progress popup, and a read-only "Debug" text
dump. It is paired with a two-entry tray menu (`tray.py`).

An audit of that surface found:

1. **Fixed, non-resizable window.** `root.resizable(False, False)` plus
   `_measure_worst_case_size()` computes a "worst case" size and locks the window to it; to
   keep that valid, every dynamic string is truncated by hand (`_SYNCING_LABEL_MAX_CHARS`,
   `_ERROR_LABEL_MAX_CHARS`, `_LABEL_WRAPLENGTH`, five more). No scrolling anywhere. Long
   account lists and error text are clipped, and every new string is a layout hazard.
2. **No DPI awareness.** No `SetProcessDpiAwareness` call anywhere in `src/`: on a 125 %/150 %
   display the whole window is bitmap-scaled and blurry.
3. **Hand-rolled affordances.** `_build_field` wraps a `tk.Entry` in a `tk.Frame` to fake a
   bordered input with a focus ring; `_checkbutton` recolors a `tk.Checkbutton`. Consistent
   hover/focus/disabled states are not achievable that way.
4. **Emoji as icons** (📁, ✓, ✗, ℹ) with version-dependent rendering.
5. **No global health signal.** The window looks identical whether everything is synced or
   200 replays have failed; the only signals are a colored circle appended to a tab's text
   (`_set_tab_problem`) and one red line at the bottom.
6. **First run is not a flow.** `_is_first_run` shows every field at once and replaces the
   Synchronisation tab with a placeholder sentence.
7. **Synchronisation is a dashboard, not a control panel**: five counters, one progress bar,
   one "last error" line. No per-replay list, no grouping, no action.
8. **"Debug" is a read-only text dump** in a `Toplevel`: no filtering, no copy-one-line, no
   retry.
9. **No action is reachable from the UI** — only `python -m src.main --resync` on the CLI.
10. **The Update tab exists only when `updater.IS_FROZEN`**, so the tab set differs between a
    dev run and a packaged build.
11. **Tray is minimal** (`tray.py`): "Ouvrir les paramètres" / "Quitter", static tooltip.
12. **Accessibility**: hardcoded `("Segoe UI", 10)` fonts, fixed colors, no zoom; muted text
    `#8b90ad` on `#252a3d` is low-contrast.

The 2026-09-02 "daemon UX/reliability overhaul" spec already fixed four *behavioral* gaps
(manual draft capture, hotkey status/retry, reduced-priority sync, autostart repair) and
split the Config/Draft tabs into named sections. This spec is the next layer: the layout,
component, and interaction model those fixes now sit on.

## Goal

A settings window that is legible on any display, never clips content, tells the user the
overall health of the daemon at a glance, turns synchronisation from a report into a control
panel, and gives first-time users a guided path from "just installed" to "syncing" without
leaving the app (beyond the C1 browser handshake).

## Non-goals

- No i18n: the UI copy stays French.
- No change to the OCR/crop pipeline, the parser, the sync engine, or the update mechanism.
- No change to the ingestion or auth behavior (C1 owns the connect flow; this spec only lays
  its button out).
- No new runtime dependency (see Decision 1).

## Decision 1: stay on stdlib tkinter, invest in a design system

Three options were considered:

| Option | Pros | Cons |
|---|---|---|
| **A. Rework tkinter/ttk** | Zero new packaging risk (stdlib, already enabled via `--enable-plugin=tk-inter` in the Nuitka build); ships now; keeps the offline-first window | Ceiling is "clean native", not "web-modern" |
| **B. pywebview + WebView2** | Real HTML/CSS, could reuse the web design tokens; highest modernity ceiling | New runtime dependency (WebView2 runtime), real Nuitka/Velopack packaging risk, the window's one-Tk-mainloop threading contract is replaced wholesale, and the daemon would lose its offline/no-runtime-guarantee property |
| **C. Serve the UI and open the real browser** | Maximum reuse of the web app | Needs a local HTTP server, makes settings depend on a browser and (for the web UI) a session, and breaks the "works with no network and no login" guarantee the daemon currently has |

**Decision: Option A.** The window is a configuration and status surface, not a rich
application; `gui.py`'s own module docstring already records the deliberate choice of stdlib
tkinter to avoid bundling assets into a `--onefile` Nuitka build, and the daemon's value
proposition includes working with no browser, no login and no network. The fixes below
(DPI, resizable shell, a real component kit, a health banner, a Treeview-based sync table)
deliver most of the ergonomic win at a fraction of the risk.

**Revisit criteria for Option B**, to be recorded in `daemon-python/README.md` and re-read at
each major UI chantier: (a) the settings window needs a genuinely data-dense or animated view
that ttk cannot express; (b) WebView2 Runtime becomes a documented, acceptable prerequisite;
(c) the packaging path is proven in CI (`pack-check` builds and launches a webview window).

The UX design below is deliberately platform-neutral (information architecture, states,
flows): it survives a later port.

## Decision 2: information architecture

The tab set stays — it maps to four real concerns and users already know it — but each tab
gains a clear primary purpose, and a global health banner sits above the notebook so the
answer to "is my daemon OK?" is visible from any tab.

| Tab | Primary question it answers | Changes |
|---|---|---|
| **Config** | "Is it connected, and where does it read replays?" | Connect flow moves in (C1), manual token demoted, sections kept (Connexion / Stockage / Démarrage) |
| **Synchronisation** | "What is being synced, what failed, what can I do?" | Becomes a control panel: summary cards, per-replay table, filters, actions, history |
| **Draft Live** | "Does the live-draft hotkey work?" | Kept as the 2026-09-02 spec left it; gains a compact status summary line |
| **Update** | "Am I up to date?" | Always present (Decision 5) |

The **Debug** text dump is replaced by a first-class **Journal** view (Decision 6) reachable
from the health banner and the Synchronisation tab.

The **first-run wizard** (Decision 4) is the same window in a stepper mode, not a second
window: the tabs are hidden and the shell shows three steps.

## Decision 3: resizable, DPI-correct, scrollable

- Set Per-Monitor-V2 DPI awareness once, before any `tk.Tk()` is created, in `main.py`:
  `ctypes.windll.shcore.SetProcessDpiAwareness(2)` with fallbacks to
  `SetProcessDPIAware()` on older Windows, all best-effort (never fatal).
- Re-derive fonts from the actual DPI instead of the hardcoded `("Segoe UI", 10)`: define a
  scale factor from `root.winfo_fpixels('1i') / 96` and size every font through it. This is
  what stops the window looking tiny on a 4K display once awareness is on.
- Replace the locked size with: `root.minsize(...)` (a real minimum, derived from the largest
  fixed element), a resizable window, and a scrollable content shell.
- Add `_ScrollableFrame` to the new widget kit: a `tk.Canvas` + inner `ttk.Frame` with a
  vertical `ttk.Scrollbar`, mouse-wheel binding, and width tracking. Every tab body lives in
  one.
- **Delete** `_measure_worst_case_size()` and the string-truncation constants it exists to
  justify (`_SYNCING_LABEL_MAX_CHARS`, `_ERROR_LABEL_MAX_CHARS`, `_SKIPPED_LABEL_MAX_CHARS`,
  `_UPDATE_STATUS_MAX_CHARS`, `_DRAFT_CAPTURE_STATUS_MAX_CHARS`,
  `_TEST_CAPTURE_STATUS_MAX_CHARS`). Truncation, where still wanted, becomes a tooltip, not a
  layout contract.
- Persist window geometry (size + maximized) in the daemon's data folder
  (`%APPDATA%/hots-analytics/window.json`) and restore it on open, clamped to the current
  screen. Reset if the screen no longer fits it (undocked laptop).

## Decision 4: first-run wizard

`_is_first_run` currently shows all fields at once. Replace with a three-step stepper inside
the same shell:

1. **Connexion** — the C1 "Connecter ce PC" button, with the manual token path collapsed
   under "Avancé". Step completes when the connection check is green.
2. **Dossiers de replays** — the autodetected `Documents/Heroes of the Storm` root, editable
   and browsable, with the discovered accounts listed underneath (already computed by
   `accounts_discovery`). Step completes when at least one replay folder exists.
3. **Démarrage** — the autostart checkbox and its real status line, plus a one-line summary of
   what was configured. "Terminer" saves via the existing `_save()` path.

Each step has a short caption explaining *why* it is being asked. A "Passer" affordance is
available on steps 2 and 3 (the daemon can still autodetect), but not on step 1. Closing
mid-wizard behaves exactly like today's first run (nothing saved).

## Decision 5: the Update tab is always present

`updater.IS_FROZEN` currently hides the tab in dev runs, which makes the tab set
non-deterministic and leaves `_refresh_update_status`'s guard coupled to the build type. Keep
the tab always; when not frozen, it renders an explicit "Les mises à jour automatiques ne
sont actives que dans la version installée" notice and disables "Vérifier les mises à jour".
This removes a build-type branch from `gui.py` rather than adding one.

## Decision 6: the Debug dump becomes a Journal view

- A new tab-level view (or a scrollable section on Synchronisation) rendering recent events
  from the local `sync_state.db` error records plus, once C4 lands, the daemon's own log
  records.
- Filter row: level, logger/category, free text; a "copier la ligne" context action; "Ouvrir
  le fichier" (existing `open_path`) still available for the raw log.
- The existing `_format_debug_report` text generation is kept as the "Copier le rapport"
  action so nothing is lost.

## Components

### Widget kit — `daemon-python/src/ui_kit.py` (new)

One module, stdlib-only, replacing the ad-hoc helpers scattered through `gui.py`:

- **Tokens**: `Palette` (current `_BG`/`_PANEL`/`_TEXT`/`_ACCENT`/`_OK`/`_ERROR` plus a new
  `_WARN` and a high-contrast muted color), `Spacing` (`4/8/12/18/24`), `Fonts` (DPI-scaled
  named fonts).
- **Containers**: `Card`, `SectionHeader`, `ScrollableFrame`.
- **Inputs**: `Field` (label + entry + status slot + optional reveal), `Toggle`,
  `SegmentedControl` (for filters).
- **Actions**: `Button` with `primary`/`ghost`/`danger`/`link` variants, consistent padding,
  hover/pressed/disabled states drawn through `ttk.Style` rather than ad-hoc `tk` widgets.
- **Feedback**: `StatusPill` (ok/warn/error/neutral), `EmptyState` (icon-less, text + optional
  action), `InlineError`, `Banner` (the health strip), `Table` (thin `ttk.Treeview` wrapper
  with column config, tags for row colors, and a row-context menu).
- Every widget takes the `Palette`/`Fonts` and never hardcodes a color. `_apply_dark_style`
  collapses into `ui_kit.apply_theme(root)`.

### Global health banner

A thin strip at the top of the window, driven by a single `HealthSummary` computed from
existing sources (`StatusTracker`, `SyncState`, config validity, the connection checks,
`UpdateStatusTracker`):

| State | Copy (French) |
|---|---|
| Not configured | "Daemon non configuré — connecte ce PC pour commencer." + action |
| Syncing | "Synchronisation en cours — N parties restantes (environ X min)." |
| Idle/OK | "À jour — dernière synchronisation il y a X." |
| Degraded | "N parties n'ont pas pu être synchronisées." + "Voir le détail" action |
| Auth error | "Le token est refusé — reconnecte ce PC." + action |

The banner is the single place health is summarized; tab markers (`_set_tab_problem`) stay as
the "which tab" pointer.

### Synchronisation control panel

Rendering belonged to this spec; the data and the actions belong to C3. This spec commits to
the shape:

- Summary cards row: en attente / en cours / synchronisées (session) / échecs / ignorées.
- A `Table` of replays with columns: fichier, compte, statut, taille, durée, message. Row tag
  colors from the palette. Sorting by column, filtering by status, free-text search.
- An action bar: "Synchroniser maintenant", "Réessayer les échecs", "Tout renvoyer"
  (destructive, confirmation), and "Ouvrir le dossier".
- A "Dernier run" block (from C3's `sync_runs`): started/finished, counts, duration, trigger.
- Empty and loading states, so a fresh install never renders a blank panel.

### Tray and notifications

- Tray tooltip reflects state ("HotS Analytics — synchronisation en cours", "… — N échecs").
- Menu: "Ouvrir les paramètres" (default), "Synchroniser maintenant", "Voir les échecs (N)"
  (opens the window on Synchronisation with the failure filter applied), separator, "Quitter".
- Notifications become consistent: first failure (transient), persistent failure (already
  exists), and "synchronisation terminée — N nouvelles parties". Each notification that has an
  obvious screen is clickable where pystray supports it; otherwise the menu entry is the
  entry point.

## Error handling

- Every UI action that can fail (connect, sync now, retry, open folder/log) reports through
  the `InlineError`/`Banner` vocabulary; no modal error dialogs except for the destructive
  "Tout renvoyer" confirmation.
- The health banner distinguishes "the daemon is fine but the API is unreachable" from "the
  token is rejected" from "some replays failed", since those need different user actions.
- DPI/geometry persistence and restoration are best-effort and clamped; a failure falls back
  to the default size and logs at debug.
- All worker-thread results still come back through `root.after` and are dropped once
  `_closed` is set — the existing contract, preserved.

## Accessibility

- DPI-correct fonts (Decision 3) and a minimum body size of 10 pt at 96 DPI.
- Raise the muted-text contrast (target >= 4.5:1 on the panel color) and never encode meaning
  in color alone: status pills carry a glyph and a word, not just a hue.
- Full keyboard operation: Tab order follows visual order, Enter triggers the primary action,
  Escape closes, and the sync table supports arrow navigation and a context menu key.
- Tab markers gain a textual suffix (for the health tooltip) alongside the colored glyph.

## Testing

- `ui_kit.py` holds the only testable logic: palette/font scaling given a DPI factor,
  scrollable-frame helper math, table sorting/filtering models, and `HealthSummary`
  derivation from injected snapshots. These get unit tests in
  `daemon-python/tests/test_ui_kit.py` (headless-safe: no widgets, pure functions/data
  classes).
- The health summary is the piece most worth testing: one test per banner state, driven from
  synthetic `DaemonStatus`/`SyncState` inputs.
- Widget construction and layout are verified by hand (this repo has no `gui.py` tests and CI
  is headless — see `CLAUDE.md`), checked at 100 %, 125 % and 150 % scaling and at a small
  (1366x768) and large (4K) resolution, plus a window-resize pass on every tab.

## Files touched

New: `daemon-python/src/ui_kit.py`, `daemon-python/src/window_state.py` (geometry
persistence), `daemon-python/src/health.py` (`HealthSummary`),
`daemon-python/tests/test_ui_kit.py`.

Modified: `daemon-python/src/gui.py` (the bulk: tabs, wizard, banner, sync panel, journal
view), `daemon-python/src/main.py` (DPI awareness before any `tk.Tk()`),
`daemon-python/src/tray.py` (tooltip, menu), `daemon-python/src/app.py` (expose the sync
actions and current state to the window), `daemon-python/README.md` (architecture section and
the Option B revisit criteria).
