# Daemon UI/UX & Reliability Overhaul — Design

## Context

An audit of the Windows daemon's settings window (`daemon-python/src/gui.py`) surfaced
three concrete, reproducible problems on top of a general request to clean up the
UI/UX of every tab:

1. **Live-draft capture has no manual trigger.** The only way to fire a real
   `capture_and_submit` (screenshot → crop → OCR → `POST /draft/snapshot`) is the
   global hotkey (`hotkey.py`, wired in `app.py`'s `_DaemonRunner._trigger_draft_capture`).
   The settings window's existing "Tester la capture" button
   (`draft_capture.run_test_capture`, added in `tasks/daemon-audit-2026-08-12.md`
   §2.2) is a deliberate dry-run that never POSTs — it calibrates OCR, it does not
   substitute for the hotkey.
2. **The hotkey silently fails to register, with no user-visible signal, and the
   settings window's "✓ Raccourci valide" checkmark is misleading.**
   `HotkeyManager.start()` (`hotkey.py:92-114`) catches any exception from
   `keyboard.add_hotkey` and only logs it — `gui.py` never even receives a
   reference to the `HotkeyManager` instance (it lives on `app.py`'s
   `_DaemonRunner`), so it has no way to know registration actually happened.
   `_check_draft_hotkey` in `gui.py` only validates the combo's *syntax*
   (`hotkey.validate`). This matches the reported symptom exactly: the shortcut
   sometimes does nothing in-game, with a green checkmark the whole time, and a
   daemon restart (a fresh `HotkeyManager.start()` call) often fixes it.
3. **The initial replay backlog sync causes in-game stutter.** `app._run_sync_loop`
   parses the on-disk backlog through a `ThreadPoolExecutor(max_workers=4)`
   (`_INITIAL_SYNC_WORKERS`, `app.py:47`). Each worker's `ingest_file` does
   CPU-bound `heroprotocol` parsing at normal OS thread priority, competing with
   Heroes of the Storm for the same CPU cores if a game is played while the
   backlog is still draining (typically the very first run, or after "Réinitialiser
   mes données"). The prior audit's discussion of this pool (§2.3) only reasoned
   about *network* concurrency, never CPU contention.
4. **Autostart's "Lancer au démarrage de Windows" checkbox can lie.** Windows
   tracks a second, independent flag — `HKCU\...\StartupApproved\Run` — that
   Task Manager (or Windows itself, if it judges the app too slow to start) uses
   to disable a startup entry *without ever touching* the `Run` key value itself.
   `autostart.is_enabled()`/`set_enabled()` (`autostart.py`) only ever look at the
   `Run` key, so the checkbox can show "enabled" while Windows silently isn't
   launching the daemon at boot, with no way for the user to find out short of
   checking Task Manager's Startup tab by hand.

On top of these four, the user asked for a general design/organization pass on
every tab of the settings window (`gui.py`'s `ttk.Notebook`: Config / Draft Live /
Synchronisation / Update).

**Goal:** fix all four reliability gaps, add the missing manual-capture control,
and reorganize every tab for clarity — as one coordinated change, since the
reorganization needs to surface the new statuses these fixes produce (hotkey
registration state, last-trigger timestamp, autostart's real state, sync
throttling) and would otherwise have to be redone once those exist.

**Non-goals:** no change to the OCR/crop pipeline itself, no change to the
update mechanism (Velopack — see the 2026-08-31 design doc), no i18n (the app
stays French-only, matching its current audience), no telemetry/analytics.

## Decisions already validated (visual companion session)

- Tab-problem indicator: a marker on the offending tab itself (e.g. "Draft Live 🔴"),
  not a separate always-visible status strip and not a sidebar restructure —
  chosen over both alternatives for staying close to the current navigation
  while still being visible regardless of which tab is open when a problem
  starts.
- Draft Live tab: three named sections — **Raccourci** (hotkey display, "Modifier…",
  registration status, "Réessayer"), **Capture** (existing "Tester la capture"
  dry-run button alongside the new "Capturer maintenant" real-trigger button,
  each with a one-line caption distinguishing them), **État** (existing capture
  progress indicator, plus a new "dernier appui détecté" timestamp).
- Config tab: three named sections — **Connexion** (API URL, token, token-management
  link, live status), **Stockage** (replays folder, browse), **Démarrage**
  (autostart checkbox, its new real status line).
- Synchronisation tab: unchanged structure, with one new status line explaining
  the reduced-priority throttling while the initial backlog is still draining.

## Components

### 1. Manual draft-capture trigger ("Capturer maintenant")

`_DaemonRunner._trigger_draft_capture` (`app.py:249-266`) already does exactly the
right thing — spawns a `hots-draft-capture` thread running
`draft_capture.capture_and_submit(client, coordinator=self.draft_capture_status)` —
it's just private and never reaches `gui.py`.

- Rename/expose it as a public method, e.g. `_DaemonRunner.trigger_draft_capture()`
  (keep the hotkey callback as a thin wrapper around it, so both entry points
  share one code path).
- Thread through `run_app()`'s `_on_open_settings()` closure into
  `run_settings_window(..., on_manual_capture=daemon.trigger_draft_capture)`,
  same pattern already used for `status_tracker`/`sync_state`/`update_status`.
- New "Capturer maintenant" button in the Draft Live tab's **Capture** section,
  next to "Tester la capture". Guarded the same way "Debug" is
  (`not is_first_run and on_manual_capture is not None`) — a manual real capture
  needs a live `ApiClient`, which doesn't exist before the daemon has started
  once.
- No new feedback plumbing needed: the existing `DraftCaptureCoordinator`
  polling loop (`_refresh_draft_capture_status`, already wired to the **État**
  section) reflects a manually-triggered capture exactly like a hotkey-triggered
  one, since both go through the same `coordinator`.

### 2. Hotkey reliability

**a. Real registration status, surfaced.**

`HotkeyManager` gains a small immutable snapshot, mirroring the
`DraftCaptureCoordinator`/`UpdateStatusTracker` pattern already used elsewhere in
this codebase:

```python
@dataclass(frozen=True)
class HotkeyStatus:
    registered_hotkey: str | None      # None if nothing is currently registered
    last_error: str | None             # set on the most recent registration failure
    last_triggered_at: datetime | None # updated on every real hotkey press, success or not
```

`HotkeyManager.start()` sets `last_error` instead of only logging on failure, and
clears it on success. The callback wrapper that `start()` passes to
`keyboard.add_hotkey` stamps `last_triggered_at` *before* invoking `on_trigger` —
this is what makes "dernier appui détecté" fire even when the capture itself
later fails (no game window found, etc.), giving a diagnostic signal independent
of capture success.

`_DaemonRunner` already owns the one `HotkeyManager` instance for the app's
lifetime; it's threaded into `run_settings_window` the same way as
`draft_capture_status`, and polled on the Draft Live tab's existing 500ms timer
(`_refresh_draft_capture_status` already runs one; the hotkey snapshot rides
along on the same tick rather than adding a second timer).

**b. Retry instead of giving up.**

On a registration failure, `HotkeyManager.start()` still returns immediately
(never blocks the caller — the caller may be the Tk thread on a settings save,
or `run_app()`'s startup path), but spawns a background retry: a few attempts,
a short delay apart, updating the same status snapshot when one eventually
succeeds. This covers the observed "restarting the daemon fixes it" case
automatically, without requiring a restart.

A "Réessayer" ghost button next to the error status line in the **Raccourci**
section calls `hotkey_manager.start(current_hotkey)` again on a worker thread,
for a user-forced retry independent of the background one.

**Explicitly out of scope:** a periodic watchdog re-verifying the OS-level hook
is still installed after a successful registration. There's no reliable way to
probe that without risking a missed keypress during the check, and nothing in
the reported symptom suggests the hook is lost *after* a successful
registration — the failure is at registration time, which retry (a) already
covers.

### 3. Reduced-priority initial sync

`_run_sync_loop`'s `ThreadPoolExecutor(max_workers=_INITIAL_SYNC_WORKERS, ...)`
(`app.py:99`) gains an `initializer` (stdlib `ThreadPoolExecutor` support since
3.9) that lowers each pool worker's Windows thread priority once, when the
thread is created:

```python
def _lower_worker_priority() -> None:
    """Best-effort: yields CPU to whatever's in the foreground (a game) while
    this thread does CPU-bound replay parsing. Never raises -- a failure here
    must not stop the sync it's trying to make less disruptive."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        THREAD_PRIORITY_BELOW_NORMAL = -1
        handle = ctypes.windll.kernel32.GetCurrentThread()
        ctypes.windll.kernel32.SetThreadPriority(handle, THREAD_PRIORITY_BELOW_NORMAL)
    except OSError:
        logger.warning("Could not lower sync worker thread priority", exc_info=True)
```

No process-name/game detection, no change to worker count or network
concurrency — this is the standard OS-level mechanism for "background CPU work
must not starve the foreground app," and it degrades gracefully (worst case,
back to today's behavior) if the `ctypes` call ever fails. Applies only to the
initial-backlog pool; `watch_replays`' one-at-a-time steady-state ingestion
(new replays trickling in during normal play) is unaffected — it's already
low-frequency enough not to matter, and keeping it at normal priority is
correct since there's no backlog to rush through.

The Synchronisation tab's new status line ("synchronisation … priorité réduite")
is static copy shown whenever the initial pass is still running
(`StatusTracker` already exposes `found`/`synced`+`failed` to derive "still
draining"), not a new tracked field.

### 4. Autostart: read and repair the real state

Windows' `StartupApproved\Run` binary flag (reverse-engineered but stable since
Windows 8; a 12-byte value per app name, byte 0 = `0x02` enabled, any other
observed value disabled by Task Manager or Windows' own startup-impact policy)
is read alongside the existing `Run` key check:

- `is_enabled()`: returns `True` only if the `Run` value exists **and**
  `StartupApproved\Run`'s entry (when present) has byte 0 == `0x02`. Absence of
  a `StartupApproved` entry is treated as enabled (Windows' own default when
  nothing has ever touched it).
- `set_enabled(True)`: writes the `Run` value (unchanged) **and** writes/repairs
  `StartupApproved\Run` to the enabled blob — this is what actually fixes a
  silently-Windows-disabled entry, not just detects it. `set_enabled(False)`
  only removes the `Run` value, same as today (an absent `Run` value makes the
  `StartupApproved` byte moot).
- `gui.py`'s `_on_autostart_toggled` re-reads `is_enabled()` after calling
  `set_enabled()` and reflects the *actual* resulting state in the checkbox and
  a status caption, instead of trusting the local `tk.BooleanVar` the checkbox
  itself set — closing the loop the audit found missing.

### 5. Tab-level UI reorganization

- **Tab problem indicator**: appending a colored circle emoji (e.g. "🔴") to a
  `ttk.Notebook` tab's text via `notebook.tab(index, text=...)` when that tab
  has something needing attention (hotkey error, persistent sync failure,
  autostart silently disabled), removing it once resolved. Emoji glyphs render
  in their own color regardless of the tab's text color, which is what makes
  this work without custom tab-drawing (`ttk.Notebook` doesn't support
  per-character text styling).
- **Config tab**: split the current single card into three (`Connexion` /
  `Stockage` / `Démarrage`), same fields, grouped with section headers instead
  of one flat stack — no field is added or removed here beyond the autostart
  status caption from (4).
- **Draft Live tab**: reorganized into `Raccourci` / `Capture` / `État` per the
  validated mockup — folds in the hotkey status + retry from (2), the new
  button from (1), and the "dernier appui détecté" line from (2a).
- **Synchronisation tab**: unchanged layout, plus the one new status line from (3).
- **Update tab**: no changes — not flagged as unclear in the audit.

## Error handling

Every new piece of state here follows the codebase's existing convention:
best-effort, never raises past its boundary, degrades to "no signal" rather
than crashing a window or the sync loop. Concretely:
- Thread-priority lowering, `StartupApproved` reads/writes, and hotkey retry
  all wrap OS calls in `try`/`except OSError` (or the broader `Exception` where
  a third-party call's exception type isn't guaranteed, matching `hotkey.py`'s
  existing style) and log — none of them can turn into a crashed settings
  window or a dead sync loop.
- The manual "Capturer maintenant" button reuses `capture_and_submit`, which
  already never raises and already reports failures through `coordinator.fail`.

## Testing

Following this repo's existing daemon test conventions (`daemon-python/tests/`,
`pytest`, `keyboard`/`winreg`/`ctypes` mocked out — see `test_hotkey.py`,
`test_app.py` for the patterns to extend):
- `HotkeyManager`: registration failure sets `last_error` and is cleared on a
  later success; the retry loop eventually succeeds after an injected initial
  failure; `last_triggered_at` updates on a triggered callback even when the
  wrapped `on_trigger` itself raises/is slow.
- `autostart`: `is_enabled()`/`set_enabled()` against a faked `StartupApproved`
  byte, covering "absent" (treated enabled), "enabled", and "disabled by Task
  Manager" starting states.
- `app._run_sync_loop` / the pool `initializer`: the priority-lowering call is
  invoked per worker thread and its failure doesn't propagate.
- `_DaemonRunner.trigger_draft_capture` (renamed): same coverage the existing
  `test_trigger_draft_capture_*` tests in `test_app.py` already give the
  private version, no behavior change to test beyond the rename.
- `gui.py`: out of this repo's existing test scope (no UI tests today for
  `gui.py`'s Tk widgets) — verified manually per this project's CLAUDE.md
  guidance to actually exercise UI changes before calling them done.

## Files touched

`daemon-python/src/hotkey.py`, `daemon-python/src/app.py`,
`daemon-python/src/autostart.py`, `daemon-python/src/gui.py`,
`daemon-python/src/draft_capture.py` (only if the public rename needs a
re-export), plus their corresponding `tests/test_*.py` files.
