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

## Auto-update

The packaged `.exe` checks GitHub Releases for a newer daemon build shortly
after startup and every few hours after that (`src/updater.py`). If one is
found, a tray notification announces it, then it's downloaded and the app
relaunches itself as the new version — no user action needed beyond
acknowledging the notification. This only runs in the compiled build;
`python -m src.main` in dev never self-updates.

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
  api_client.py HTTP client (retrying, for real ingestion) + light ping/summary/version helpers (for the settings UI)
  sync_state.py SQLite-backed "already synced" cache + per-replay error log, keyed by content hash
  status.py     Thread-safe found/synced/currently-syncing/last-error snapshot, for the settings window
  updater.py    Checks GitHub Releases for a newer build and self-updates when running as the compiled .exe
  autostart.py  Registers/unregisters the .exe in the Windows Run key ("launch at startup")
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
