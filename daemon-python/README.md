# HotS Analytics daemon

Windows client that watches your Heroes of the Storm replays folder, parses
new `.StormReplay` files, and uploads the resulting stats to the HotS
Analytics API.

## Setup

```
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
```

Configure the daemon via environment variables, or a JSON file at
`%APPDATA%\hots-analytics\config.json`:

```json
{
  "apiBaseUrl": "https://api.hots-analytics.example.com",
  "accessToken": "hots_pat_...",
  "replaysDir": "C:\\Users\\you\\Documents\\Heroes of the Storm\\Accounts\\...\\Replays\\Multiplayer"
}
```

Generate `accessToken` from the dashboard's Settings page. `replaysDir` is
optional — if omitted, the daemon looks for the standard HotS replay folder
under your Documents.

## Usage

```
python -m src.main              # watch for new replays and upload them
python -m src.main --resync     # upload every replay already on disk, then exit
python -m src.main --resync D:\Replays   # resync a specific folder instead
```

`--resync` is safe to re-run: the API upserts by replay hash, so already
up-to-date matches are skipped rather than duplicated.

## Tests

```
pytest
```
