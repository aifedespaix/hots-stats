# Daemon UI/UX & Reliability Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four daemon reliability gaps (no manual live-draft trigger, a
hotkey that can silently fail to register, an initial replay sync that
competes with the game for CPU, an autostart checkbox that can lie) and
reorganize every settings-window tab around the new statuses these fixes
produce.

**Architecture:** `daemon-python/src/hotkey.py`'s `HotkeyManager` gains a
status snapshot (registration error + last-trigger timestamp) and a
background retry; `autostart.py` reads/repairs a second Windows registry
flag (`StartupApproved\Run`) that today's code never looks at;
`app.py`'s initial-sync thread pool gets a per-worker priority initializer
and exposes its private manual-capture trigger publicly; `gui.py` threads
these through the settings window, reorganizes the Config and Draft Live
tabs into named sections, and marks a tab's label when something inside it
needs attention.

**Tech Stack:** Python 3.11+, `keyboard` (global hotkeys), `winreg` (Windows
registry), `ctypes` (Windows thread priority), `tkinter`/`ttk`, `pytest` +
`unittest.mock`.

**Spec:** `docs/superpowers/specs/2026-09-02-daemon-ux-reliability-overhaul-design.md`

## Global Constraints

- Every new OS-level call (`winreg`, `ctypes`, `keyboard`) is best-effort:
  wrapped in `try`/`except`, logs on failure, **never raises** past its own
  function — matches every existing module in `daemon-python/src/`.
- Windows-only behavior stays gated the same way existing code gates it
  (`sys.platform == "win32"`, `autostart.is_supported()` / `IS_FROZEN`) —
  no new admin-rights requirement anywhere (HKCU only, no elevation).
- All new user-facing strings are French, matching the rest of `gui.py`.
- `gui.py`'s settings window is a fixed-size, non-resizable `tk.Tk()`
  (`_SettingsWindow._center`/`_measure_worst_case_size`) — any new label
  with dynamic/unbounded text **must** be added to
  `_measure_worst_case_size`'s placeholder list with a `_MAX_CHARS` cap and
  `_truncate`, same as every existing dynamic label.
- Dark theme tokens (`gui.py` module level): `_BG="#1c1f2e"`,
  `_PANEL="#252a3d"`, `_ACCENT="#6c8cff"`, `_OK="#4cd97b"`,
  `_ERROR="#ef5b5b"`, `_NEUTRAL="#8b90ad"`. Reuse them; don't hardcode new
  colors.
