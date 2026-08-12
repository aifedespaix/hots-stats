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

The packaged `.exe` (see `.github/workflows/build-daemon.yml`) needs no
setup: double-clicking it opens the settings window the first time, then
adds a tray icon. Configuration lives in `%APPDATA%\hots-analytics\config.json`:

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

**Where it downloads to, and how the replace/relaunch works:** the new
build is streamed to `%TEMP%\hots-analytics-updates\` (`updater.downloads_dir`).
Once complete, this process writes a small PowerShell script to a temp
`.ps1` file and hands off to it (detached, hidden window), then exits
immediately (a running `.exe` can't overwrite or rename itself, and under
Nuitka's `--onefile` packaging the running process may well be executing
from an ephemeral self-extracted copy rather than the installed path
anyway). That script: waits for this process's PID to fully exit, copies
the downloaded build over the *installed* `.exe`
(`updater.installed_exe_path()` — see below), deletes the downloaded copy
and itself, and starts the installed `.exe` again — no separate "second
exe" or bundled library needed, PowerShell already does this handoff
reliably and ships with Windows. There is no old version left lying around
afterward: the installed `.exe` is replaced *in place* (one file, one
path), and `%TEMP%\hots-analytics-updates\` is swept clean of anything left
over from an interrupted/superseded download the next time the daemon
starts (`cleanup_stale_downloads`, called from `watch_for_updates`).

Both the copy and the relaunch are retried a few times (a just-exited
process, or real-time antivirus scanning an unfamiliar unsigned `.exe`, can
each hold a brief lock) — and if replacing the installed `.exe` still fails
after every retry, the script falls back to relaunching the *previous*
version instead of leaving the app closed. A failed update always degrades
back to "still running the old version," never to "gone until someone
notices and manually reruns an old installer" — and since a failed copy
means the installed `.exe` was never actually replaced, that's also what
stops a persistent failure from repeating the exact same "found this
update, downloaded it, then vanished" cycle on every subsequent launch.

Every step of that handoff is logged, with a timestamp, to
`%APPDATA%\hots-analytics\update.log` (`updater.update_log_file_path`) —
since the script runs after this process has already exited, that log is
the only record of what happened if a copy or relaunch step fails. It's one
click away from the settings window's Update tab (**Voir le journal**). The
Python side writes to the same log too (`updater._append_update_log_line`),
before and immediately after handing off to the script — not just the
script itself — so an attempt that never got far enough for the script to
log anything on its own (killed before its first `Log` call, or
`powershell.exe` failing to launch at all) still leaves a trace instead of
the log staying completely empty.

**This process never exits on faith that the handoff will work.**
`Popen` returning successfully only means Windows *accepted* the request to
start the relaunch script — not that it kept running. Before this process
commits to `os._exit(0)`, `apply_update_and_exit` briefly confirms the
script process is still alive; if it isn't (or `powershell.exe` couldn't be
launched at all), the update is aborted instead — logged, the Update tab
shows a clear error, and **the current process keeps running normally**,
retrying on the next scheduled cycle. This closes the failure mode that
used to look like "it downloads, then the app just closes and never comes
back, with nothing anywhere on disk to explain why": a script this shape —
unsigned, hidden, execution-policy-bypassing, copying one unsigned `.exe`
over another and relaunching it — is exactly what real-time antivirus and
other endpoint protection are built to kill on sight, and until this check
existed, this process had already unconditionally exited by the time that
happened, so there was nothing left running to notice or recover.

**Unsigned binary / SmartScreen:** this build isn't code-signed (no
certificate has been purchased for it), so the *first* time a
browser-downloaded copy is run, Windows SmartScreen shows its "Windows
protected your PC" prompt — click "Informations complémentaires" then
"Exécuter quand même". That's a one-time, per-download-hash check from
Explorer's own Attachment Execution Service and can't be suppressed from
inside the app without an actual signing certificate. The new build itself
is fetched with `requests`, so it never picks up a Mark-of-the-Web the way
a browser download does — but `Start-Process` with a bare `-FilePath` still
goes through the same ShellExecute path Explorer uses, so if the *installed*
`.exe` already carries a Mark-of-the-Web (likely, since that's usually
wherever the user's browser first put it), the same SmartScreen prompt
could otherwise reappear on every self-relaunch and block it silently with
nobody there to click "Run anyway." The relaunch script strips it
(`Unblock-File`) right after copying the new build into place, so self-updates
relaunch silently regardless of where the installed `.exe` lives. (Real-time
antivirus heuristics are a separate mechanism from SmartScreen and could in
principle still flag an unfamiliar unsigned binary; the retrying Copy-Item/
Start-Process + `update.log` above exist partly to make that failure mode
visible — and recoverable — instead of silent if it ever happens. The
durable fix is buying a code-signing certificate, which is a
purchase/verification decision outside what this repo's code can do on its
own.)

The self-replace step (and the "Lancer au démarrage de Windows" registry
entry) resolve the actual installed `.exe` via `updater.installed_exe_path()`
rather than `sys.executable`: under Nuitka's `--onefile` packaging,
`sys.executable` points into the ephemeral per-run extraction folder, which
is deleted the moment the process exits — pointing either of those at it
would silently target a file that's already gone.

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
`vX.Y.Z`, builds the `.exe`, and publishes it as a GitHub Release — see
`.github/workflows/build-daemon.yml`. There's nothing manual to do; just
merge the change.

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
  ocr.py            Reads a player-name crop via RapidOCR
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
