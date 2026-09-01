# Daemon Auto-Update: Migration to Velopack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the daemon's self-overwrite auto-update mechanism (an unsigned `.exe` copied over itself and relaunched via a generated PowerShell script — exactly the pattern real-time antivirus and Smart App Control are built to kill) with Velopack's atomic, versioned install-directory swap, at zero recurring cost, including a one-time migration path for the existing non-installer user base.

**Architecture:** CI packages the existing Nuitka build with `vpk pack`/`vpk upload github` instead of publishing a raw `.exe`. The daemon adds the `velopack` Python SDK, whose `UpdateManager` (backed by a `GithubSource`) replaces the hand-rolled GitHub-API-plus-PowerShell update path in `updater.py`, while `UpdateStatusTracker` and every other public name `app.py`/`gui.py`/`autostart.py` import from `updater.py` keeps its exact name and shape — this plan changes `updater.py`'s internals, not its public API, so `app.py` and `gui.py` need zero changes.

**Tech Stack:** Python (`daemon-python/`), the `velopack` PyPI package (official Python SDK, PyO3-backed), the `vpk` .NET global CLI tool (packaging/publishing only, not a runtime dependency), GitHub Actions (`windows-latest`), GitHub Releases.

**Spec:** `docs/superpowers/specs/2026-08-31-daemon-velopack-auto-update-design.md` — read it before this plan; this plan argues from it and resolves every one of its "Open items to resolve during implementation" with the exact API details confirmed below.

## Global Constraints