- Tests for `daemon-python/`: `pytest -q` from `daemon-python/`, run from its
  own venv (`pip install -e ".[dev]"`). `keyboard`/`winreg`/`ctypes` are
  mocked via `monkeypatch.setitem(sys.modules, "<name>", fake)` — never
  imported for real in tests (see `test_hotkey.py`'s `fake_keyboard`
  fixture, `test_autostart.py`'s inline fake for the existing pattern).
- `gui.py` has no automated test coverage today (Tkinter, no test file) —
  every `gui.py` task ends with a manual verification step
  (`python -m src.main` from `daemon-python/`) instead of a pytest run.

---

## Task 1: `HotkeyManager` — registration status snapshot

**Files:**
- Modify: `daemon-python/src/hotkey.py`
- Test: `daemon-python/tests/test_hotkey.py`

**Interfaces:**
- Produces: `HotkeyStatus` (frozen dataclass: `registered_hotkey: str | None`,
  `last_error: str | None`, `last_triggered_at: datetime | None`);
  `HotkeyManager.snapshot() -> HotkeyStatus`. `last_triggered_at` stays
  `None` until Task 2 wires it up — this task only adds the field and
  `last_error`.

- [ ] **Step 1: Write the failing tests**

Add to `daemon-python/tests/test_hotkey.py`:

```python
def test_snapshot_reports_registered_hotkey_and_no_error(fake_keyboard):
    manager = HotkeyManager(on_trigger=lambda: None)
    manager.start("ctrl+shift+d")

    status = manager.snapshot()
    assert status.registered_hotkey == "ctrl+shift+d"
    assert status.last_error is None


def test_snapshot_reports_last_error_on_registration_failure(fake_keyboard):
    fake_keyboard.add_hotkey.side_effect = RuntimeError("hook failed")
    manager = HotkeyManager(on_trigger=lambda: None)

    manager.start("ctrl+shift+d")

    status = manager.snapshot()
    assert status.registered_hotkey is None
    assert status.last_error == "hook failed"


def test_snapshot_clears_last_error_on_a_later_successful_start(fake_keyboard):
    fake_keyboard.add_hotkey.side_effect = [RuntimeError("hook failed"), None]
    manager = HotkeyManager(on_trigger=lambda: None)

    manager.start("ctrl+shift+d")
    assert manager.snapshot().last_error == "hook failed"

    manager.start("ctrl+alt+g")
    assert manager.snapshot().last_error is None
    assert manager.snapshot().registered_hotkey == "ctrl+alt+g"


def test_snapshot_reports_invalid_hotkey_as_last_error(fake_keyboard):
    manager = HotkeyManager(on_trigger=lambda: None)
    manager.start("d")  # no modifier -- fails validate(), not add_hotkey

    status = manager.snapshot()
    assert status.registered_hotkey is None
    assert "modification" in status.last_error
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `daemon-python/`): `pytest tests/test_hotkey.py -k snapshot -v`
Expected: FAIL with `AttributeError: 'HotkeyManager' object has no attribute 'snapshot'`

- [ ] **Step 3: Add `HotkeyStatus` and status tracking to `hotkey.py`**

In `daemon-python/src/hotkey.py`, add near the top (after the existing imports):

```python
from dataclasses import dataclass
from datetime import datetime
```

Add after `InvalidHotkeyError`:

```python
@dataclass(frozen=True)
class HotkeyStatus:
    """A point-in-time snapshot of `HotkeyManager`'s state -- what's
    actually registered with Windows right now, the most recent
    registration failure (if any), and when the hotkey was last actually
    pressed. Exists because the settings window previously had no way to
    tell "the combo is syntactically valid" (`validate()`, a pure string
    check) apart from "Windows actually installed the hook" -- the gap that
    made a silently-failed registration look identical to a working one."""

    registered_hotkey: str | None
    last_error: str | None
    last_triggered_at: datetime | None
```

Modify `HotkeyManager.__init__` to add the new fields:

```python
    def __init__(self, on_trigger: Callable[[], None]) -> None:
        self._on_trigger = on_trigger
        self._lock = threading.Lock()
        self._registered: str | None = None
        self._last_error: str | None = None
        self._last_triggered_at: datetime | None = None
```

Add a `snapshot()` method (near `active_hotkey`):

```python
    def snapshot(self) -> HotkeyStatus:
        with self._lock:
            return HotkeyStatus(
                registered_hotkey=self._registered,
                last_error=self._last_error,
                last_triggered_at=self._last_triggered_at,
            )
```

Modify `start()` to record `last_error` on every failure path and clear it
on success:

```python
    def start(self, hotkey: str) -> None:
        """Validates and registers `hotkey`, replacing any previously
        registered one. Logs and leaves nothing registered on failure (e.g.
        `keyboard` can't install its hook on this platform/permission
        level) rather than raising -- a broken hotkey must never crash the
        daemon's startup or a settings save. `snapshot().last_error` is how
        a caller (the settings window) finds out a failure happened at
        all -- see `HotkeyStatus`."""
        try:
            normalized = validate(hotkey)
        except InvalidHotkeyError as err:
            logger.error("Not registering draft hotkey: %s", err)
            with self._lock:
                self._last_error = str(err)
            return

        import keyboard

        with self._lock:
            self._unregister_locked()
            try:
                keyboard.add_hotkey(normalized, self._on_trigger)
            except Exception as err:
                logger.exception("Failed to register global hotkey %r", normalized)
                self._last_error = str(err)
                return
            self._registered = normalized
            self._last_error = None
            logger.info("Registered live-draft capture hotkey: %s", normalized)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_hotkey.py -v`
Expected: all PASS, including the pre-existing tests (unchanged behavior for
`active_hotkey`, `stop()`, the invalid/failure cases).

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/hotkey.py daemon-python/tests/test_hotkey.py
git commit -m "$(cat <<'EOF'
feat(daemon): add HotkeyManager.snapshot() with registration status

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012p3QoJR5QJzy53tnoeDxsM
EOF
)"
```

---

## Task 2: `HotkeyManager` — track the last real trigger

**Files:**
- Modify: `daemon-python/src/hotkey.py`
- Test: `daemon-python/tests/test_hotkey.py`

**Interfaces:**
- Consumes: `HotkeyStatus` from Task 1.
- Produces: `HotkeyStatus.last_triggered_at` now actually updates on a real
  hotkey press, independent of whatever `on_trigger` itself does (even if
  it raises).

- [ ] **Step 1: Write the failing test**

```python
def test_snapshot_records_last_triggered_at_on_a_real_press(fake_keyboard):
    calls: list[str] = []
    manager = HotkeyManager(on_trigger=lambda: calls.append("fired"))
    manager.start("ctrl+shift+d")

    # `fake_keyboard.add_hotkey` doesn't call its callback itself -- grab
    # the wrapped callback `HotkeyManager` actually registered and invoke it
    # directly, simulating Windows firing the hook.
    registered_callback = fake_keyboard.add_hotkey.call_args.args[1]
    registered_callback()

    assert calls == ["fired"]
    assert manager.snapshot().last_triggered_at is not None


def test_last_triggered_at_updates_even_if_on_trigger_raises(fake_keyboard):
    def _boom():
        raise RuntimeError("capture blew up")

    manager = HotkeyManager(on_trigger=_boom)
    manager.start("ctrl+shift+d")
    registered_callback = fake_keyboard.add_hotkey.call_args.args[1]

    with pytest.raises(RuntimeError):
        registered_callback()

    assert manager.snapshot().last_triggered_at is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_hotkey.py -k last_triggered -v`
Expected: FAIL — `last_triggered_at` stays `None` (nothing wraps the
callback yet).

- [ ] **Step 3: Wrap the trigger callback**

In `daemon-python/src/hotkey.py`, add `timezone` to the datetime import:

```python
from datetime import datetime, timezone
```

Add a wrapper method and use it in `start()` instead of `self._on_trigger`
directly:

```python
    def _handle_trigger(self) -> None:
        """What's actually registered with `keyboard.add_hotkey` -- stamps
        `last_triggered_at` *before* calling the real callback, so a press
        is recorded even if the callback itself is slow, superseded, or
        raises. This is what lets the settings window show "the hotkey was
        detected" as a signal independent of whether the resulting capture
        succeeded (see `draft_capture.capture_and_submit`, which can fail
        for reasons that have nothing to do with the hotkey itself, e.g. no
        game window found)."""
        with self._lock:
            self._last_triggered_at = datetime.now(timezone.utc)
        self._on_trigger()
```

In `start()`, change the registration call:

```python
            try:
                keyboard.add_hotkey(normalized, self._handle_trigger)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_hotkey.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/hotkey.py daemon-python/tests/test_hotkey.py
git commit -m "$(cat <<'EOF'
feat(daemon): record HotkeyManager's last real trigger timestamp

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012p3QoJR5QJzy53tnoeDxsM
EOF
)"
```

---

## Task 3: `HotkeyManager` — retry registration on failure

**Files:**
- Modify: `daemon-python/src/hotkey.py`
- Test: `daemon-python/tests/test_hotkey.py`

**Interfaces:**
- Consumes: `HotkeyStatus`/`snapshot()` from Task 1.
- Produces: `start()`'s behavior on failure changes from "give up" to
  "schedule a background retry" — same public signature, no new method.
  A `generation` counter (private) invalidates a still-pending retry once
  `start()`/`stop()` is called again, matching the generation-counter
  pattern `draft_capture.DraftCaptureCoordinator` already uses in this
  codebase.

- [ ] **Step 1: Write the failing tests**

```python
def test_start_retries_after_a_registration_failure_and_eventually_succeeds(
    fake_keyboard, monkeypatch
):
    import src.hotkey as hotkey_module

    monkeypatch.setattr(hotkey_module, "_RETRY_DELAY_SECONDS", 0.01)
    fake_keyboard.add_hotkey.side_effect = [RuntimeError("hook failed"), None]
    manager = HotkeyManager(on_trigger=lambda: None)

    manager.start("ctrl+shift+d")
    assert manager.active_hotkey is None
    assert manager.snapshot().last_error == "hook failed"

    _wait_until(lambda: manager.active_hotkey == "ctrl+shift+d")
    assert manager.snapshot().last_error is None


def test_retry_gives_up_after_max_attempts(fake_keyboard, monkeypatch):
    import src.hotkey as hotkey_module

    monkeypatch.setattr(hotkey_module, "_RETRY_DELAY_SECONDS", 0.01)
    monkeypatch.setattr(hotkey_module, "_MAX_REGISTRATION_ATTEMPTS", 2)
    fake_keyboard.add_hotkey.side_effect = RuntimeError("hook failed")
    manager = HotkeyManager(on_trigger=lambda: None)

    manager.start("ctrl+shift+d")
    time.sleep(0.05)  # long enough for every retry attempt to have run

    assert manager.active_hotkey is None
    assert fake_keyboard.add_hotkey.call_count == 2


def test_a_pending_retry_is_superseded_by_a_new_start_call(fake_keyboard, monkeypatch):
    import src.hotkey as hotkey_module

    monkeypatch.setattr(hotkey_module, "_RETRY_DELAY_SECONDS", 0.05)
    fake_keyboard.add_hotkey.side_effect = [RuntimeError("hook failed"), None, None]
    manager = HotkeyManager(on_trigger=lambda: None)

    manager.start("ctrl+shift+d")  # fails, schedules a retry for "ctrl+shift+d"
    manager.start("ctrl+alt+g")  # succeeds immediately, should win

    time.sleep(0.1)  # let the stale retry's timer fire, if it's going to

    assert manager.active_hotkey == "ctrl+alt+g"
```

Add the `_wait_until` helper at the top of the test file (mirrors the one
already used in `tests/test_app.py`):

```python
import time


def _wait_until(condition, timeout=1.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(0.005)
    raise AssertionError("condition was not met in time")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_hotkey.py -k retry -v`
Expected: FAIL — `active_hotkey` never becomes set (no retry exists yet).

- [ ] **Step 3: Implement retry-on-failure**

In `daemon-python/src/hotkey.py`, add module-level constants near the top
(after `_RESERVED_HOTKEYS`):

```python
# How many times HotkeyManager retries a failed registration before giving
# up, and how long it waits between attempts -- covers the observed
# "restarting the daemon fixes it" case automatically (a fresh process's
# first `start()` call is exactly attempt 1 of this same sequence).
_MAX_REGISTRATION_ATTEMPTS = 3
_RETRY_DELAY_SECONDS = 1.5
```

Replace `HotkeyManager.__init__`'s body (adding a generation counter) and
rework `start()`/add `_attempt_registration`:

```python
    def __init__(self, on_trigger: Callable[[], None]) -> None:
        self._on_trigger = on_trigger
        self._lock = threading.Lock()
        self._registered: str | None = None
        # Separate from `_registered`, which only ever reflects a
        # *successful* registration: `retry()` needs to know which string
        # to re-attempt even when the last attempt failed.
        self._last_attempted: str | None = None
        self._last_error: str | None = None
        self._last_triggered_at: datetime | None = None
        # Bumped by every start()/stop() call; a pending retry checks this
        # before touching `keyboard` so a rebind (or shutdown) invalidates
        # any retry still in flight for the *previous* hotkey instead of it
        # registering something the caller no longer wants.
        self._generation = 0

    def start(self, hotkey: str) -> None:
        """Validates and registers `hotkey`, replacing any previously
        registered one. Never raises. On a registration failure, retries a
        few times in the background (see `_attempt_registration`) instead
        of giving up outright -- `snapshot().last_error` reflects the
        latest failure the whole time, and a "Réessayer" action in the
        settings window can also force an extra attempt on demand."""
        try:
            normalized = validate(hotkey)
        except InvalidHotkeyError as err:
            logger.error("Not registering draft hotkey: %s", err)
            with self._lock:
                self._last_error = str(err)
            return

        with self._lock:
            self._unregister_locked()
            self._generation += 1
            generation = self._generation
            self._last_attempted = normalized
        self._attempt_registration(normalized, generation, attempt=1)

    def _attempt_registration(self, normalized: str, generation: int, attempt: int) -> None:
        with self._lock:
            if generation != self._generation:
                return  # superseded by a newer start()/stop() -- drop this attempt
        import keyboard

        try:
            keyboard.add_hotkey(normalized, self._handle_trigger)
        except Exception as err:
            logger.exception(
                "Failed to register global hotkey %r (attempt %d/%d)",
                normalized,
                attempt,
                _MAX_REGISTRATION_ATTEMPTS,
            )
            with self._lock:
                if generation != self._generation:
                    return
                self._last_error = str(err)
            if attempt < _MAX_REGISTRATION_ATTEMPTS:
                timer = threading.Timer(
                    _RETRY_DELAY_SECONDS,
                    self._attempt_registration,
                    args=(normalized, generation, attempt + 1),
                )
                timer.daemon = True
                timer.start()
            return

        with self._lock:
            if generation != self._generation:
                # A newer start()/stop() happened while this attempt was in
                # flight -- unregister what was just added instead of
                # leaving a hotkey live that nothing wants anymore.
                try:
                    keyboard.remove_hotkey(normalized)
                except (KeyError, ValueError):
                    pass
                return
            self._registered = normalized
            self._last_error = None
        logger.info("Registered live-draft capture hotkey: %s", normalized)
```

Update `stop()` to also bump the generation (so a pending retry can't
resurrect a hotkey after `stop()`):

```python
    def stop(self) -> None:
        with self._lock:
            self._generation += 1
            self._unregister_locked()
```

Add a public retry-on-demand method for the settings window's "Réessayer"
button (Task 8 wires it to a button; adding it now keeps this task's retry
logic self-contained):

```python
    def retry(self) -> None:
        """Forces one extra registration attempt for the hotkey most
        recently passed to `start()`, independent of the automatic retry
        loop -- what the settings window's "Réessayer" action calls, for a
        player who doesn't want to wait for the automatic retries."""
        with self._lock:
            normalized = self._last_attempted
            if normalized is None:
                return
            self._generation += 1
            generation = self._generation
        self._attempt_registration(normalized, generation, attempt=1)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_hotkey.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/hotkey.py daemon-python/tests/test_hotkey.py
git commit -m "$(cat <<'EOF'
feat(daemon): retry hotkey registration in the background on failure

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012p3QoJR5QJzy53tnoeDxsM
EOF
)"
```

---

## Task 4: Autostart — read and repair Windows' `StartupApproved` flag

**Files:**
- Modify: `daemon-python/src/autostart.py`
- Test: `daemon-python/tests/test_autostart.py`

**Interfaces:**
- Produces: `is_enabled() -> bool` now also reflects `StartupApproved\Run`;
  `set_enabled(True)` now also repairs it; new `needs_repair() -> bool`
  (True only when the `Run` key is present but Windows disabled it via
  `StartupApproved`) — Task 9 (`gui.py`) uses this to auto-repair on
  settings-window open instead of just showing "unchecked".

- [ ] **Step 1: Write the failing tests**

Replace the top of `daemon-python/tests/test_autostart.py` (add the shared
fixture) and add the new tests:

```python
import sys
import types
from pathlib import Path
from unittest.mock import patch

import pytest

from src import autostart


@pytest.fixture
def fake_winreg(monkeypatch):
    """A minimal in-memory stand-in for `winreg`, keyed by (subkey, value
    name). Good enough to drive `autostart.py`'s Run / StartupApproved
    read-writes without touching the real Windows registry. Exposes
    `.store` (a `{(subkey, value_name): value}` dict) so a test can seed or
    inspect state directly."""
    store: dict[tuple[str, str], object] = {}

    class _Key:
        def __init__(self, subkey):
            self.subkey = subkey

        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

        def Close(self):
            pass

    fake = types.ModuleType("winreg")
    fake.HKEY_CURRENT_USER = "HKCU"
    fake.KEY_SET_VALUE = 1
    fake.REG_SZ = 1
    fake.REG_BINARY = 3
    fake.OpenKey = lambda _hive, subkey, *_a, **_k: _Key(subkey)
    fake.CreateKeyEx = lambda _hive, subkey, *_a, **_k: _Key(subkey)

    def _set_value_ex(key, name, _res, _type, value):
        store[(key.subkey, name)] = value

    def _query_value_ex(key, name):
        if (key.subkey, name) not in store:
            raise FileNotFoundError()
        return store[(key.subkey, name)], 1

    def _delete_value(key, name):
        if (key.subkey, name) not in store:
            raise FileNotFoundError()
        del store[(key.subkey, name)]

    fake.SetValueEx = _set_value_ex
    fake.QueryValueEx = _query_value_ex
    fake.DeleteValue = _delete_value
    fake.store = store

    monkeypatch.setitem(sys.modules, "winreg", fake)
    monkeypatch.setattr(autostart, "is_supported", lambda: True)
    monkeypatch.setattr(
        autostart, "installed_exe_path", lambda: Path(r"C:\Real\hots-analytics-daemon.exe")
    )
    return fake


def test_is_enabled_false_when_run_key_absent(fake_winreg):
    assert autostart.is_enabled() is False


def test_is_enabled_true_when_run_key_present_and_startup_approved_absent(fake_winreg):
    autostart.set_enabled(True)
    # Simulate a plain, never-touched-by-Task-Manager install: only the Run
    # key exists, no StartupApproved entry at all.
    fake_winreg.store.pop((autostart._STARTUP_APPROVED_KEY, autostart._VALUE_NAME), None)

    assert autostart.is_enabled() is True


def test_is_enabled_false_when_startup_approved_marks_it_disabled(fake_winreg):
    autostart.set_enabled(True)
    fake_winreg.store[(autostart._STARTUP_APPROVED_KEY, autostart._VALUE_NAME)] = bytes(
        [0x03] + [0] * 11
    )

    assert autostart.is_enabled() is False


def test_set_enabled_true_writes_startup_approved_enabled_blob(fake_winreg):
    autostart.set_enabled(True)

    value = fake_winreg.store[(autostart._STARTUP_APPROVED_KEY, autostart._VALUE_NAME)]
    assert value[0] == 0x02


def test_set_enabled_true_repairs_a_previously_disabled_startup_approved_flag(fake_winreg):
    fake_winreg.store[(autostart._RUN_KEY, autostart._VALUE_NAME)] = '"C:\\old.exe"'
    fake_winreg.store[(autostart._STARTUP_APPROVED_KEY, autostart._VALUE_NAME)] = bytes(
        [0x03] + [0] * 11
    )

    autostart.set_enabled(True)

    assert autostart.is_enabled() is True


def test_needs_repair_false_when_run_key_absent(fake_winreg):
    assert autostart.needs_repair() is False


def test_needs_repair_false_when_enabled_normally(fake_winreg):
    autostart.set_enabled(True)
    assert autostart.needs_repair() is False


def test_needs_repair_true_when_windows_silently_disabled_it(fake_winreg):
    fake_winreg.store[(autostart._RUN_KEY, autostart._VALUE_NAME)] = '"C:\\old.exe"'
    fake_winreg.store[(autostart._STARTUP_APPROVED_KEY, autostart._VALUE_NAME)] = bytes(
        [0x03] + [0] * 11
    )

    assert autostart.needs_repair() is True
```

Also update the existing
`test_set_enabled_registers_installed_exe_path_not_sys_executable` to use
the new shared fixture instead of its own inline fake (its inline fake
lacks `CreateKeyEx`, which `set_enabled(True)` will now call too):

```python
def test_set_enabled_registers_installed_exe_path_not_sys_executable(fake_winreg):
    """Regression test: the Run key must point at `installed_exe_path()`
    (the real, persistent .exe), not `sys.executable` -- under Nuitka's
    --onefile packaging the latter resolves to a temp extraction folder
    that's deleted once the process exits, which would silently break
    autostart on the next boot."""
    autostart.set_enabled(True)

    assert fake_winreg.store[(autostart._RUN_KEY, autostart._VALUE_NAME)] == (
        '"C:\\Real\\hots-analytics-daemon.exe"'
    )
```

(The `test_is_supported_false_when_not_frozen`,
`test_is_supported_false_on_non_windows`,
`test_is_enabled_false_when_not_supported`, and
`test_set_enabled_is_a_noop_when_not_supported` tests already in the file
are unaffected — leave them as-is.)

- [ ] **Step 2: Run tests to verify they fail**

Run (from `daemon-python/`): `pytest tests/test_autostart.py -v`
Expected: FAIL — `autostart._STARTUP_APPROVED_KEY` and
`autostart.needs_repair` don't exist yet.

- [ ] **Step 3: Implement `StartupApproved` read/repair in `autostart.py`**

Add after `_VALUE_NAME`:

```python
# Windows tracks a *second*, independent flag for every Run-key startup
# entry: Task Manager's Startup tab (or Windows itself, if it judges an app
# too slow to start) can disable an entry here without ever touching the
# Run key value it's paired with -- which is exactly why a checkbox driven
# only by the Run key (as this module used to be) can show "enabled" while
# nothing actually launches at boot. Format is undocumented but stable
# since Windows 8: a 12-byte value per app name, byte 0 == 0x02 means
# enabled, any other observed value means disabled by Task Manager or
# Windows' own startup-impact policy.
_STARTUP_APPROVED_KEY = (
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
)
_STARTUP_APPROVED_ENABLED_BLOB = bytes([0x02] + [0] * 11)
```

Add two internal helpers (after `set_enabled`):

```python
def _is_startup_approved_enabled() -> bool:
    """True unless Windows separately marked this entry disabled via
    StartupApproved -- see `_STARTUP_APPROVED_KEY`. No entry at all (never
    touched by Task Manager) counts as enabled, matching Windows' own
    default for an untouched Run-key entry."""
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _STARTUP_APPROVED_KEY) as key:
            value, _ = winreg.QueryValueEx(key, _VALUE_NAME)
    except OSError:
        return True
    return bool(value) and value[0] == 0x02


def _mark_startup_approved_enabled() -> None:
    """Best-effort repair: forces StartupApproved's flag for this entry
    back to "enabled", the same effective state re-enabling it from Task
    Manager would produce. Called from `set_enabled(True)` so turning
    autostart on always actually results in it running at the next boot,
    even if Windows had silently disabled it before."""
    import winreg

    try:
        key = winreg.CreateKeyEx(
            winreg.HKEY_CURRENT_USER, _STARTUP_APPROVED_KEY, 0, winreg.KEY_SET_VALUE
        )
    except OSError as err:
        logger.warning("Could not open StartupApproved\\Run to repair autostart: %s", err)
        return
    try:
        winreg.SetValueEx(
            key, _VALUE_NAME, 0, winreg.REG_BINARY, _STARTUP_APPROVED_ENABLED_BLOB
        )
    except OSError as err:
        logger.warning("Could not repair the StartupApproved autostart flag: %s", err)
    finally:
        key.Close()
```

Modify `is_enabled()`:

```python
def is_enabled() -> bool:
    if not is_supported():
        return False
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as key:
            winreg.QueryValueEx(key, _VALUE_NAME)
    except OSError:
        return False
    return _is_startup_approved_enabled()
```

Modify `set_enabled()` to also repair `StartupApproved` when enabling:

```python
def set_enabled(enabled: bool) -> None:
    """Best-effort: a registry write can fail (permissions, a locked-down
    machine) but that must never crash the settings window over a
    convenience toggle -- log and leave the checkbox to reflect reality on
    next open instead."""
    if not is_supported():
        return
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            if enabled:
                # `installed_exe_path()`, not `sys.executable`: under Nuitka's
                # --onefile packaging the latter resolves to the ephemeral
                # per-run extraction folder, which is gone by the next boot --
                # pointing autostart at it would silently stop working the
                # moment the process that created it exits.
                winreg.SetValueEx(key, _VALUE_NAME, 0, winreg.REG_SZ, f'"{installed_exe_path()}"')
            else:
                try:
                    winreg.DeleteValue(key, _VALUE_NAME)
                except FileNotFoundError:
                    pass
    except OSError as err:
        logger.warning("Failed to update the Windows startup registration: %s", err)
        return
    if enabled:
        _mark_startup_approved_enabled()
```

Add `needs_repair()` (public, used by `gui.py` in Task 9):

```python
def needs_repair() -> bool:
    """True only when the Run key is registered but Windows separately
    disabled it via StartupApproved -- the one case `is_enabled()` alone
    can't distinguish from "never enabled". Lets the settings window
    proactively repair a silently-broken autostart when it opens, instead
    of just showing the checkbox unchecked and waiting for the player to
    notice and re-toggle it themselves."""
    if not is_supported():
        return False
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as key:
            winreg.QueryValueEx(key, _VALUE_NAME)
    except OSError:
        return False
    return not _is_startup_approved_enabled()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_autostart.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/autostart.py daemon-python/tests/test_autostart.py
git commit -m "$(cat <<'EOF'
fix(daemon): make autostart read/repair Windows' StartupApproved flag

Task Manager (or Windows itself) can disable a Run-key startup entry via a
separate StartupApproved flag without touching the Run key -- the reason
the "lancer au démarrage" checkbox could show enabled while nothing
actually launched at boot.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012p3QoJR5QJzy53tnoeDxsM
EOF
)"
```

---

## Task 5: Reduced-priority initial sync worker threads

**Files:**
- Modify: `daemon-python/src/app.py`
- Test: `daemon-python/tests/test_app.py`

**Interfaces:**
- Produces: `_lower_worker_priority() -> None` (module-level in `app.py`),
  wired into `_run_sync_loop`'s `ThreadPoolExecutor` as `initializer`.

- [ ] **Step 1: Write the failing tests**

Add to `daemon-python/tests/test_app.py`:

```python
import sys

from src import app


def test_lower_worker_priority_calls_set_thread_priority_on_windows(monkeypatch):
    monkeypatch.setattr(app.sys, "platform", "win32")
    fake_ctypes = MagicMock()
    fake_ctypes.windll.kernel32.SetThreadPriority.return_value = 1
    monkeypatch.setitem(sys.modules, "ctypes", fake_ctypes)

    app._lower_worker_priority()

    fake_ctypes.windll.kernel32.SetThreadPriority.assert_called_once()
    _handle, priority = fake_ctypes.windll.kernel32.SetThreadPriority.call_args.args
    assert priority == -1  # THREAD_PRIORITY_BELOW_NORMAL


def test_lower_worker_priority_is_a_noop_off_windows(monkeypatch):
    monkeypatch.setattr(app.sys, "platform", "linux")
    fake_ctypes = MagicMock()
    monkeypatch.setitem(sys.modules, "ctypes", fake_ctypes)

    app._lower_worker_priority()  # must not raise

    fake_ctypes.windll.kernel32.SetThreadPriority.assert_not_called()


def test_lower_worker_priority_swallows_a_failed_call(monkeypatch):
    monkeypatch.setattr(app.sys, "platform", "win32")
    fake_ctypes = MagicMock()
    fake_ctypes.windll.kernel32.SetThreadPriority.return_value = 0
    fake_ctypes.WinError.return_value = OSError("access denied")
    monkeypatch.setitem(sys.modules, "ctypes", fake_ctypes)

    app._lower_worker_priority()  # must not raise


def test_run_sync_loop_initial_pool_uses_the_priority_initializer(tmp_path):
    _touch_replay(tmp_path, "A.StormReplay")
    status = StatusTracker()
    stop_event = threading.Event()

    with patch("src.app.watch_replays"), patch("src.app.ThreadPoolExecutor") as pool_cls:
        pool_cls.return_value.__enter__.return_value.submit.return_value = MagicMock()
        _run_sync_loop(tmp_path, lambda _p: None, stop_event, status)

    assert pool_cls.call_args.kwargs["initializer"] is app._lower_worker_priority
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `daemon-python/`): `pytest tests/test_app.py -k "priority" -v`
Expected: FAIL — `app._lower_worker_priority` doesn't exist yet, and
`ThreadPoolExecutor` isn't called with an `initializer` kwarg.

- [ ] **Step 3: Implement the priority-lowering initializer**

In `daemon-python/src/app.py`, add `import sys` to the existing imports at
the top:

```python
import logging
import sys
import threading
```

Add near the top, after the `_INITIAL_SYNC_WORKERS` constant:

```python
def _lower_worker_priority() -> None:
    """Runs once per initial-sync pool worker thread (`ThreadPoolExecutor`'s
    `initializer`, see `_run_sync_loop`) so replay parsing yields CPU to
    whatever's in the foreground -- typically the game itself, if the
    player starts one while the initial backlog is still draining. No
    detection of "is a game running": lowering the *background* work's
    priority is the general fix, correct regardless of which foreground app
    it's competing with. Best-effort -- a failure here must never stop the
    sync it's trying to make less disruptive."""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        THREAD_PRIORITY_BELOW_NORMAL = -1
        handle = ctypes.windll.kernel32.GetCurrentThread()
        if not ctypes.windll.kernel32.SetThreadPriority(handle, THREAD_PRIORITY_BELOW_NORMAL):
            raise ctypes.WinError()
    except Exception:
        logger.warning("Could not lower sync worker thread priority", exc_info=True)
```

In `_run_sync_loop`, add `initializer=_lower_worker_priority` to the pool
construction:

```python
        with ThreadPoolExecutor(
            max_workers=_INITIAL_SYNC_WORKERS,
            thread_name_prefix="hots-initial-sync",
            initializer=_lower_worker_priority,
        ) as pool:
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_app.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/app.py daemon-python/tests/test_app.py
git commit -m "$(cat <<'EOF'
perf(daemon): lower initial-sync worker thread priority on Windows

CPU-bound replay parsing across 4 worker threads competed with a
foreground game for the same cores. Lowering their Windows thread
priority lets the OS scheduler favor the foreground app without touching
worker count or network concurrency.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012p3QoJR5QJzy53tnoeDxsM
EOF
)"
```

---

## Task 6: Expose a public manual draft-capture trigger

**Files:**
- Modify: `daemon-python/src/app.py`
- Test: `daemon-python/tests/test_app.py`

**Interfaces:**
- Produces: `_DaemonRunner.trigger_draft_capture() -> None` (renamed from
  `_trigger_draft_capture`, same behavior) — Task 8 (`gui.py`) wires this
  in as the "Capturer maintenant" button's handler.

- [ ] **Step 1: Update the existing tests for the rename**

In `daemon-python/tests/test_app.py`, rename the two call sites (these
tests already exist — just change the method name they call):

```python
def test_trigger_draft_capture_is_noop_before_any_client_is_set():
    runner = _DaemonRunner()

    with patch("src.app.draft_capture.capture_and_submit") as capture:
        runner.trigger_draft_capture()
        time.sleep(0.05)

    capture.assert_not_called()


