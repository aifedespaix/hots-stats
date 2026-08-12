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
gets synced too, not just future games.

From the tray icon: **Ouvrir les paramètres** reopens the settings window
(pre-filled, live connection/token status, current games-recorded count,
daemon + API versions, plus live found/synced/currently-syncing counters and
the last sync error, if any, while the daemon is running); saving restarts
the background watcher with the new config. A **Debug** button opens a
read-only report of every replay currently in an error state (file path,
whether the source file still exists, the error, and its full traceback),
with a **Copier** button to grab it in one click for a bug report. **Quitter**
stops the watcher thread cleanly before exiting.

On Windows, a **"Lancer au démarrage de Windows"** checkbox registers (or
unregisters) the built `.exe` under the current user's Run key
(`HKCU\...\CurrentVersion\Run`, `src/autostart.py`) — no admin rights
needed. Since the daemon only opens the settings window when it has no
config yet (see `app.run_app`), a configured daemon launched this way starts
straight into the tray and syncs in the background, no window shown.

## Live draft capture

While in a Heroes of the Storm draft, pressing the configured global hotkey
(default **Ctrl+Maj+D**, rebindable in the settings window) screenshots the
game window, crops the 10 player-name regions off the draft screen
(`src/draft_layout.py`), reads each one with OCR (`src/ocr.py`, RapidOCR),
and POSTs the result to `/draft/snapshot` (`src/draft_capture.py`) so it
shows up live on the dashboard's **Live Draft** page. The hotkey is a global
low-level keyboard hook (`src/hotkey.py`, the `keyboard` package), so it
fires even while the game has focus, windowed or "Fullscreen (Windowed)"
(HotS's own default display mode); true exclusive fullscreen bypasses the
screenshot the same way it bypasses everything else GDI/DWM-based. A name
OCR can't read confidently is sent as `"unreadable"` rather than guessed at,
so one bad crop degrades that one slot instead of the whole capture. The
feature can be turned off entirely from the settings window, which is also
where the hotkey field lives -- rebinding takes effect on save, no restart
needed.

### Debugging a capture

Every hotkey press writes its debug artifacts under
`%APPDATA%\hots-analytics\live-draft\` (`src/draft_debug.py`), regardless of
whether OCR or the API submit succeeds:

- `captures\<timestamp>\` — one folder per capture, holding the full
  screenshot, each team's pre- and post-rotation strip crop
  (`left-strip.png` / `left-rotated.png`, and the same for `right-`), each of
  the 10 player-name crops (`left-slot-1.png` … `right-slot-5.png`, skipped
  when a slot came out empty), and `crop-info.json` — the relative and pixel
  box for every crop plus what OCR read from it and at what confidence. Only
  the most recent 20 captures are kept.
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
found, a tray notification announces it and the settings window's **Mise à
jour automatique du daemon** checkbox decides what happens next:

- **Checked (default):** it's downloaded and the app relaunches itself as
  the new version automatically — no user action needed beyond
  acknowledging the notification.
- **Unchecked:** the update is left pending; a **Mettre à jour maintenant**
  button appears in the settings window (reopened from the tray) to install
  it on demand.

Either way, the settings window shows live progress (checking / downloading
with a percentage / installing) while the daemon is running — see
`UpdateStatusTracker` in `src/updater.py` and `_refresh_update_status` in
`gui.py`. This all only runs in the compiled build; `python -m src.main` in
dev never self-updates.

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
  gui.py        tkinter settings window (first run / reopened from the tray)
  tray.py       pystray tray icon and menu
  config.py     Reads/writes %APPDATA%\hots-analytics\config.json
  watcher.py    Watches the replays folder (watchdog), stoppable via threading.Event
  ingestion.py  Parses + uploads one replay; shared by --resync and the tray daemon
  parser.py     .StormReplay -> API payload
  hotkey.py         Global keyboard shortcut (the `keyboard` package) that triggers a draft capture
  screen_capture.py Finds the HotS window and screenshots its client area (win32gui + mss)
  draft_layout.py   Crops the 10 player-name regions off a draft-screen screenshot
  ocr.py            Reads a player-name crop via RapidOCR
  draft_capture.py  Wires the above together and POSTs the result to /draft/snapshot
  draft_debug.py    Saves every capture's crops + a crop-info.json under %APPDATA%\hots-analytics\live-draft\, and mirrors WARNING+ logs from the draft modules to live-draft.log
  api_client.py HTTP client (retrying, for real ingestion) + light ping/summary/version helpers (for the settings UI)
  sync_state.py SQLite-backed "already synced" cache + per-replay error log, keyed by content hash
  status.py     Thread-safe found/synced/currently-syncing/last-error snapshot, for the settings window
  updater.py    Checks GitHub Releases for a newer build and self-updates when running as the compiled .exe
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