- Zero recurring cost: no code-signing certificate, no paid signing service. (From spec's Constraints.)
- Windows only — the daemon already only targets Windows.
- `updater.py`'s public surface that other files import MUST keep its exact name and call signature: `IS_FROZEN`, `AvailableUpdate`, `UpdatePhase`, `UpdateStatus`, `UpdateStatusTracker`, `watch_for_updates`, `release_page_url`, `trigger_manual_update`, `update_log_file_path`, `installed_exe_path`. (Confirmed exhaustively via `grep -rn "updater\." daemon-python/src` — these are the only cross-module call sites, in `app.py`, `gui.py`, `autostart.py`.)
- Daemon test command: `cd daemon-python && .venv/Scripts/python.exe -m pytest -q` (plain `pytest` not on PATH in this environment).
- Confirmed Velopack Python API (from `/velopack/velopack.docs`, current as of this plan — do not substitute remembered/guessed signatures):
  - `pip install velopack`.
  - Startup hook: `import velopack; velopack.App().run()` — must be the first thing executed in the main process, before any other app code runs.
  - `velopack.UpdateManager(source, options=None, locator=None)` with methods `check_for_updates()`, `download_updates(update_info, progress_callback=None)`, `apply_updates_and_restart(update)`, `apply_updates_and_exit(update)`, `wait_exit_then_apply_updates(update, silent=False, restart=True, restart_args=None)`, `get_current_version()`, `get_update_pending_restart()`.
  - Update source classes live under `velopack.sources`: `GithubSource(repo_url, access_token=None, prerelease=False)`, `HttpSource(url)`. **Verify the exact import (`from velopack.sources import GithubSource`) against the installed package in Task 1, Step 1 below before relying on it elsewhere** — this is the one piece of the SDK surface not directly confirmed via a raw Python import example in the docs consulted for this plan.
  - `UpdateInfo(TargetFullRelease, DeltasToTarget, IsDowngrade, BaseRelease=None)` and `VelopackAsset(PackageId, Version, Type, FileName, SHA1, SHA256, Size, NotesMarkdown, NotesHtml)` are the data model `check_for_updates()` returns (`None` if up to date).
  - Windows install layout (confirmed): `%LocalAppData%\{packId}\current\` (versioned app files, replaced whole on every update — nothing here survives an update, matches this daemon's existing convention of keeping all persistent state under `%APPDATA%\hots-analytics\`, confirmed unaffected — see Task 3), `%LocalAppData%\{packId}\Update.exe`, and a **stable stub** `%LocalAppData%\{packId}\{exeName}` at the root — "this stub launches the actual executable within the current directory, ensuring shortcuts remain stable across updates." Autostart must point at the stub, not the versioned copy.
  - `Setup.exe` CLI: `-s`/`--silent` (non-interactive install, no dialogs), `-t`/`--installto <DIR>`. Installs per-user to `%LocalAppData%\{packId}` with no elevation needed (this plan uses the default per-user install, not the MSI per-machine variant).
  - `vpk pack --packId <ID> --packVersion <VERSION> --packDir <DIR> --mainExe <NAME> [--packTitle <NAME>] [--icon <PATH>]` produces `{packId}-Setup.exe`, versioned full/delta `.nupkg`s, and a portable zip in `--outputDir` (default `Releases`).
  - `vpk upload github --repoUrl <URL> --token <TOKEN> --publish --tag <TAG>` publishes those directly to a GitHub Release, creating it if needed — this **replaces** the current `softprops/action-gh-release@v2` step, it does not run alongside it.
  - `vpk` itself installs via `dotnet tool install -g vpk` (a .NET global tool; `windows-latest` GitHub Actions runners ship a .NET SDK).

---

### Task 1: Add the `velopack` dependency and wire the startup hook

**Files:**
- Modify: `daemon-python/pyproject.toml`
- Modify: `daemon-python/run.py`

**Interfaces:**
- Produces: `run.py` calls `velopack.App().run()` before importing/running any other daemon code, satisfying Velopack's "first thing in the main process" contract.

- [ ] **Step 1: Verify the exact `GithubSource` import path against the installed package**

Add `velopack` to `daemon-python/pyproject.toml`'s `dependencies` list (alongside the existing `requests>=2.31`, `keyboard>=0.13.5`, etc. — match that list's alphabetical-ish grouping and add a one-line comment explaining its purpose, matching this file's existing per-dependency comment style, e.g. the `keyboard`/`pywin32`/`rapidocr-onnxruntime` block's "Live-draft capture feature" comment):

```toml
    # Auto-update (see updater.py) -- Velopack's Python SDK. Windows-only in
    # practice (this whole daemon targets Windows), but the package itself
    # has no platform marker, so it installs everywhere for consistency with
    # how this file already handles other Windows-only pieces.
    "velopack>=0.1",
```

Run: `cd daemon-python && pip install -e ".[dev]"` to install it into the existing `.venv`, then verify the import surface directly:

```
.venv/Scripts/python.exe -c "import velopack; print(velopack.UpdateManager); print(velopack.App)"
.venv/Scripts/python.exe -c "from velopack.sources import GithubSource; print(GithubSource)"
```

If the second command fails (`ModuleNotFoundError`/`ImportError`), inspect the installed package's actual module layout (`.venv/Scripts/python.exe -c "import velopack; help(velopack)"` or `python -c "import pkgutil, velopack; print([m.name for m in pkgutil.walk_packages(velopack.__path__, velopack.__name__ + '.')])"`) to find the real path, and use that real path in every subsequent task instead of `velopack.sources.GithubSource` — note the correction here in your task report so later tasks in this plan use the corrected import.

- [ ] **Step 2: Pin the actual installed version**

Replace `velopack>=0.1` in `pyproject.toml` with the exact version `pip show velopack` reports after Step 1's install (e.g. `velopack==0.x.y`), matching this file's existing convention of pinning exact versions for build-affecting dependencies (see the `heroprotocol` git-tag pin's own comment for the precedent).

- [ ] **Step 3: Wire the startup hook into `run.py`**

Current `run.py`:

```python
from __future__ import annotations

import sys

from src.main import main

if __name__ == "__main__":
    sys.exit(main())
```

Replace with (the `velopack.App().run()` call must execute before `src.main` — and anything it imports — is ever imported, so the `from src.main import main` line moves inside the `if __name__` block, after the hook call):

```python
"""Top-level launcher used only for the compiled (Nuitka) build.

Nuitka compiles whichever file you point it at as the `__main__` module, with
no parent package — so if that file itself does `from . import api_client`
(as `src/main.py` does), the relative import has nothing to resolve against
and fails at runtime with:

    ImportError: attempted relative import with no known parent package

Pointing Nuitka at *this* file instead fixes it: this script lives outside
the `src` package and does a normal `from src.main import main`, so Python
(and Nuitka, which mirrors CPython's import semantics) loads `src` as a real
package first. That gives `src.main` proper package context, so its internal
relative imports resolve normally. `src/main.py` itself is untouched and
keeps working as before for local dev (`python -m src.main`).

`velopack.App().run()` runs first, before `src.main` (and anything it
imports) is even imported -- Velopack's own contract requires this: it
handles special lifecycle invocations (first-run-after-install, post-update,
uninstall) that its installer/updater launches this exe with, and it may
itself exit the process after handling one of those instead of returning.
Only this compiled-build entry point needs it: `python -m src.main` (local
dev) never goes through a Velopack-managed install, so there's nothing for
the hook to do there and no reason to add it to `src/main.py` too.
"""

from __future__ import annotations

import sys

import velopack

if __name__ == "__main__":
    velopack.App().run()

    from src.main import main

    sys.exit(main())
```

- [ ] **Step 4: Verify the daemon still starts locally**

Run: `cd daemon-python && .venv/Scripts/python.exe -m src.main --help`
Expected: same output as before this change (this exercises `src/main.py` directly, bypassing `run.py`/the hook entirely, since the hook is compiled-build-only — this step only confirms Step 1-2's dependency install didn't break anything else).

- [ ] **Step 5: Run the full test suite**

Run: `cd daemon-python && .venv/Scripts/python.exe -m pytest -q`
Expected: same result as this plan's baseline (407 passed, 12 pre-existing unrelated failures in `test_ocr.py`/`test_updater.py` — do not treat those 12 as caused by this change; confirm no *new* failures).

- [ ] **Step 6: Commit**

```bash
git add daemon-python/pyproject.toml daemon-python/run.py
git commit -m "feat(daemon): add velopack dependency and startup hook"
```

---

### Task 2: Rewrite `updater.py`'s check/download/apply core around Velopack

**Files:**
- Modify: `daemon-python/src/updater.py`

**Interfaces:**
- Consumes: `velopack.UpdateManager`, `velopack.sources.GithubSource` (or the corrected import path from Task 1, Step 1), `velopack.App` (already wired in `run.py`, not called again here).
- Produces (unchanged public names/shapes — **read this list before touching anything**, these must still exist with the same signature after this task, since `app.py`/`gui.py`/`autostart.py` import them directly and are not being modified by this plan):
  - `IS_FROZEN: bool`
  - `class AvailableUpdate` (whatever fields it already exposes to callers — check current usage in `gui.py`/`app.py` before changing its shape)
  - `class UpdatePhase(str, Enum)`, `class UpdateStatus`, `class UpdateStatusTracker` (unchanged — this is the tray-facing state machine, independent of the underlying update mechanism)
  - `def release_page_url() -> str`
  - `def update_log_file_path() -> Path`
  - `def read_last_update_log_lines(max_lines: int = 10) -> list[str]`
  - `def watch_for_updates(...) -> ...` (read its current full signature in the file before touching it — `app.py` calls it directly)
  - `def perform_update(update: AvailableUpdate, status: UpdateStatusTracker) -> bool`
  - `def trigger_manual_update(status: UpdateStatusTracker) -> None`
  - `def installed_exe_path() -> Path` (signature unchanged; **implementation changes in Task 3, not this task** — leave it as-is here, Task 3 handles it in isolation so its own diff is reviewable on its own)

**Removed entirely** (no longer needed — Velopack's `UpdateManager`/`Update.exe` replace all of this):
  - `_RELAUNCH_SCRIPT`, `_render_relaunch_script`, `_powershell_diagnostics`
  - `_DETACHED_PROCESS`, `_CREATE_NEW_PROCESS_GROUP`, `_RELAUNCH_LIVENESS_CHECK_SECONDS`
  - `apply_update_and_exit`'s current body (the function name may be kept internally if `perform_update` still calls something by that name, or removed if `perform_update` calls `UpdateManager.apply_updates_and_restart` directly — your call once you've read `perform_update`'s current body; prefer removing the indirection if nothing outside this file references `apply_update_and_exit` by name, which the Global Constraints' exhaustive cross-module grep confirms is the case)
  - `parse_version`, `find_update` (Velopack's `UpdateManager.check_for_updates()` does its own version comparison against its manifest internally — these become dead code)
  - `download_update` as a hand-rolled `requests`-based downloader (replaced by `UpdateManager.download_updates()`)
  - `_ASSET_NAME`, `_LATEST_RELEASE_URL`, `_REQUEST_TIMEOUT_SECONDS`, `_DOWNLOAD_TIMEOUT_SECONDS` (GitHub-API-specific constants no longer used once `GithubSource` owns that HTTP traffic)
  - The exe-copying half of `manual_fallback_exe_path`/`stage_manual_fallback`/`_MANUAL_FALLBACK_PREFIX` (see Step 4 below — the *concept* of a fallback message survives, reworded; the *file-copying* implementation does not)
  - `cleanup_stale_downloads`, `downloads_dir` (Velopack manages its own download/apply staging directory under its install path; this daemon no longer needs to track or clean up a downloads folder itself)

**Kept as-is, unchanged:** `_STARTUP_DELAY_SECONDS`, `_CHECK_INTERVAL_SECONDS` (the 6-hour cadence — `watch_for_updates`'s outer loop shape is unchanged, only what it calls each cycle changes).

- [ ] **Step 1: Read the current file in full**

Read `daemon-python/src/updater.py` (961 lines) end to end before editing anything — the removal list above names functions/constants by name, but you need to see every call site *within this file* (not just cross-module ones, already enumerated in Global Constraints) before deleting anything, so nothing calls into a function you've removed.

- [ ] **Step 2: Add the module-level `UpdateManager` construction**

Near the top of the file, after the existing imports and before the constants block, add:

```python
import velopack
from velopack.sources import GithubSource  # or the corrected path from Task 1 Step 1

_GITHUB_REPO_URL = "https://github.com/aifedespaix/hots-stats"

_update_manager = velopack.UpdateManager(GithubSource(_GITHUB_REPO_URL, None, False))
```

Keep this at module level (constructed once at import time, like the existing `_GITHUB_REPO`/`_LATEST_RELEASE_URL` constants it replaces) rather than inside a function — every caller (`perform_update`, `trigger_manual_update`, `watch_for_updates`) shares the same manager instance, matching how the removed `_LATEST_RELEASE_URL` constant was already shared module state.

- [ ] **Step 3: Rewrite the check/download/apply sequence**

Wherever `perform_update` (and any helper it called, like the old `check_for_update`/`download_update`/`apply_update_and_exit`) currently orchestrates the GitHub-API-plus-PowerShell flow, replace it with calls into `_update_manager`:

```python
def perform_update(update: AvailableUpdate, status: UpdateStatusTracker) -> bool:
    """... (keep the existing docstring's intent, update its description of
    *how* this works to match the paragraph below, not its outer contract)

    Downloads via Velopack's UpdateManager (backed by GithubSource, see
    module-level `_update_manager`), then applies via
    `apply_updates_and_restart` -- an atomic, versioned install-directory
    swap performed by Velopack's own bundled `Update.exe`, which is what
    replaces this daemon's previous hand-rolled PowerShell relaunch script
    (see git history / docs/superpowers/specs/2026-08-31-daemon-velopack-auto-update-design.md
    for why that script existed and why it was replaced).
    """
    # Adapt update_info's shape (a velopack.UpdateInfo, obtained by the
    # caller via _update_manager.check_for_updates() before this function
    # is invoked -- read how `AvailableUpdate` is currently constructed
    # from `find_update`'s return value in the code you're replacing, and
    # give `AvailableUpdate` the equivalent fields sourced from UpdateInfo/
    # VelopackAsset instead, e.g. `update.velopack_info: UpdateInfo` stored
    # alongside whatever version string it already exposes for display).
    ...
    try:
        _update_manager.download_updates(
            update.velopack_info,
            progress_callback=lambda fraction: status.set_progress(fraction),  # adapt to UpdateStatusTracker's actual progress-reporting method name
        )
    except Exception as err:
        status.set_error(f"Le téléchargement de la mise à jour a échoué : {err}")
        return False

    try:
        _update_manager.apply_updates_and_restart(update.velopack_info)
        return True  # unreachable in practice -- apply_updates_and_restart restarts the process
    except Exception as err:
        status.set_error(f"L'installation de la mise à jour a échoué : {err}")
        return False
```

This is a sketch of the shape, not literal final code — `AvailableUpdate`'s actual current fields and `UpdateStatusTracker`'s actual current method names (`set_progress`/`set_error` above are placeholders for whatever the real methods are called) must come from what you read in Step 1, not from this plan's guess. Preserve `UpdateStatusTracker`'s existing phase transitions (`UpdatePhase.CAPTURING`-equivalent-for-updates states, e.g. downloading/installing/error) around these calls the same way the code you're replacing already did.

- [ ] **Step 4: Rewrite the manual-fallback message for the new failure mode**

Keep `manual_fallback_message`'s *purpose* (actionable text shown in the tray/settings window when an update can't complete automatically) but reword it to point at downloading and running the installer from `release_page_url()`, not at a locally-staged fallback `.exe` copy (that concept — `manual_fallback_exe_path`/`stage_manual_fallback`'s file-copy — is removed per this task's removal list, since there's no equivalent "already-downloaded build sitting in a temp folder" once Velopack owns the download). Something in the shape of:

```python
def manual_fallback_message(version: str) -> str:
    """Actionable instructions shown (see gui.py) when an update could not
    be applied automatically. Points at the installer on the GitHub Release
    page rather than a locally-staged file -- Velopack's UpdateManager owns
    the download/apply staging directory, so unlike the old PowerShell-based
    mechanism, there is no separate "already-downloaded build" this daemon
    can point the user at directly."""
    return (
        f"La mise à jour vers la version {version} n'a pas pu être installée automatiquement. "
        f"Téléchargez et lancez l'installeur depuis {release_page_url()} pour l'installer manuellement."
    )
```

Update every call site of `manual_fallback_message` (in this file and in `gui.py`, per the Global Constraints grep results showing `gui.py` references it in comments near line 281/1306) to match the new signature (one fewer parameter — no `fallback_path`).

- [ ] **Step 5: Update `watch_for_updates` and `trigger_manual_update`**

These keep their existing outer shape (periodic 6h check for `watch_for_updates`; on-demand check-and-apply for `trigger_manual_update`, called from the settings window's manual "check now" button) — only their internal call into check/download/apply changes, to go through `_update_manager.check_for_updates()` instead of the removed `check_for_update`/`find_update`. Read their current bodies in full (from Step 1) before editing, and preserve every existing behavior this plan doesn't explicitly call out as removed (e.g. `watch_for_updates`'s notify-only-once-per-version logic, `_failure_notified`-style state, `auto_update_enabled` config gating — all of this is orthogonal to *how* an update is checked/applied and must survive unchanged).

- [ ] **Step 6: Run the daemon test suite**

Run: `cd daemon-python && .venv/Scripts/python.exe -m pytest -q`
Expected: many failures in `test_updater.py` at this point — Task 4 rewrites that file. Confirm failures are confined to `test_updater.py` and that no *other* test file regresses (a change to `updater.py`'s public surface shape would show up as an import error or failure in `test_app.py`/`test_config.py`, which also touch daemon startup — if you see failures there, stop and investigate before proceeding, since it means this task broke one of the Global Constraints' preserved-signature guarantees).

- [ ] **Step 7: Commit**

```bash
git add daemon-python/src/updater.py
git commit -m "feat(daemon): replace self-overwrite update mechanism with Velopack"
```

(Leave `test_updater.py` failing at this commit — Task 4 fixes it in its own reviewable commit, consistent with this plan's task-by-task structure. Note this explicitly in your task report so the reviewer doesn't flag it as an oversight.)

---

### Task 3: Point `installed_exe_path()` / autostart at the Velopack stub

**Files:**
- Modify: `daemon-python/src/updater.py` (`installed_exe_path` only)

**Interfaces:**
- Consumes: nothing new.
- Produces: `installed_exe_path() -> Path` — same signature, new implementation. `autostart.py` imports and calls this function directly and needs **no changes of its own** (confirmed via the Global Constraints grep — it only imports `IS_FROZEN, installed_exe_path` and calls the latter with no arguments).

- [ ] **Step 1: Write the failing test**

In `daemon-python/tests/test_updater.py` (this test survives Task 4's rewrite — write it now so Task 4 doesn't need to remember to add it, and because Task 3 lands first):

```python
def test_installed_exe_path_returns_the_velopack_stub_path(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setattr(updater, "_PACK_ID", "hots-analytics-daemon")
    monkeypatch.setattr(updater, "_EXE_NAME", "hots-analytics-daemon.exe")

    result = updater.installed_exe_path()

    assert result == tmp_path / "hots-analytics-daemon" / "hots-analytics-daemon.exe"
```

(Adjust the `monkeypatch.setattr` target names to whatever constant names you actually introduce in Step 3 below — this is illustrative of the assertion, not a literal final test if your constant names differ; keep the assertion's shape — env var drives the base, then `{packId}/{exeName}` — regardless.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd daemon-python && .venv/Scripts/python.exe -m pytest tests/test_updater.py::test_installed_exe_path_returns_the_velopack_stub_path -v`
Expected: FAIL (old implementation reads `NUITKA_ONEFILE_BINARY`/`sys.executable`, ignores `LOCALAPPDATA`).

- [ ] **Step 3: Rewrite `installed_exe_path`**

```python
# Must match the `--packId`/`--mainExe` values `vpk pack` is invoked with in
# .github/workflows/build-daemon.yml -- these three names (this pair, plus
# the CI workflow's own two flags) are the one place Velopack's identity for
# this app is decided; keep them in sync if either ever changes.
_PACK_ID = "hots-analytics-daemon"
_EXE_NAME = "hots-analytics-daemon.exe"


def installed_exe_path() -> Path:
    """The stable path Windows autostart (and anything else that needs "the
    exe to launch, that will still be there next boot") should point at --
    NOT `sys.executable` (which under Nuitka's --onefile packaging resolves
    to an ephemeral per-run extraction folder that's deleted at exit) and
    NOT the versioned copy inside Velopack's `current\` directory (which
    gets replaced wholesale on every update -- a shortcut pointing directly
    at it could end up pointing at a deleted file mid-update).

    Velopack installs to `%LocalAppData%\\{packId}\\` and places a small,
    version-independent "stub" executable at the root of that folder (next
    to `current\` and `Update.exe`) whose only job is to launch whatever is
    currently inside `current\` -- see
    docs/superpowers/specs/2026-08-31-daemon-velopack-auto-update-design.md.
    That stub is what stays stable across updates, so it's what this
    function returns.
    """
    local_app_data = os.environ.get("LOCALAPPDATA")
    base = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
    return base / _PACK_ID / _EXE_NAME
```

Delete the old implementation (the `NUITKA_ONEFILE_BINARY`/`sys.executable` version) and its now-inapplicable docstring content entirely — this is a full replacement, not an addition alongside it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd daemon-python && .venv/Scripts/python.exe -m pytest tests/test_updater.py::test_installed_exe_path_returns_the_velopack_stub_path -v`
Expected: PASS.

- [ ] **Step 5: Update or remove the two old `installed_exe_path` tests**

`test_installed_exe_path_prefers_onefile_binary_env` and `test_installed_exe_path_falls_back_to_sys_executable` (lines ~192-208 in the pre-Task-4 file) test behavior that no longer exists. Delete both — Step 1's new test replaces them; there is no equivalent "onefile env / sys.executable fallback" behavior left to test since the function no longer reads either.

- [ ] **Step 6: Run the full test suite**

Run: `cd daemon-python && .venv/Scripts/python.exe -m pytest -q`
Expected: `test_updater.py` still has many other failures (Task 4's job) — confirm specifically that no test in `test_autostart.py` (if one exists — check) or any file besides `test_updater.py` newly fails, since `installed_exe_path`'s return value is exactly what `autostart.py`'s `set_enabled` writes into the registry.

- [ ] **Step 7: Commit**

```bash
git add daemon-python/src/updater.py daemon-python/tests/test_updater.py
git commit -m "fix(daemon): point installed_exe_path at the Velopack stub, not the Nuitka onefile path"
```

---

### Task 4: Rewrite `test_updater.py` for the Velopack-based implementation

**Files:**
- Modify: `daemon-python/tests/test_updater.py`

**Interfaces:**
- Consumes: whatever `updater.py`'s actual post-Task-2/3 public+private surface turns out to be (read the file fresh, post-Task-2/3, before writing tests against it — do not write tests from this plan's Task 2 sketch, which was explicitly not final code).

- [ ] **Step 1: Delete every test tied to removed functionality**

Delete all tests exercising: `_render_relaunch_script` (`test_render_relaunch_script_*`, 8 tests), `_powershell_diagnostics` (`test_powershell_diagnostics_*`, 6 tests), `apply_update_and_exit`'s relaunch/liveness behavior (`test_apply_update_and_exit_exits_when_relaunch_script_stays_alive`, `test_apply_update_and_exit_aborts_when_relaunch_script_dies_immediately`, `test_apply_update_and_exit_logs_captured_powershell_output_on_quick_exit`, `test_apply_update_and_exit_aborts_when_powershell_fails_to_launch`, `test_apply_update_and_exit_logs_diagnostics_line`), `parse_version`/`find_update` (`test_parse_version_*`, `test_find_update_*`), `check_for_update`/`download_update`'s HTTP-mocking tests (`test_check_for_update_*`, `test_download_update_*`), the old `manual_fallback_exe_path`/`stage_manual_fallback` file-copy tests (`test_manual_fallback_exe_path_prefixes_the_installed_name`, `test_stage_manual_fallback_copies_next_to_the_installed_exe`, `test_stage_manual_fallback_returns_none_without_raising_on_failure`), `test_manual_fallback_message_names_the_real_files_and_version` (signature changed in Task 2 Step 4), `test_downloads_dir_is_under_the_system_temp_dir`, `test_cleanup_stale_downloads_removes_leftover_files`, `test_cleanup_stale_downloads_noop_when_dir_absent`, `test_watch_for_updates_cleans_up_stale_downloads_once_per_run` (all `cleanup_stale_downloads`/`downloads_dir` — removed in Task 2).

- [ ] **Step 2: Keep, unmodified, every test of `UpdateStatusTracker`'s own state machine**

`test_try_begin_succeeds_when_idle`, `test_try_begin_fails_while_already_downloading`, `test_try_begin_fails_while_installing`, `test_set_can_set_manual_fallback_path_explicitly`, `test_set_resets_manual_fallback_path_by_default` — read each one first; if any references the now-removed `manual_fallback_path` concept specifically (as its name suggests some might), adapt it to whatever `UpdateStatusTracker.set(...)`'s actual post-Task-2 parameters are rather than deleting it outright, since the underlying "only one update operation in flight at a time" coordination logic this protects is unrelated to *how* the update is fetched/applied and should still exist and still be tested.

- [ ] **Step 3: Write new tests for the Velopack-backed check/download/apply flow**

Mock `velopack.UpdateManager` (patch the module-level `_update_manager` instance from Task 2, or patch `velopack.UpdateManager` at construction time, whichever is more natural given the final Task 2 code) to cover, at minimum:
- `perform_update` calls `download_updates` then `apply_updates_and_restart`, and returns `True` / leaves `UpdateStatusTracker` in a success-adjacent state when both succeed.
- `perform_update` catches a `download_updates` failure, records it via `UpdateStatusTracker`'s error-reporting method, and returns `False` without calling `apply_updates_and_restart`.
- `perform_update` catches an `apply_updates_and_restart` failure the same way.
- `trigger_manual_update` and `watch_for_updates` still correctly gate on `auto_update_enabled`/notify-once-per-version/whatever other config-driven behavior Task 2 Step 5 preserved — write these as adaptations of the *existing* `test_trigger_manual_update_*`/`test_watch_for_updates_*` tests (update their internal mocking target from the old `check_for_update`/`apply_update_and_exit` functions to the new `_update_manager` calls), not as brand-new tests, since the behavior itself is unchanged.

Follow this file's existing `monkeypatch`-based mocking style (visible in the tests you're keeping/adapting) rather than introducing a new mocking library/pattern.

- [ ] **Step 4: Run the full test suite**

Run: `cd daemon-python && .venv/Scripts/python.exe -m pytest -q`
Expected: back to the plan's baseline — 407 (or your new total, if you added/removed a different net count of tests than the baseline had) passed, only the same 12 pre-existing unrelated failures in `test_ocr.py`/`test_updater.py`... **wait**: 3 of those 12 baseline failures (`test_apply_update_and_exit_exits_when_relaunch_script_stays_alive`, `test_apply_update_and_exit_aborts_when_relaunch_script_dies_immediately`, `test_apply_update_and_exit_logs_captured_powershell_output_on_quick_exit`) are tests you deleted in Step 1 — they should be **gone from the failure list entirely**, not passing. Confirm the new baseline is 9 pre-existing failures (the `test_ocr.py` ones only), not 12, and that this is because those 3 tests no longer exist, not because they're newly passing without you understanding why.

- [ ] **Step 5: Commit**

```bash
git add daemon-python/tests/test_updater.py
git commit -m "test(daemon): rewrite updater tests for the Velopack-backed implementation"
```

---

### Task 5: CI — package and publish via `vpk` instead of a raw exe

**Files:**
- Modify: `.github/workflows/build-daemon.yml`

**Interfaces:**
- Produces: the workflow publishes `hots-analytics-daemon-Setup.exe` plus versioned `.nupkg`s to the same GitHub Release the existing `bump_version` job's tag already creates, instead of the raw `hots-analytics-daemon.exe` asset. **This task, by itself, breaks update delivery for every currently-installed (pre-Velopack) daemon** — their update check looks for an asset literally named `hots-analytics-daemon.exe`, which this task stops publishing under that exact name for the packed release. Do not merge/ship this task's change to `main` in isolation from Task 6 (the migration shim) — land them together, or at minimum land Task 6 first. Note this explicitly in your task report.

- [ ] **Step 1: Replace the "Publish GitHub Release" step**

In `.github/workflows/build-daemon.yml`, after the existing "Upload build artifact" step and in place of the current "Publish GitHub Release" step (the `softprops/action-gh-release@v2` one), add:

```yaml
      - name: Install vpk
        if: needs.bump_version.outputs.tag != '' || startsWith(github.ref, 'refs/tags/v')
        run: dotnet tool install -g vpk --version <PIN_EXACT_VERSION>
        # <PIN_EXACT_VERSION>: run `dotnet tool install -g vpk` locally (no
        # --version) once, note the version it installs, and pin that exact
        # value here -- matches this repo's existing "pin exact versions"
        # convention (see this same file's Nuitka --mingw64 rationale).
        # Confirm .NET SDK availability on windows-latest first; if it's
        # missing, add an `actions/setup-dotnet@v4` step before this one.

      - name: Pack release with vpk
        if: needs.bump_version.outputs.tag != '' || startsWith(github.ref, 'refs/tags/v')
        shell: bash
        run: >
          vpk pack
          --packId hots-analytics-daemon
          --packVersion ${{ steps.version.outputs.version }}
          --packDir dist
          --mainExe ${{ env.ASSET_NAME }}
          --packTitle "HotS Analytics Daemon"
          --icon assets/app-icon.ico
        # --packId/--mainExe must exactly match `_PACK_ID`/`_EXE_NAME` in
        # daemon-python/src/updater.py's `installed_exe_path` (Task 3) --
        # keep all three in sync if either ever changes.

      - name: Publish to GitHub Releases with vpk
        if: needs.bump_version.outputs.tag != '' || startsWith(github.ref, 'refs/tags/v')
        run: >
          vpk upload github
          --repoUrl https://github.com/aifedespaix/hots-stats
          --token ${{ secrets.GITHUB_TOKEN }}
          --publish
          --tag ${{ needs.bump_version.outputs.tag || github.ref_name }}
```

Remove the existing `softprops/action-gh-release@v2` step entirely — `vpk upload github` replaces it, it does not run alongside it (running both would create/target the release twice).

- [ ] **Step 2: Verify the `windows-latest` runner has a usable .NET SDK**

Before relying on Step 1's bare `dotnet tool install -g vpk` working, confirm via a throwaway `workflow_dispatch` run (or by checking `windows-latest`'s documented preinstalled software list) that `dotnet --version` succeeds on the runner without an explicit `actions/setup-dotnet@v4` step first. If it doesn't, add:

```yaml
      - name: Set up .NET
        if: needs.bump_version.outputs.tag != '' || startsWith(github.ref, 'refs/tags/v')
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: "8.0"
```

before the "Install vpk" step.

- [ ] **Step 3: Dry-run on a manual `workflow_dispatch`**

Trigger this workflow manually (`workflow_dispatch`, not a real push to `main` — this avoids bumping the real version/tag while validating) and confirm: the Nuitka build step still succeeds unchanged, `vpk pack` produces a `Releases/` directory with the expected files (`hots-analytics-daemon-Setup.exe`, `.nupkg`s), and — since `workflow_dispatch` without a tag push means `needs.bump_version.outputs.tag` is empty and `github.ref` isn't `refs/tags/v*`, per the existing `if:` conditions — the publish steps correctly skip (same as today's behavior for this same event type), so this dry run does not actually publish anything.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/build-daemon.yml
git commit -m "ci(daemon): publish releases via vpk instead of a raw exe asset"
```

---

### Task 6: One-time migration shim for the existing (pre-Velopack) install base

**Files:**
- Modify: `daemon-python/src/updater.py`
- Modify: `.github/workflows/build-daemon.yml`

**Interfaces:**
- Consumes: Task 2's Velopack-based `updater.py`, Task 5's `vpk`-published releases.
- Produces: exactly ONE transitional release that (a) still publishes the legacy raw `hots-analytics-daemon.exe` asset under its exact old name, so every already-installed daemon's existing (unmodified, pre-this-plan) update-check code path still finds and downloads it, and (b) whose `main()` startup, on that one run, silently installs the Setup.exe and retires itself.

- [ ] **Step 1: Add a one-time migration check to the startup path**

In `daemon-python/src/updater.py`, add:

```python
_MIGRATION_DONE_CONFIG_KEY = "velopack_migration_complete"  # adapt to however config.py's local settings/flags are actually read/written -- read config.py's existing pattern (e.g. how auto_update_enabled is stored) before inventing a new mechanism


def is_running_from_legacy_install() -> bool:
    """True only for the one-time migration case: a frozen build running
    from somewhere other than the Velopack-managed install directory (i.e.
    the old raw-exe install model, from before this migration). Never true
    for a fresh Velopack install, and never true for local dev."""
    if not IS_FROZEN:
        return False
    return installed_exe_path().parent != Path(os.environ.get("LOCALAPPDATA", "")) / _PACK_ID


def migrate_to_velopack_install() -> None:
    """Downloads the current release's Setup.exe and runs it silently, then
    marks the migration done (see `_MIGRATION_DONE_CONFIG_KEY`) so this never
    repeats even if somehow launched again from the old location. Called
    once, early in `main()`, only for the one transitional release this
    function ships in -- see docs/superpowers/specs/2026-08-31-daemon-velopack-auto-update-design.md's
    "Migration" section. Best-effort: any failure here just leaves the user
    on their current (working) install, to be retried on this release's next
    launch rather than left in a broken state.
    """
    # 1. Check the local config flag (via config.py's existing mechanism) --
    #    if already marked done, return immediately.
    # 2. Download this release's Setup.exe from release_page_url()'s release
    #    (reuse whatever HTTP client this daemon already has for downloading
    #    a GitHub release asset -- note _update_manager itself doesn't
    #    expose "download an arbitrary asset by name", only "download the
    #    update package", so this needs a small direct `requests.get` against
    #    the GitHub Releases API, same pattern the pre-Task-2 `download_update`
    #    used, kept specifically for this one-time migration path even though
    #    Task 2 removed it from the main update flow).
    # 3. Run it: subprocess.Popen([str(setup_exe_path), "--silent"], ...).
    # 4. On success, write the config flag. Log every step (this is a
    #    one-shot, hard-to-debug-after-the-fact operation for real users --
    #    err on the side of over-logging here).
    raise NotImplementedError  # replace with the real implementation per the numbered steps above
```

This is a scaffold, not final code — the exact `config.py` flag-storage call and the exact download-a-named-asset HTTP call need to match this codebase's real existing patterns (read `config.py`'s `load_config`/`save_config` and the pre-Task-2 `download_update` you removed, e.g. via `git show HEAD~N:daemon-python/src/updater.py` from before Task 2's commit, for the exact `requests` usage this replaces) rather than being invented from scratch.

- [ ] **Step 2: Call it from `src/main.py`, gated to this one release only**

Find `src/main.py`'s `main()` entry point (called from both `run.py` and `python -m src.main`). Add, very early — before normal startup, but after `run.py`'s `velopack.App().run()` hook has already had its chance to run (this migration check only matters for a build running OUTSIDE a Velopack install, so ordering relative to the hook is irrelevant in practice, but keep it as the first real logic `main()` performs regardless, for the same "handle exceptional startup cases before anything else" reasoning `run.py`'s hook already follows):

```python
if updater.is_running_from_legacy_install():
    updater.migrate_to_velopack_install()
    return  # this run's only job was migrating; don't also start the tray/sync
```

- [ ] **Step 3: Add a CI marker for "this is the migration release"**

This code must ship in exactly one release, then be removed (a permanent migration-checking cost on every future startup, for a one-time event, is unnecessary complexity — plan a follow-up task, tracked outside this plan, to delete `is_running_from_legacy_install`/`migrate_to_velopack_install` and this `main()` call once telemetry/support signals confirm the existing install base has migrated). Document this explicitly in this task's commit message and in a code comment on `migrate_to_velopack_install` itself, so it isn't mistaken for permanent infrastructure.

For the one transitional release itself: in `.github/workflows/build-daemon.yml`, this migration release needs the OLD raw-exe publish step (Task 5 removed it) to run ONE more time, alongside the new `vpk` steps. Add a manually-triggered one-off step (not a permanent part of the workflow) for that single release — e.g. temporarily re-add a `softprops/action-gh-release@v2` step publishing `dist/${{ env.ASSET_NAME }}` under its exact legacy name to the SAME release `vpk upload github` also publishes to (check `softprops/action-gh-release`'s `--merge`/append-to-existing-release behavior, matching `vpk upload github --merge` from the CLI reference in the spec's Global Constraints, if both need to add assets to one release without clobbering each other), then remove this step again in the very next commit after the transitional release ships. Do not leave this dual-publish step in place permanently — it exists for exactly one release.

- [ ] **Step 4: Manual verification (cannot be automated)**

This task's actual correctness — does an old daemon really find, download, silently-install, and then stop bothering the user — can only be verified with a real pre-Velopack build on a real Windows machine pointed at a test release. Document a manual verification checklist in your task report rather than claiming automated proof: (1) install the pre-migration build fresh; (2) publish a transitional release per this task; (3) confirm the old daemon's next 6h check cycle downloads and silently runs `Setup.exe`; (4) confirm the daemon relaunches from the new Velopack-managed location and the tray icon/settings window still work; (5) confirm autostart still fires next reboot, now via the Velopack stub path.

- [ ] **Step 5: Run the full test suite**

Run: `cd daemon-python && .venv/Scripts/python.exe -m pytest -q`
Expected: no regressions from this task's baseline. Add unit tests for `is_running_from_legacy_install()`'s pure logic (given a mocked `installed_exe_path`/`LOCALAPPDATA`, does it correctly return `True`/`False`) — `migrate_to_velopack_install`'s actual download/subprocess/config-write behavior is reasonable to leave to the manual checklist above rather than deeply mocking a one-shot, soon-to-be-deleted migration path, but say so explicitly in your report rather than silently skipping test coverage.

- [ ] **Step 6: Commit**

```bash
git add daemon-python/src/updater.py daemon-python/src/main.py daemon-python/tests/test_updater.py
git commit -m "feat(daemon): one-time migration shim for pre-Velopack installs"
```

(The `.github/workflows/build-daemon.yml` transitional-release change from Step 3 is a separate, deliberately temporary commit made only when actually cutting that one release — do not bundle it into this commit, and do not implement it speculatively now; leave a comment in this task's code pointing at this plan section for whoever cuts that release.)

---

### Task 7: Final manual validation (not automatable — do not skip or claim done without it)

**Not a code task.** Everything through Task 6 makes the new mechanism *implementable correctly*; whether it actually survives contact with real Windows antivirus/SmartScreen configurations can only be observed for real, per the spec's own Testing section.

- [ ] Cut a real (non-transitional) release through the new `vpk`-based pipeline (Task 5) on a test/beta channel if one exists, or as a real patch release if not.
- [ ] Install it fresh via `Setup.exe` on a real Windows machine with default Windows Defender settings (no exclusions added). Confirm no SmartScreen block on the installer itself, or note it if one occurs (expected to still happen occasionally on a brand-new unsigned installer's first appearance — the design's win is on the *update* path, not necessarily first-install).
- [ ] Bump the version once more and confirm the running daemon's next 6h check cycle (or `trigger_manual_update` via the settings window, for a faster manual check) downloads and applies the update without antivirus interference, and that the app relaunches correctly from the Velopack-managed `current\` directory.
- [ ] Confirm existing persistent state (`%APPDATA%\hots-analytics\config.json`, `sync_state.db`, `update.log`, live-draft data) survived the update untouched — this plan's design relies on that data already living outside Velopack's `current\` directory (confirmed during design, not re-verified by any automated test in this plan).
- [ ] Confirm Windows autostart still launches the daemon correctly after a reboot, via the Velopack stub path (Task 3).