def test_trigger_draft_capture_spawns_thread_with_current_client():
    runner = _DaemonRunner()
    fake_client = MagicMock()
    runner._client = fake_client

    with patch("src.app.draft_capture.capture_and_submit") as capture:
        runner.trigger_draft_capture()
        _wait_until(lambda: capture.called)

    capture.assert_called_once_with(fake_client, coordinator=runner.draft_capture_status)
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `daemon-python/`): `pytest tests/test_app.py -k trigger_draft_capture -v`
Expected: FAIL — `_DaemonRunner` has no `trigger_draft_capture` attribute yet.

- [ ] **Step 3: Rename in `app.py`**

In `daemon-python/src/app.py`, rename the method (keep its body and
docstring unchanged) and update its one internal reference:

```python
    def trigger_draft_capture(self) -> None:
        # Runs on `keyboard`'s own internal dispatch thread when triggered by
        # the hotkey, or on the Tk thread when triggered manually from the
        # settings window's "Capturer maintenant" button -- handing off to a
        # fresh thread immediately keeps either caller from blocking on a
        # slow capture (screenshot + OCR). Pressing the hotkey again (or
        # clicking the button again) before this thread finishes doesn't
        # queue up a second one behind it -- both run, but
        # `draft_capture_status` makes the older one notice it's been
        # superseded and bail instead of finishing after (and overwriting)
        # the newer one.
        client = self._client
        if client is None:
            return
        threading.Thread(
            target=draft_capture.capture_and_submit,
            args=(client,),
            kwargs={"coordinator": self.draft_capture_status},
            name="hots-draft-capture",
            daemon=True,
        ).start()
```

