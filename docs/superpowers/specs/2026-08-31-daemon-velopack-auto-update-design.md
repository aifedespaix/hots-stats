# Daemon Auto-Update: Migration to Velopack — Design

## Context

The Windows daemon (`daemon-python/`) self-updates by downloading a raw, unsigned
`.exe` from a GitHub Release and, at runtime, generating a PowerShell script that
copies the new `.exe` over the running one and relaunches — see
`daemon-python/src/updater.py`'s module-level docstrings, which already document
this in detail. This is exactly the behavior real-time antivirus and Windows
Smart App Control are built to kill (an unsigned process silently overwriting
itself and relaunching), and the app is not code-signed (no certificate has
been purchased, and this project has decided not to purchase one — see
"Constraints" below). The existing code already contains extensive
defense-in-depth around this (retries, immediate-exit detection, a manual
fallback message) — none of it fixes the structural cause.

**Goal:** replace the self-overwrite update mechanism with one structurally
resistant to this failure mode, at zero recurring cost, and migrate the
existing (non-installer) user base onto it automatically.

**Non-goals:** code signing (ruled out — cost), switching to a different
distribution channel such as winget (considered, rejected as a bigger lift for
similar benefit — see "Alternatives considered"), any change to what the
daemon does once running (parsing, sync, live-draft capture are untouched).

## Constraints

- **Zero recurring cost.** No code-signing certificate, no paid signing
  service (e.g. Azure Trusted Signing was considered and rejected on cost
  grounds even though cheaper than a traditional cert).
- **Windows only.** The daemon already only targets Windows (Nuitka
  `--onefile`, `winreg`-based autostart, PowerShell-based relaunch today).
- Must keep working for the existing installed base (raw `.exe`, no
  installer, arbitrary install location, autostart registry entry pointing at
  that location) without requiring users to take any manual action to receive
  the migration, other than the auto-update already succeeding once more via
  the *existing* (currently-working, just occasionally-blocked) mechanism.

## Chosen approach: Velopack

