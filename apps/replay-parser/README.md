# replay-parser

Internal-only Python microservice: turns a raw `.StormReplay` file into the
JSON payload `POST /ingest` expects. It exists for exactly one caller —
`apps/api`'s `POST /uploads` — so the web app's manual drag & drop upload
(`/upload`) can produce a match from a replay file without re-implementing
HotS's binary replay format in TypeScript. The Windows daemon (`daemon-python`)
still parses locally and never calls this service; this only covers uploads
made directly through the browser.

## Why a separate Python service instead of parsing in `apps/api`

`daemon-python/src/parser.py` (Blizzard's `heroprotocol` + `mpyq`, plus a lot
of HotS-specific event/stat/hero-resolution logic cross-checked against
several community parsers) is the only tested implementation of this format
in the codebase. Porting it to TypeScript would mean maintaining two replay
parsers that must always agree, forever. Instead, `daemon_core/` in this
service's Docker image is `daemon-python/src` copied in **verbatim** at build
time (see `Dockerfile`) — same `parser.py`, same `constants.py` (map/hero
tables, `PARSER_VERSION`), same `_protocol_versions.py`. Nothing here forks
that logic. `parser.py` itself has zero Windows-only dependencies (those live
in `daemon-python`'s tray/OCR/hotkey modules, e.g. `pystray`, `pywin32`,
`rapidocr-onnxruntime` — none of which this image installs or imports), so it
runs fine in a plain Linux container.

## Deployment: internal network only, no public domain needed

This service is wired into `docker-compose.backend.yml` alongside `postgres`
and `api`, reachable **only** from `api` at `http://replay-parser:8090` over
the compose-internal network — it has no published port and needs no domain,
TLS cert, or reverse-proxy entry in Dokploy. `api` is still the only public
surface; this stays a private implementation detail behind `POST /uploads`.

If a future need ever requires reaching this service directly from outside
the compose network (e.g. running it as a separately scaled Dokploy app),
that's a deliberate infra change worth revisiting explicitly — don't add a
public domain for it by default.

## API

- `GET /health` — liveness probe.
- `POST /parse` — `multipart/form-data`, one file under the `file` field.
  Returns the same shape `daemon-python` POSTs to `/ingest` (`200`), or `422`
  with `{"detail": {"reason": "...", "message": "..."}}` for a replay that
  parsed but was rejected (`ai_player`, `incomplete_game`, `parse_error`, ...).

## Local development

```bash
cd apps/replay-parser
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8090
```

## Before relying on this in production

This service is new and has not been exercised end-to-end against real
`.StormReplay` files or a Docker build in this change — verify both (a real
replay through `POST /parse`, and a full `docker compose build`) before
pointing production traffic at it.