And in `__init__`, update the hotkey wiring:

```python
        self.hotkey_manager = hotkey.HotkeyManager(on_trigger=self.trigger_draft_capture)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_app.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/app.py daemon-python/tests/test_app.py
git commit -m "$(cat <<'EOF'
refactor(daemon): expose _DaemonRunner.trigger_draft_capture publicly

No behavior change -- makes the real (non-dry-run) capture path callable
from gui.py's upcoming "Capturer maintenant" button, not just the hotkey.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012p3QoJR5QJzy53tnoeDxsM
EOF
)"
```

---

## Task 7: `gui.py` — tab-problem badge helper

**Files:**
- Modify: `daemon-python/src/gui.py`

**Interfaces:**
- Produces: `_SettingsWindow._set_tab_problem(key: str, has_problem: bool) -> None`.
  Task 8 calls this with `key="draft_live"` when the hotkey has a
  registration error.

No automated tests for `gui.py` (see Global Constraints) — this task ends
with a manual check that the window still opens normally.

- [ ] **Step 1: Add a tab registry and the badge helper**

In `_SettingsWindow.__init__`, add a new instance attribute alongside the
other state (near `self._closed = False`):

```python
        # Populated by `_build_tab`: key -> (notebook, tab frame, base
        # title), so `_set_tab_problem` can toggle a marker on a tab's
        # label without needing every call site to pass the notebook/frame
        # around itself.
        self._tabs: dict[str, tuple[ttk.Notebook, ttk.Frame, str]] = {}
```

