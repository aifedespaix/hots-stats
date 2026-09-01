# HotS Analytics daemon

Windows client that watches your Heroes of the Storm replays folder, parses
new `.StormReplay` files, and uploads the resulting stats to the HotS
Analytics API. Ships as a tray app: a settings window on first run, then a
system tray icon with the sync running quietly in the background.

## Setup

```
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
```

End users don't need any of that: the GitHub Release carries
`hots-analytics-daemon-Setup.exe` (built by
`.github/workflows/build-daemon.yml`), a Velopack installer that installs
the app into `%LocalAppData%\hots-analytics-daemon\` and launches it — the
settings window opens the first time, then a tray icon. Configuration lives
in `%APPDATA%\hots-analytics\config.json`, outside the install directory, so
updates never touch it:

```json
{
  "apiBaseUrl": "https://api-hots-stats.aifedespaix.com",
  "accessToken": "hots_pat_...",
  "replaysDir": "C:\\Users\\you\\Documents\\Heroes of the Storm\\Accounts\\...\\Replays\\Multiplayer"
}
```

Generate `accessToken` from the dashboard's Settings page — the settings
window links straight to it. `replaysDir` is autodetected under your
Documents folder if left unset. Environment variables (`HOTS_API_BASE_URL`,
`HOTS_ACCESS_TOKEN`, `HOTS_REPLAYS_DIR`) take priority over the file, for
headless/CI use.

## Usage

```
python -m src.main              # tray app: settings window on first run, then tray icon + background sync
python -m src.main --resync     # headless: upload every replay already on disk, then exit
python -m src.main --resync D:\Replays   # resync a specific folder instead
```

`--resync` is safe to re-run: the API upserts by replay hash, so already
up-to-date matches are skipped rather than duplicated.

On start (or after saving new settings), the daemon uploads every replay
already sitting in the replays folder before it starts watching for new
ones — a folder full of replays from before the daemon was ever configured
gets synced too, not just future games. New replays are normally picked up
the instant they're written, via a filesystem event (`watchdog`); as a
fallback, the replays folder is also re-scanned every 60 seconds for
anything that event-based detection missed (e.g. a dropped Windows
`ReadDirectoryChangesW` notification, or an antivirus/cloud-sync tool
briefly locking the folder) — so a game played while the daemon is running
gets synced within a minute even if its creation event never arrived.

From the tray icon: **Ouvrir les paramètres** reopens the settings window;
saving restarts the background watcher with the new config. **Quitter**
stops the watcher thread cleanly before exiting.

The settings window is a `ttk.Notebook` with one tab per concern, so it
stays readable as the feature set grows instead of one long scroll:

- **Config** — API URL, access token (with a link to generate/manage it),
  replays folder (autodetected, or browse manually), and the **"Lancer au
  démarrage de Windows"** checkbox, which registers (or unregisters) the
  built `.exe` under the current user's Run key
  (`HKCU\...\CurrentVersion\Run`, `src/autostart.py`) — no admin rights
  needed. Since the daemon only opens the settings window when it has no
  config yet (see `app.run_app`), a configured daemon launched this way
  starts straight into the tray and syncs in the background, no window
  shown.
- **Draft Live** — the live-draft capture toggle and its global hotkey; see
  [Live draft capture](#live-draft-capture) below.
- **Synchronisation** — daemon/API versions, games-recorded count, and
  (while the daemon is running) live found/synced/currently-syncing
  counters, a progress bar, the last sync error if any, and a **Debug**
  button: a read-only report of every replay currently in an error state
  (file path, whether the source file still exists, the error, and its full
  traceback), with a **Copier** button to grab it in one click for a bug
  report.
- **Update** — see [Auto-update](#auto-update) below.

A **📁 Dossier de données** button in the window's header (visible from
every tab) opens `%APPDATA%\hots-analytics\` directly in Explorer —
`config.json`, `sync_state.db`, `update.log`, the crop config, and the
live-draft debug folder all live there.

The live-draft hotkey field doesn't take typed text: click **Modifier…**
and press the combo you want (Échap to cancel). It's captured with
`keyboard.read_hotkey()` (`src/hotkey.py` already depends on the `keyboard`
package for the global hook itself) and comes back pre-formatted in exactly
the shape the hook needs — no risk of a typo like `"ctrl+shft+d"` silently
failing to register.

## Live draft capture

While in a Heroes of the Storm draft, pressing the configured global hotkey
(default **Ctrl+Maj+D**, rebindable in the settings window's Draft Live tab)
screenshots the game window, crops the 10 player-name regions off the draft
screen (`src/draft_layout.py`), reads each one with OCR (`src/ocr.py`,
RapidOCR), and POSTs the result to `/draft/snapshot` (`src/draft_capture.py`)
so it shows up live on the dashboard's **Live Draft** page. The hotkey is a
global low-level keyboard hook (`src/hotkey.py`, the `keyboard` package), so
it fires even while the game has focus, windowed or "Fullscreen (Windowed)"
(HotS's own default display mode); true exclusive fullscreen bypasses the
screenshot the same way it bypasses everything else GDI/DWM-based. A name
OCR can't read confidently is sent as `"unreadable"` rather than guessed at,
so one bad crop degrades that one slot instead of the whole capture. The
feature can be turned off entirely from the settings window — rebinding
takes effect on save, no restart needed.

While the settings window is open, its Draft Live tab shows a short
"Capture en cours… / Envoi de la capture…" progress indicator while a
hotkey press is being processed (`draft_capture.DraftCaptureCoordinator`,
polled by `gui.py`'s `_refresh_draft_capture_status`) — there was
previously no feedback at all beyond whatever eventually shows up on the
dashboard. A capture that fails (no game window found, a screenshot/crop
error) shows the reason in red instead of just being logged — see
*Troubleshooting* below for what that fixes. Pressing the hotkey again
before a capture has finished doesn't queue a second one behind it: the
same coordinator hands the newer press a fresh generation number, and the
older run checks at its two natural checkpoints (right after
screenshotting, and right before committing its result) whether it's still
the current one -- if not, it gives up instead of finishing and possibly
submitting stale data after (or racing with) the fresher capture. Python
can't forcibly kill a running thread, so this is cooperative rather than a
hard cancel, but since every checkpoint bails *before* writing anything,
the practical effect is the one that matters: a superseded capture never
wins over a newer one.

**OCR accuracy:** each player-name crop is already known to contain
exactly one line of text and nothing else (that's the entire point of
`draft_layout.py`'s hand-tuned boxes) — but RapidOCR's default pipeline
runs a *detection* stage first, meant for finding text within an arbitrary
photo or document, before ever reading it. On a crop this small and this
tightly bound, detection frequently fails to find a box at all, which
silently discards the crop before the model that actually reads characters
ever runs — a generic "throw the whole image at an OCR tool" comparison
looks nothing like this, since a full screenshot gives that stage plenty to
detect. `ocr.py`'s `read_player_name` calls RapidOCR with `use_det=False`
to skip straight to recognition (the step that already knows how to read a
single line of text), upscales each crop 3x (Lanczos) beforehand so that
recognition step has more effective detail to work with than a native
~30px-tall crop provides, and pads it afterwards with a border matching its
own background color — the crop's natural width:height ratio otherwise
exceeds what the recognition model was trained on, which measurably hurt
accuracy on its own. All three are standard techniques for exactly this
"already-isolated single line of text" shape of problem.

Two recognition models run per crop, not RapidOCR's bundled default alone:
a second one (`en_PP-OCRv5_rec_mobile.onnx`, bundled under `src/models/`)
trained specifically on Latin-script text. HotS display names are almost
always Latin-script (this app's UI is French), and the bundled default's
6000+-character dictionary spends most of its capacity on Chinese glyphs —
which measurably hurt it on exactly what matters most here: telling a
capital "I" apart from "L"/"1", and reading accented letters (the game's
own "I.A. Élite" bot label was the clearest reproduction — the default
model read it as "L.A.Elite" or similar almost every time). The bundled
default keeps running alongside it as a fallback, so a genuinely non-Latin
pseudo (Cyrillic, CJK — scripts the Latin model's dictionary cannot
represent at all) still gets read using whatever support already existed
before this file started preferring the Latin model; see `ocr.py`'s module
docstring and `_choose_reading` for exactly how the two engines' readings
are reconciled.

### Troubleshooting: the hotkey doesn't seem to do anything

The hook is registered once from `app._DaemonRunner.start()` at daemon
startup (and again whenever the settings window saves a config change) --
it is *not* tied to the settings window being open, and closing that
window never unregisters it. If the hotkey genuinely isn't doing
anything at all -- not even a brief "Capture en cours…" flash in the Draft
Live tab, not a line in `live-draft.log` -- the keystroke isn't reaching
the hook in the first place, and the most common cause of that on Windows
is a **privilege mismatch**: `keyboard`'s global hook is a low-level
`SetWindowsHookEx(WH_KEYBOARD_LL, ...)` hook, and Windows' UIPI
(User Interface Privilege Isolation) blocks a *non-elevated* hook from
ever receiving keystrokes while a window running *elevated* ("Run as
administrator") has focus -- silently, with no error on either side. If
Heroes of the Storm, its Battle.net launcher, or an overlay is set to
always run as administrator (check its shortcut/exe's Compatibility tab)
while the daemon itself is not, this is almost certainly why: either stop
running the game elevated, or run the daemon elevated too (in which case
it also needs to be launched that way for the "Lancer au démarrage de
Windows" autostart entry, or the same mismatch reappears on every login).

If instead a capture clearly *does* start (the progress indicator
appears, or `live-draft.log` gets a new line) but never finishes/nothing
shows up on the dashboard, that's a different failure — most commonly the
game window not being found (see `screen_capture.find_game_window`, and
the exclusive-fullscreen limitation above). That case is no longer
silent: the Draft Live tab shows the specific reason in red instead of
only logging it, so what used to look identical to "the hotkey did
nothing" is now distinguishable from it. `find_game_window` also now
prefers whichever matching window currently has focus when more than one
window's title happens to match "Heroes of the Storm" (a browser tab, an
unrelated app) -- previously it took an arbitrary one, which could
silently screenshot the wrong thing.

### Crop tuning

The 10 player-name crop boxes (plus the left/right team-split crop and
rotation angle) are defined in `src/draft_layout.py` as relative (0.0-1.0)
fractions of the screenshot — resolution-independent for any capture at the
same aspect ratio. Those constants are also the *defaults*: the values
actually used at capture time are read from
`%APPDATA%\hots-analytics\draft-crop-config.json`
(`load_team_layouts`/`ensure_crop_config_file`), seeded from the defaults the
first time the daemon runs. Editing that file and pressing the hotkey again
picks up the change immediately, no rebuild needed — useful for
recalibrating against a different UI scale without waiting on a release.

### Debugging a capture

Every hotkey press writes its debug artifacts under
`%APPDATA%\hots-analytics\live-draft\` (`src/draft_debug.py`), regardless of
whether OCR or the API submit succeeds:

- `captures\latest\` — the full screenshot, each team's pre- and
  post-rotation strip crop (`left-strip.png` / `left-rotated.png`, and the
  same for `right-`), each of the 10 player-name crops (`left-slot-1.png` …
  `right-slot-5.png`, skipped when a slot came out empty), and
  `crop-info.json` — the relative and pixel box for every crop plus what OCR
  read from it and at what confidence. Only the *most recent* capture is
  kept (the folder is cleared and rewritten on every hotkey press) — this is
  a live debugging aid, not a history, so it doesn't slowly grow
  `%APPDATA%` the way keeping every past capture would.
- `live-draft.log` — every `WARNING`+ record from `draft_capture.py`,
  `draft_layout.py`, `ocr.py` and `screen_capture.py`, so a failed capture is
  on disk even if nobody was watching the console when it happened.

## Sync state

Which replays are already synced (and which failed) is tracked in
`%APPDATA%\hots-analytics\sync_state.db`, a small SQLite database
(`src/sync_state.py`) rather than a flat JSON file — replays can number in
the thousands, and a per-replay write there would mean rewriting the whole
file every time. Per replay it stores: content hash, file path, sync status,
the parser/API version it was last synced against, when, its match id, and
—for a failed replay— the error message and full traceback (this is what
backs the settings window's Debug button).

On every daemon start, `app._sync_api_version` asks the API its version via
`GET /ingest/version`. The API — not the daemon — decides when previously
synced replays need to be resent: it reports a `minParserVersion`, and any
locally-synced replay recorded below that version is dropped from the
"already synced" cache (`SyncState.invalidate_stale`) so it's reparsed and
re-uploaded on this run; everything already at or above it is left alone.
This call is best-effort — if the API can't be reached at startup, existing
sync state is kept as-is rather than guessed at. The startup scan also
refreshes, per tracked replay, whether its source file is still present on
disk (`SyncState.refresh_file_existence`), so a moved/deleted replay shows
up as such in the Debug report instead of just going stale silently.

The initial sync pass (`app._run_sync_loop`) uploads every replay on disk
strictly one at a time, on a single background thread, so one replay's
failure must never take the rest of the folder down with it — `ingestion.
ingest_file` is guaranteed to never raise: anything it doesn't specifically
recognize (a malformed API response, a local sqlite hiccup) still falls
through to a catch-all that records it as an ordinary ingestion error and
lets the loop move on to the next file. Before this guarantee was
enforced end-to-end, an exception type none of the specific handlers
anticipated would silently kill the watcher thread mid-run — the settings
window kept showing "en cours de synchronisation : <this one file>" forever,
with everything after it in the folder never even attempted and no error
displayed anywhere, since the code path that would have shown one
(`StatusTracker.finish_syncing`) was never reached.

The same `GET /ingest/version` response also carries `dataResetAt`: set
once an account uses **Réinitialiser mes données** in the web app's
Settings page (Zone dangereuse), which wipes every match that account
uploaded server-side. When `_sync_api_version` sees this value change from
what it last saw (`SyncState.wipe_all`), it drops the *entire* local sync
cache — not just entries below some version — since the server has nothing
left to compare against; every `.StormReplay` still on disk gets reparsed
and re-uploaded from scratch on this run. Only replays whose file has since
been deleted from disk are lost for good — the button warns about this in
the UI.

## Auto-update

The packaged `.exe` checks GitHub Releases for a newer daemon build shortly
after startup and every few hours after that (`src/updater.py`). If one is
found, the settings window's **Mise à jour automatique** checkbox (Update
tab) decides what happens next:

- **Checked (default):** it's downloaded and the app relaunches itself as
  the new version automatically.
- **Unchecked:** the update is left pending until installed on demand (see
  below).

Either way this is never invisible: a tray balloon announces the find, and
— unless the settings window is already open, in which case its Update tab
already shows the same thing — a small always-on-top popup
(`run_update_progress_window` in `gui.py`) pops up on its own with live
download/install progress and stays up if something goes wrong, instead of
the only visible sign of an update being the app quietly vanishing for a
few seconds. The settings window's Update tab shows the same live phase
(checking / downloading with a percentage / installing) whenever it's open,
via `UpdateStatusTracker` (`src/updater.py`); its **Vérifier les mises à
jour** button runs a check on demand instead of waiting for the next
scheduled cycle — useful right after a release goes out. All of this only
runs in the compiled build; `python -m src.main` in dev never self-updates.

**How the install and the swap actually work:** updates are handled by
[Velopack](https://velopack.io/), not by any hand-rolled download-and-
overwrite logic in this repo. `src/updater.py` holds a
`velopack.UpdateManager` backed by a `GithubSource` pointed at this repo's
Releases; `check_for_updates()` compares the installed version against the
latest published package, `download_updates()` fetches it (reporting 0..100
progress, which `perform_update` converts to the 0..1 fraction the UI's
progress bar wants), and `apply_updates_and_restart()` hands off to
Velopack's own bundled `Update.exe`, which performs the swap and relaunches
the app. That last call never returns on success — the process is replaced.

**Install layout.** `hots-analytics-daemon-Setup.exe` installs into
`%LocalAppData%\hots-analytics-daemon\`. Inside it, Velopack keeps a
`current\` subdirectory holding the version actually being run, an
`Update.exe`, and — at the folder root — a small, version-independent *stub*
executable whose only job is to launch whatever is currently in `current\`.
An update replaces `current\` **wholesale**; the stub's path never changes.
That's why `updater.installed_exe_path()` returns the stub path rather than
`sys.executable`: anything that has to still be valid after the next update
(notably the "Lancer au démarrage de Windows" registry entry written by
`src/autostart.py`) must point at the stub. `sys.executable` is doubly
wrong here — under Nuitka's `--onefile` packaging it resolves to an
ephemeral per-run extraction folder that is deleted the moment the process
exits.

**Your data is not inside the install directory.** `config.json`,
`sync_state.db`, `update.log` and the live-draft folder all live under
`%APPDATA%\hots-analytics\`, which Velopack never touches — so an update
replacing `current\` cannot lose settings, sync state or logs.

**Nothing is invisible, and failures are recoverable.** Notable events
(update found, download failed, install failed) are appended with a
timestamp to `%APPDATA%\hots-analytics\update.log`
(`updater.update_log_file_path` / `_append_update_log_line`), one click away
from the settings window's Update tab (**Voir le journal**). If
`download_updates()` or `apply_updates_and_restart()` raises, the failure is
logged, the Update tab shows the error, **the daemon keeps running
normally**, and the next scheduled cycle retries. The error message
(`updater.manual_fallback_message`) points at the release page so the user
can download and run `hots-analytics-daemon-Setup.exe` by hand — running an
installer over an existing install is a far more foolproof manual recovery
than swapping files around.

**Why Velopack and not a script.** The previous mechanism copied a freshly
downloaded `.exe` over the running one via a generated, hidden,
execution-policy-bypassing PowerShell script — precisely the shape of thing
real-time antivirus is built to kill on sight regardless of intent, and when
it was killed the app had already exited with nothing left running to notice.
Velopack's `Update.exe` is a well-known, signed updater binary performing a
versioned directory swap instead, which is what actually changes the
endpoint-protection outcome.

**Unsigned binary / SmartScreen:** this build isn't code-signed (no
certificate has been purchased for it), so the *first* time a
browser-downloaded `Setup.exe` is run, Windows SmartScreen shows its
"Windows protected your PC" prompt — click "Informations complémentaires"
then "Exécuter quand même". That's a one-time, per-download-hash check from
Explorer's own Attachment Execution Service, unrelated to the update
mechanism itself, and it can't be suppressed from inside the app without an
actual signing certificate. Automatic updates go through `Update.exe` rather
than ShellExecute, so they don't re-prompt.

**One-time migration from the pre-Velopack install.** Builds released before
this change were a single raw `.exe` sitting wherever the user put it. The
transitional release ships a shim (`updater.is_running_from_legacy_install`
/ `migrate_to_velopack_install`, called from `main()` on the tray path only)
that notices it is running from outside `%LocalAppData%\hots-analytics-daemon\`,
downloads that release's `Setup.exe`, runs it silently, re-points the
autostart registry entry at the new stub, and records a
`.velopack-migrated` sentinel file next to `config.json` so it never repeats.
It is deliberately temporary code, marked as such in `updater.py`, to be
deleted once the old install base has moved over.

## Single instance

`src/single_instance.py` holds a named Windows mutex for the process's
lifetime. If the `.exe` is launched a second time (e.g. a double-click while
the tray icon is already running, or autostart racing a manual launch), the
new process detects the lock, shows a short "already running" dialog, and
exits immediately without touching the running instance's config, sync
state, or tray icon.

## Releases

Every push to `main` that touches `daemon-python`'s code (not just
`tests/`/`README.md`) is automatically released: CI bumps the patch version
in `pyproject.toml` + `constants.py`'s `APP_VERSION`, commits it, tags it
`vX.Y.Z`, builds the `.exe` with Nuitka, packages it with `vpk` (Velopack's
CLI) and publishes the result as a GitHub Release — see
`.github/workflows/build-daemon.yml`. There's nothing manual to do; just
merge the change.

What lands on a release is what `vpk` produces: the
`hots-analytics-daemon-Setup.exe` installer users download once, plus the
`.nupkg` update packages (a full one, and delta ones where applicable) that
`UpdateManager` consumes. `vpk pack` is given a *staged* directory holding
only the built `.exe` — never Nuitka's `dist/` directly, which also contains
its build intermediates (`run.build/`, `run.dist/`, `run.onefile-build/`)
and would balloon every package with hundreds of MB of junk. A pull request
touching `daemon-python/` runs the same build + `vpk pack` without any
publish step (the `pack-check` job), so packaging regressions fail at review
time rather than at release time.

The built executable is always named `hots-analytics-daemon.exe`, never
version-suffixed. The version lives only on the release (its git tag
`vX.Y.Z` and title `Daemon vX.Y.Z`) and inside Velopack's package manifest.
The name is `vpk pack`'s `--mainExe` and must stay identical across
versions — Velopack looks for exactly that name inside every package — and
it must match `_EXE_NAME` in `src/updater.py`, which derives the stable stub
path from it, alongside `--packId` / `_PACK_ID`.

## Architecture

```
src/
  main.py       CLI entrypoint: --resync (headless), or the tray app by default
  app.py        Wires first-run setup + tray icon + background daemon thread together
  gui.py        tkinter settings window (tabbed: Config/Draft Live/Synchronisation/Update) + the standalone update-progress popup
  tray.py       pystray tray icon and menu
  config.py     Reads/writes %APPDATA%\hots-analytics\config.json; open_config_folder/open_path for the "Dossier de données" button
  watcher.py    Watches the replays folder (watchdog) for new files, backed by a 60s fallback re-scan; stoppable via threading.Event
  ingestion.py  Parses + uploads one replay; shared by --resync and the tray daemon
  parser.py     .StormReplay -> API payload
  hotkey.py         Global keyboard shortcut (the `keyboard` package) that triggers a draft capture
  screen_capture.py Finds the HotS window and screenshots its client area (win32gui + mss)
  draft_layout.py   Crops the 10 player-name regions off a draft-screen screenshot; loads/seeds the appdata crop config
  ocr.py            Reads a player-name crop via two RapidOCR engines (bundled multilingual + a Latin-specialized one)
  models/           Bundled en_PP-OCRv5_rec_mobile.onnx (ocr.py's Latin-specialized recognition model)
  draft_capture.py  Wires the above together and POSTs the result to /draft/snapshot
  draft_debug.py    Saves the latest capture's crops + a crop-info.json under %APPDATA%\hots-analytics\live-draft\captures\latest\, and mirrors WARNING+ logs from the draft modules to live-draft.log
  api_client.py HTTP client (retrying, for real ingestion) + light ping/summary/version helpers (for the settings UI)
  sync_state.py SQLite-backed "already synced" cache + per-replay error log, keyed by content hash
  status.py     Thread-safe found/synced/currently-syncing/last-error snapshot, for the settings window
  updater.py    Checks GitHub Releases for a newer build and self-updates when running as the compiled .exe; logs the relaunch handoff to update.log
  autostart.py  Registers/unregisters the .exe in the Windows Run key ("launch at startup")
  single_instance.py  Named-mutex guard so a second launch of the .exe exits instead of running alongside the first
```

## Icon

The .exe's file icon and the system tray icon are both generated from the
web app's `apps/web/public/favicon.svg`. See `assets/generate_icons.py` for
how to regenerate them after the favicon changes (needs `cairosvg` +
`pillow`, not otherwise required to build the daemon).

## Protocol manifest

`src/_protocol_versions.py` lists every replay protocol build bundled by the
installed `heroprotocol` package. See `assets/generate_protocol_manifest.py`
for why `parser.py` needs this instead of calling `heroprotocol.versions`
directly, and regenerate it after bumping the `heroprotocol` dependency.

## Tests

```
pytest
```

Note: `gui.py` and `tray.py` need a display (tkinter/pystray) and aren't
exercised by the test suite, which runs headless in CI — their pure-logic
helpers (`config.py`, `urls.py`, `api_client.py`'s ping/summary functions)
are covered instead.