[Velopack](https://velopack.io) is an open-source (MIT), actively maintained
update/installer framework built for exactly this failure mode: unsigned
Windows apps needing reliable self-updates. It ships an official Python SDK
(`pip install velopack`, `velopack.UpdateManager`), so integration is a normal
Python dependency, not a subprocess shim around a foreign binary.

Structural fix: instead of overwriting the running executable in place,
Velopack downloads a versioned package into a separate directory and performs
an atomic swap via a small bundled `Update.exe`, which does not change between
releases (only the payload it applies does). This removes the specific race
(a locked/mid-scan file being overwritten by the still-running process) that
kills today's update, and — because the small stub binary is stable across
releases, unlike today's every-release-is-a-new-unrecognized-file `.exe` — it
can accumulate SmartScreen/AV reputation over time instead of starting at zero
on every single release.

### Alternatives considered

- **Keep hardening the current self-overwrite pattern.** Zero additional
  engineering, but this is exactly what has already been tried at length (see
  the existing retry/detection/fallback code) and is the reason this redesign
  was requested. Not pursued.
- **winget.** Microsoft's package manager: no paid certificate needed for
  community-repo submission, and install/update goes through a normal,
  expected installer invocation rather than a silent background self-copy —
  likely also resistant to this failure mode. Rejected as the primary fix for
  now because it requires a real installer (which Velopack also produces, as
  a side effect) *and* a user migration to a new install/update channel, for
  a similar structural benefit to Velopack alone. Worth revisiting later as
  an additional distribution channel, not a replacement for the mechanism
  fix.
- **Code signing (any tier, including cheap options like Azure Trusted
  Signing).** Ruled out on the zero-recurring-cost constraint.

## Components

### 1. Build/release pipeline — `.github/workflows/build-daemon.yml`

The Nuitka build step is unchanged: same flags, same `dist/hots-analytics-daemon.exe`
output. `bump_version`'s auto patch-bump-and-tag job is unchanged.

Two new steps replace the current `softprops/action-gh-release@v2` "Publish
GitHub Release" step:

```bash
# Requires the .NET SDK on the runner (windows-latest ships one; verify at
# implementation time rather than assuming a specific pinned version).
dotnet tool install -g vpk

vpk pack \
  --packId hots-analytics-daemon \
  --packVersion "${{ steps.version.outputs.version }}" \
  --packDir dist \
  --mainExe hots-analytics-daemon.exe \
  --packTitle "HotS Analytics Daemon" \
  --icon assets/app-icon.ico

vpk upload github \
  --repoUrl https://github.com/aifedespaix/hots-stats \
  --token "${{ secrets.GITHUB_TOKEN }}" \
  --publish \
  --tag "${{ needs.bump_version.outputs.tag || github.ref_name }}"
```

This produces, per release: `hots-analytics-daemon-Setup.exe` (installer),
versioned full/delta `.nupkg` update packages, a portable zip, and Velopack's
own release metadata — all uploaded directly to the same GitHub Release the
`bump_version` job's tag already points at. `vpk` manages release creation
itself, so the existing `action-gh-release` step is removed rather than kept
alongside it.

The existing "Smoke test the executable" step (`./dist/...exe --help`) is
unchanged — it exercises the same raw Nuitka binary, which `vpk pack` only
wraps, not rebuilds.

**Open item for implementation:** confirm the exact `dotnet` SDK availability/version
on `windows-latest` and pin `vpk`'s own version explicitly (`dotnet tool
install -g vpk --version X.Y.Z`) rather than always-latest, consistent with
this repo's existing "pin exact versions" convention elsewhere (e.g. Nuitka's
`--mingw64` toolchain pinning rationale in the same workflow file).

### 2. Daemon runtime — `daemon-python/src/updater.py`

Removed entirely: `_RELAUNCH_SCRIPT`, `_render_relaunch_script`,
`_powershell_diagnostics`, the custom subprocess/relaunch/liveness-check logic
inside `apply_update_and_exit`, `_DETACHED_PROCESS`/`_CREATE_NEW_PROCESS_GROUP`,
`_RELAUNCH_LIVENESS_CHECK_SECONDS`. The exe-copying half of
`stage_manual_fallback`/`manual_fallback_exe_path` is removed; `cleanup_stale_downloads`
is removed (Velopack manages its own download/apply staging directory).

Kept, with their internals rewired to the Velopack SDK instead of raw GitHub
API calls + custom file operations: `AvailableUpdate`, `UpdatePhase`,
`UpdateStatus`, `UpdateStatusTracker` (the state machine the tray UI reads —
its public shape does not change, only what feeds it), `watch_for_updates`
(same 6-hour cadence), `perform_update` (same check → download → apply outer
shape), `release_page_url`, `update_log_file_path`,
`read_last_update_log_lines`, `_append_update_log_line`,
`manual_fallback_message` (reworded to point at the installer instead of a
locally-staged file — see "Error handling").

New:

```python
import velopack

_manager = velopack.UpdateManager(
    velopack.sources.GithubSource("https://github.com/aifedespaix/hots-stats", None, False)
)

def check_for_update(current_version: str = APP_VERSION) -> AvailableUpdate | None:
    info = _manager.check_for_updates()
    ...  # adapt into the existing AvailableUpdate shape

def perform_update(update: AvailableUpdate, status: UpdateStatusTracker) -> bool:
    ...
    _manager.download_updates(info, progress_callback=...)
    _manager.apply_updates_and_restart(info)
```

**Open item for implementation:** the exact Python-binding name/signature for
a GitHub-Releases update source (`velopack.sources.GithubSource` above is the
expected shape by analogy with the C# `GithubSource` and the documented
`HttpSource(url)` binding, but was not directly confirmed in the Python SDK
reference during design) — confirm against the installed package's actual
API before writing code, not by assumption.

**Open item for implementation:** Velopack's C# integration requires an early
startup hook (`VelopackApp.Build().Run()`) to handle special lifecycle
invocations (first-run-after-install, post-update, uninstall) that the
installer/updater launches the app with. Confirm the Python SDK's equivalent
(likely on `UpdateManager` or a module-level function) and wire it into
`run.py`/`src/main.py` before the rest of startup runs — do not skip this
investigation and assume it is unnecessary.

### 3. `daemon-python/src/autostart.py`

The Windows Run-key autostart entry must point at Velopack's stable managed
install path (`%LocalAppData%\hots-analytics-daemon\current\hots-analytics-daemon.exe`,
exact layout to be confirmed against `vpk`'s actual output — do not hardcode
without checking) rather than wherever the raw `.exe` happened to be placed
under the old model. Velopack's own installer is expected to register
autostart itself in the common case (many Velopack apps rely on this) — this
component's job is: (a) confirm whether Velopack's Setup.exe already handles
autostart registration such that this file's existing logic becomes
redundant, and (b) if not, or if this project wants finer control (e.g. the
existing "enable/disable draft feature" style toggle in settings), update the
registered path.

### 4. `daemon-python/src/config.py`

No schema change expected. `installed_exe_path()` (used today to know "where
am I running from," relevant to both the old relaunch logic and any
path-dependent behavior) should be re-examined once Velopack's own
`UpdateManager.get_current_version()` / locator APIs are confirmed to
duplicate or replace what this function computes today.

## Data flow

1. CI builds the Nuitka `.exe` (unchanged).
2. `vpk pack` wraps it into a versioned release package + installer.
3. `vpk upload github --publish` publishes both to the same GitHub Release
   the version-bump tag already creates.
4. The running daemon's `watch_for_updates` loop (6h cadence, unchanged)
   calls `UpdateManager.check_for_updates()`.
5. If a newer version exists, `download_updates()` fetches the versioned
   package (delta when possible) into Velopack's own managed directory — not
   the app's own running directory.
6. `apply_updates_and_restart()` hands off to Velopack's bundled `Update.exe`,
   which performs an atomic install-directory swap and relaunches the app.
   This is the step that no longer races a locked/scanned file, because it
   never touches the currently-running process's own files in place.

## Migration for the existing (pre-Velopack) install base

Existing installs have no installer, an arbitrary install location, and an
autostart entry pointing at it. Their current `updater.py` looks for a
release asset named exactly `hots-analytics-daemon.exe` (via `_ASSET_NAME`).

**One transitional release** publishes both the legacy raw `.exe` (under the
same asset name, so the *existing, currently-working-when-not-blocked*
update mechanism still finds and downloads it exactly as before) and the new
Velopack packages. This transitional build's `updater.py` is a one-time
shim: on startup, it detects it is not running from a Velopack-managed
directory, downloads the current release's `Setup.exe`, launches it silently,
records "migration complete" in local config so it never repeats this step
even if somehow launched again from the old location, then exits. From that
point on, the Velopack-managed copy owns all future updates via the new
mechanism described above.

**Open item for implementation:** confirm `vpk`'s installer supports a silent
(unattended, no UI) install flag suitable for being launched non-interactively
by the old daemon — do not assume a specific flag name without checking the
installer's actual CLI/behavior.

A user whose old daemon's update mechanism is permanently blocked (the exact
problem this redesign exists to fix) will not receive this transitional
release either, and stays on their current version until they reinstall
manually — this is an accepted, unavoidable limitation of migrating via the
same channel that is sometimes broken; it is not meaningfully worse than
their current state.

## Error handling

`UpdateStatusTracker`'s error state and next-6h-cycle retry behavior is
unchanged in spirit — `check_for_updates()`/`download_updates()` failures
(network, GitHub unreachable) are surfaced the same way. If
`apply_updates_and_restart()` itself fails, `manual_fallback_message` is
reworded to point the user at `release_page_url()` to download and run
`hots-analytics-daemon-Setup.exe` manually — simpler messaging than today's
"replace this file by hand" instruction, since running an installer is a more
foolproof manual recovery path for an end user than a manual file swap.

## Testing

- Unit-testable as today: `UpdateStatusTracker`'s state transitions
  (`test_updater.py`, largely reusable), the wiring around `UpdateManager`
  calls with the SDK mocked.
- New CI job: run `vpk pack` (without `--publish`) on pull requests touching
  `daemon-python/` to catch packaging breakage before merge, without
  publishing anything.
- Not verifiable by automated tests, by nature of the problem being fixed:
  whether a real Windows machine with real, varied antivirus configurations
  actually applies an update without being blocked. This can only be
  observed post-rollout via the existing update log
  (`update_log_file_path`/`read_last_update_log_lines`) and user reports —
  the same visibility mechanism that surfaced the original problem.

## Open items to resolve during implementation (not blocking design approval)

These are flagged throughout above; collected here for visibility:

1. Exact Python SDK binding for a GitHub Releases update source.
2. Python equivalent of the C# `VelopackApp.Build().Run()` startup hook.
3. `vpk`'s actual managed install directory layout (for `autostart.py`).
4. Whether Velopack's installer already registers autostart, making part of
   `autostart.py` redundant.
5. `vpk`'s exact silent/unattended install flag, for the migration shim.
6. Pinned `vpk` CLI version for the CI workflow.

None of these change the shape of this design — they are implementation-time
verifications, not open design decisions.