Change `_build_tab`'s signature to take and record a `key`:

```python
    def _build_tab(self, notebook: ttk.Notebook, key: str, title: str) -> ttk.Frame:
        tab = ttk.Frame(notebook, style="TFrame", padding=18)
        notebook.add(tab, text=title)
        self._tabs[key] = (notebook, tab, title)
        return tab
```

Update the four call sites in `_build_ui`:

```python
        self._build_config_tab(self._build_tab(notebook, "config", "Config"))
        self._build_draft_tab(self._build_tab(notebook, "draft_live", "Draft Live"))
        self._build_sync_tab(self._build_tab(notebook, "sync", "Synchronisation"))
        if updater.IS_FROZEN:
            self._build_update_tab(self._build_tab(notebook, "update", "Update"))
```

Add the badge helper near `_set_status` (in the "misc" section):

```python
    # A filled-circle emoji rather than a plain "*"/"!" -- ttk.Notebook tab
    # text can't be partially colored, but an emoji glyph renders in its own
    # color regardless of the tab's text color, which is what makes a red
    # marker possible here without custom tab drawing.
    _TAB_PROBLEM_MARKER = " 🔴"

    def _set_tab_problem(self, key: str, has_problem: bool) -> None:
        notebook, tab, title = self._tabs[key]
        notebook.tab(tab, text=title + self._TAB_PROBLEM_MARKER if has_problem else title)
```

