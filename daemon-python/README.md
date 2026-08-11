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
plus live found/synced/currently-syncing counters and the last sync error,
if any, while the daemon is running); saving restarts the background
watcher with the new config. **Quitter** stops the watcher thread cleanly
before exiting.

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
  api_client.py HTTP client (retrying, for real ingestion) + light ping/summary helpers (for the settings UI)
  status.py     Thread-safe found/synced/currently-syncing/last-error snapshot, for the settings window
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