- [ ] **Step 2: Manual verification**

Run (from `daemon-python/`): `python -m src.main` (or, if already
configured, reopen Settings from the tray). Confirm all tabs still open
with their normal titles ("Config", "Draft Live", "Synchronisation",
"Update") and no marker is shown anywhere yet (nothing calls
`_set_tab_problem` until Task 8).

- [ ] **Step 3: Commit**

```bash
git add daemon-python/src/gui.py
git commit -m "$(cat <<'EOF'
feat(daemon-gui): add a reusable tab-problem badge helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012p3QoJR5QJzy53tnoeDxsM
EOF
)"
```

---

## Task 8: `gui.py` — Draft Live tab reorganization

**Files:**
- Modify: `daemon-python/src/gui.py`
- Modify: `daemon-python/src/app.py` (thread the two new params through)

**Interfaces:**
- Consumes: `hotkey.HotkeyManager.snapshot()`/`HotkeyStatus`/`retry()` (Task
  1-3), `_DaemonRunner.trigger_draft_capture()` (Task 6),
  `_SettingsWindow._set_tab_problem()` (Task 7).
- Produces: `run_settings_window(..., hotkey_manager=None, on_manual_capture=None)`
  and `_SettingsWindow.__init__(..., hotkey_manager=None, on_manual_capture=None)`
  — both new keyword-only params, defaulting to `None` (mirrors every
  other optional live-daemon param already there).

This is the biggest task in the plan — it's one deliverable (the whole tab,
working end-to-end) but has many steps. Work through them in order; there's
no automated test to run between steps (no `gui.py` test coverage), so each
step is immediately followed by the next rather than a test/run cycle.

- [ ] **Step 1: Thread `hotkey_manager` and `on_manual_capture` into `run_settings_window`**

In `daemon-python/src/gui.py`, update `run_settings_window`'s signature and
body:

```python
def run_settings_window(
    is_first_run: bool,
    status_tracker: StatusTracker | None = None,
    sync_state: SyncState | None = None,
    update_status: UpdateStatusTracker | None = None,
    draft_capture_status: DraftCaptureCoordinator | None = None,
    hotkey_manager: "hotkey.HotkeyManager | None" = None,
    on_manual_capture: Callable[[], None] | None = None,
) -> bool:
    """... (existing docstring, plus:)

    `hotkey_manager`, same condition, backs the Draft Live tab's real
    registration status (error message, last-triggered timestamp) and its
    "Réessayer" action. `on_manual_capture`, same condition, is what the
    Draft Live tab's "Capturer maintenant" button calls to trigger a real
    (non-dry-run) capture on demand.
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
    )
    root.mainloop()
    return result["saved"]
```

Add `from typing import Callable` to the imports if not already present
(check the top of `gui.py` first — if `Callable` isn't imported, add
`from typing import Callable` alongside the other `from __future__`/stdlib
imports).

- [ ] **Step 2: Thread the same params into `_SettingsWindow.__init__`**

```python
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
        hotkey_manager=None,
        on_manual_capture: Callable[[], None] | None = None,
    ) -> None:
        self._root = root
        self._is_first_run = is_first_run
        self._result = result
        self._status_tracker = status_tracker
        self._sync_state = sync_state
        self._update_status = update_status
        self._draft_capture_status = draft_capture_status
        self._hotkey_manager = hotkey_manager
        self._on_manual_capture = on_manual_capture
```

(leave every other line of `__init__` as-is.)

- [ ] **Step 3: Wire `run_app()` to pass the new params**

In `daemon-python/src/app.py`'s `run_app()`, update the `_on_open_settings`
closure's `run_settings_window` call:

```python
    def _on_open_settings() -> None:
        if run_settings_window(
            is_first_run=False,
            status_tracker=daemon.status,
            sync_state=daemon.sync_state,
            update_status=update_status,
            draft_capture_status=daemon.draft_capture_status,
            hotkey_manager=daemon.hotkey_manager,
            on_manual_capture=daemon.trigger_draft_capture,
        ):
```

(The very first, first-run call — `run_settings_window(is_first_run=True)`
— is unchanged: no daemon has started yet, so both new params correctly
stay `None`, same as `draft_capture_status` already does there.)

- [ ] **Step 4: Restructure `_build_draft_tab` into three sections**

Replace `_build_draft_tab`'s body. The existing "Activer la capture de
draft en direct" checkbox and hotkey display/"Modifier…" row are kept, just
regrouped under a "RACCOURCI" header with the new status line and
"Réessayer" button added; a new "CAPTURE" section holds both buttons; the
existing capture-progress bar and "Tester la capture" status move under a
new "ÉTAT" header along with the new last-triggered line.

```python
    def _build_draft_tab(self, parent: ttk.Frame) -> None:
        self._build_raccourci_section(parent)
        self._build_capture_section(parent)
        self._build_etat_section(parent)

    # -- Draft Live tab: Raccourci ------------------------------------------

    def _build_raccourci_section(self, parent: ttk.Frame) -> None:
        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x", pady=(0, 12))
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")
        inner.grid_columnconfigure(0, weight=1, minsize=340)

        ttk.Label(inner, text="RACCOURCI", style="SectionHeader.TLabel").grid(
            row=0, column=0, columnspan=3, sticky="w", pady=(0, 10)
        )

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
            hotkey_row, bg=_FIELD_BG, highlightthickness=1, highlightbackground=_FIELD_BG
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
                status_row, text="Réessayer", style="Ghost.TButton", command=self._retry_hotkey_registration
            )
            # Not packed here -- only shown while there's an error to retry,
            # see `_refresh_draft_capture_status`.

    def _retry_hotkey_registration(self) -> None:
        if self._hotkey_manager is None:
            return
        threading.Thread(
            target=self._hotkey_manager.retry, daemon=True, name="hots-hotkey-retry"
        ).start()

    # -- Draft Live tab: Capture ---------------------------------------------

    def _build_capture_section(self, parent: ttk.Frame) -> None:
        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x", pady=(0, 12))
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")

        ttk.Label(inner, text="CAPTURE", style="SectionHeader.TLabel").grid(
            row=0, column=0, columnspan=2, sticky="w", pady=(0, 10)
        )

        test_col = ttk.Frame(inner, style="Panel.TFrame")
        test_col.grid(row=1, column=0, sticky="nw", padx=(0, 20))
        self._test_capture_btn = ttk.Button(
            test_col, text="🔍 Tester la capture", style="Ghost.TButton", command=self._start_test_capture
        )
        self._test_capture_btn.pack(anchor="w")
        ttk.Label(
            test_col,
            text="Aucun envoi. Vérifie le cadrage/OCR sur la fenêtre active — pour calibrer.",
            style="PanelMuted.TLabel",
            wraplength=190,
            justify="left",
        ).pack(anchor="w", pady=(4, 0))

        if self._on_manual_capture is not None:
            capture_col = ttk.Frame(inner, style="Panel.TFrame")
            capture_col.grid(row=1, column=1, sticky="nw")
            ttk.Button(
                capture_col,
                text="📤 Capturer maintenant",
                style="Accent.TButton",
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
        self._test_capture_status_label.grid(row=2, column=0, columnspan=2, sticky="w", pady=(10, 0))

    def _start_manual_capture(self) -> None:
        if self._on_manual_capture is not None:
            self._on_manual_capture()

    # -- Draft Live tab: État -------------------------------------------------

    def _build_etat_section(self, parent: ttk.Frame) -> None:
        if self._draft_capture_status is None:
            return
        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x")
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")

        ttk.Label(inner, text="ÉTAT", style="SectionHeader.TLabel").grid(
            row=0, column=0, columnspan=3, sticky="w", pady=(0, 10)
        )

        self._draft_capture_animating = False
        self._draft_capture_status_label = ttk.Label(inner, text="", style="PanelMuted.TLabel")
        self._draft_capture_status_label.grid(row=1, column=0, columnspan=3, sticky="w")
        self._draft_capture_progress_bar = ttk.Progressbar(
            inner, orient="horizontal", length=200, mode="indeterminate"
        )
        # Not gridded here -- only shown while a capture is actually in
        # progress (see _refresh_draft_capture_status).

        self._hotkey_last_triggered_label = ttk.Label(inner, text="", style="PanelMuted.TLabel")
        self._hotkey_last_triggered_label.grid(row=3, column=0, columnspan=3, sticky="w", pady=(10, 0))
```

- [ ] **Step 5: Add a `SectionHeader.TLabel` ttk style**

In `_apply_dark_style()`, add (near the other `TLabel` variants):

```python
    style.configure(
        "SectionHeader.TLabel",
        background=_PANEL,
        foreground=_TEXT_MUTED,
        font=("Segoe UI", 9, "bold"),
    )
```

- [ ] **Step 6: Extend `_refresh_draft_capture_status` to poll the hotkey status too**

Replace the method's body (it already reschedules itself every
`_LIVE_STATS_POLL_MS`; the hotkey refresh rides along on the same tick
instead of adding a second timer):

```python
    def _refresh_draft_capture_status(self) -> None:
        """Polled while the window is open ... (existing docstring
        unchanged) ...

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
            self._draft_capture_progress_bar.grid(row=2, column=0, columnspan=3, sticky="ew", pady=(6, 0))
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
            text = "Capture en cours…" if status.phase is CapturePhase.CAPTURING else "Envoi de la capture…"
            self._set_status(self._draft_capture_status_label, text, _NEUTRAL)

        self._refresh_hotkey_status()

        self._draft_capture_status_job = self._root.after(
            _LIVE_STATS_POLL_MS, self._refresh_draft_capture_status
        )

    def _refresh_hotkey_status(self) -> None:
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
                if not self._hotkey_retry_btn.winfo_ismapped():
                    self._hotkey_retry_btn.pack(side="left", padx=(10, 0))
            else:
                self._set_status(self._hotkey_registration_status, "", _NEUTRAL)
                if self._hotkey_retry_btn.winfo_ismapped():
                    self._hotkey_retry_btn.pack_forget()

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
```

- [ ] **Step 7: Add the `_format_time_ago` helper**

Add `from datetime import datetime, timezone` to `gui.py`'s imports (near
the top, with the other stdlib imports), and add a module-level helper near
`_truncate`:

```python
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
```

- [ ] **Step 8: Account for the two new dynamic labels in `_measure_worst_case_size`**

In `_measure_worst_case_size`, add to the `placeholders` list (inside the
existing `if self._draft_capture_status is not None:` block, since both new
labels only exist when that's true):

```python
        if self._draft_capture_status is not None:
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
```

(This replaces the single pre-existing `_draft_capture_status_label`
append inside that block — don't duplicate it.)

A few lines below that same block, `_measure_worst_case_size` also
temporarily grids the progress bar itself to account for its height:

```python
        if self._draft_capture_status is not None:
            self._draft_capture_progress_bar.grid(
                row=6, column=0, columnspan=3, sticky="ew"
            )
```

That `row=6` was correct for the old single-card Draft Live layout; the
État section built in Step 4 grids this same progress bar at `row=2`
inside its own `inner` frame (see `_refresh_draft_capture_status`'s Step 6
update). Change this line to match:

```python
        if self._draft_capture_status is not None:
            self._draft_capture_progress_bar.grid(
                row=2, column=0, columnspan=3, sticky="ew", pady=(6, 0)
            )
```

- [ ] **Step 9: Manual verification**

Run (from `daemon-python/`, with a valid `config.json` already saved so
it's not a first run): `python -m src.main`, then open Settings from the
tray icon. Confirm:
- The Draft Live tab shows three visually separated sections: RACCOURCI,
  CAPTURE, ÉTAT.
- "Tester la capture" and "Capturer maintenant" both appear side by side in
  CAPTURE, each with its own one-line caption.
- ÉTAT shows "Aucun appui détecté depuis l'ouverture." initially.
- Press the configured hotkey (default `Ctrl+Shift+D`) while any window has
  focus — ÉTAT's "dernier appui détecté" line updates within ~1s.
- Click "Capturer maintenant" — the same État section shows
  capturing/submitting feedback, same as a hotkey press would.
- Temporarily break the hotkey (e.g. rebind to a combo already claimed by
  another running app, or manually raise inside `HotkeyManager._attempt_registration`
  for a local test) to confirm the RACCOURCI section shows the red error
  line with a "Réessayer" button, and the tab label shows "Draft Live 🔴".

- [ ] **Step 10: Commit**

```bash
git add daemon-python/src/gui.py daemon-python/src/app.py
git commit -m "$(cat <<'EOF'
feat(daemon-gui): reorganize Draft Live tab, add manual capture + real
hotkey status

- New "Capturer maintenant" button triggers a real (non-dry-run) draft
  capture, next to the existing "Tester la capture" dry-run.
- RACCOURCI section now shows HotkeyManager's actual registration status
  (previously only syntax was validated) with a "Réessayer" action, plus
  a live "dernier appui détecté" timestamp independent of capture success.
- The tab label itself now flags a registration error via a small badge.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012p3QoJR5QJzy53tnoeDxsM
EOF
)"
```

---

## Task 9: `gui.py` — Config tab reorganization + autostart auto-repair

**Files:**
- Modify: `daemon-python/src/gui.py`

**Interfaces:**
- Consumes: `autostart.needs_repair()`, `autostart.is_enabled()`,
  `autostart.set_enabled()` (Task 4).

- [ ] **Step 1: Split `_build_config_tab` into three sections**

Replace `_build_config_tab`'s body:

```python
    def _build_config_tab(self, parent: ttk.Frame) -> None:
        self._build_connexion_section(parent)
        self._build_stockage_section(parent)
        self._build_demarrage_section(parent)

    # -- Config tab: Connexion -----------------------------------------------

    def _build_connexion_section(self, parent: ttk.Frame) -> None:
        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x", pady=(0, 12))
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")
        inner.grid_columnconfigure(0, weight=1, minsize=340)

        ttk.Label(inner, text="CONNEXION", style="SectionHeader.TLabel").grid(
            row=0, column=0, columnspan=3, sticky="w", pady=(0, 10)
        )

        self._api_entry, self._api_status, grid_row = self._build_field(
            inner, label="URL de l'API", var=self._api_var, start_row=1, on_change=self._on_api_or_token_changed
        )
        self._token_entry, self._token_status, grid_row = self._build_field(
            inner,
            label="Token d'accès",
            var=self._token_var,
            start_row=grid_row,
            on_change=self._on_api_or_token_changed,
            show="•",
        )
        link = ttk.Label(inner, text="Générer / gérer mon token →", style="Link.TLabel", cursor="hand2")
        link.grid(row=grid_row, column=0, columnspan=3, sticky="w")
        link.bind("<Button-1>", lambda _e: self._open_token_link())

    # -- Config tab: Stockage -------------------------------------------------

    def _build_stockage_section(self, parent: ttk.Frame) -> None:
        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x", pady=(0, 12))
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")
        inner.grid_columnconfigure(0, weight=1, minsize=340)

        ttk.Label(inner, text="STOCKAGE", style="SectionHeader.TLabel").grid(
            row=0, column=0, columnspan=3, sticky="w", pady=(0, 10)
        )

        self._replays_entry, self._replays_status, grid_row = self._build_field(
            inner, label="Dossier des replays", var=self._replays_var, start_row=1, on_change=self._on_replays_changed
        )
        browse = ttk.Button(inner, text="Parcourir…", style="Ghost.TButton", command=self._browse_replays_dir)
        browse.grid(row=grid_row, column=0, columnspan=3, sticky="w")

    # -- Config tab: Démarrage ------------------------------------------------

    def _build_demarrage_section(self, parent: ttk.Frame) -> None:
        if not autostart.is_supported():
            return
        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x")
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")

        ttk.Label(inner, text="DÉMARRAGE", style="SectionHeader.TLabel").grid(
            row=0, column=0, sticky="w", pady=(0, 10)
        )

        # If Windows silently disabled this entry (Task Manager's Startup
        # tab, or its own startup-impact policy -- see
        # autostart.needs_repair()), repair it proactively here rather than
        # just reflecting "unchecked" and waiting for the player to notice
        # and re-toggle it themselves.
        repaired = autostart.needs_repair()
        if repaired:
            autostart.set_enabled(True)

        self._autostart_var = tk.BooleanVar(value=autostart.is_enabled())
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
            self._set_status(
                self._autostart_status,
                "✓ Réactivé automatiquement (Windows l'avait désactivé).",
                _OK,
            )
```

- [ ] **Step 2: Verify-after-write in `_on_autostart_toggled`**

Replace the method:

```python
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
```

- [ ] **Step 3: Manual verification**

Run (from `daemon-python/`, compiled build recommended since
`autostart.is_supported()` requires `IS_FROZEN` — otherwise the Démarrage
section won't render at all, which is expected dev-mode behavior, not a
bug): confirm the Config tab shows three visually separated sections
(CONNEXION, STOCKAGE, DÉMARRAGE) with the same fields as before, just
regrouped, and that toggling the autostart checkbox updates the status
caption underneath it.

- [ ] **Step 4: Commit**

```bash
git add daemon-python/src/gui.py
git commit -m "$(cat <<'EOF'
feat(daemon-gui): reorganize Config tab into named sections, auto-repair
autostart on open

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012p3QoJR5QJzy53tnoeDxsM
EOF
)"
```

---

## Task 10: `gui.py` — Synchronisation tab throttle note

**Files:**
- Modify: `daemon-python/src/gui.py`

**Interfaces:**
- Consumes: `StatusTracker.snapshot()` (existing `found`/`synced`/`failed`
  fields, no changes needed there).

- [ ] **Step 1: Add the status label**

In `_build_sync_tab`, inside the existing `if self._status_tracker is not None:`
block, after the `self._sync_error_label` grid call, add:

```python
            self._sync_priority_label = ttk.Label(
                inner,
                text="",
                style="PanelMuted.TLabel",
                wraplength=_LABEL_WRAPLENGTH,
                justify="left",
            )
            self._sync_priority_label.grid(row=8, column=0, columnspan=4, sticky="w", pady=(6, 0))
```

- [ ] **Step 2: Update it in `_refresh_live_stats`**

In `_refresh_live_stats`, right after the existing `done = status.synced + status.failed`
line (before the progress-bar update, doesn't matter which order), add:

```python
        if status.found and done < status.found:
            self._sync_priority_label.configure(
                text=(
                    "⚙ Synchronisation initiale en cours à priorité CPU réduite — "
                    "ne devrait pas ralentir vos parties."
                )
            )
        else:
            self._sync_priority_label.configure(text="")
```

- [ ] **Step 3: Account for it in `_measure_worst_case_size`**

Add to the `placeholders` list, inside the existing
`if self._status_tracker is not None:` block:

```python
            placeholders.append(
                (
                    self._sync_priority_label,
                    "⚙ Synchronisation initiale en cours à priorité CPU réduite — "
                    "ne devrait pas ralentir vos parties.",
                )
            )
```

- [ ] **Step 4: Manual verification**

Run (from `daemon-python/`) `python -m src.main --resync` against a folder
with several replays, or point `HOTS_REPLAYS_DIR` at a folder with unsynced
replays and run normally; open Settings → Synchronisation while the initial
backlog is still draining. Confirm the new line appears while
`found > synced + failed`, and disappears once the backlog finishes.

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/gui.py
git commit -m "$(cat <<'EOF'
feat(daemon-gui): explain reduced-priority initial sync on the
Synchronisation tab

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012p3QoJR5QJzy53tnoeDxsM
EOF
)"
```

---

## Final check (after Task 10)

Run the full daemon test suite once more from `daemon-python/`:

```bash
pytest -q
```

Expected: all tests pass (the pre-existing suite plus every test added in
Tasks 1-6). Then do one full manual pass through the settings window
(`python -m src.main`, all four tabs) confirming nothing from the "Global
Constraints" fixed-size-window rule broke — the window should never visibly
resize when switching tabs or when any new status text changes.
