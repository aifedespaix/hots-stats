"""Internal-only HTTP service: turns one raw `.StormReplay` upload into the
same JSON payload the Windows daemon (daemon-python) posts to `POST
/ingest`.

Exists so the web app's manual drag & drop upload (apps/web's `/upload`
page, via `apps/api`'s `POST /uploads`) can reuse the daemon's own replay
parsing logic instead of a second, independently-maintained implementation
of HotS's binary replay format. `daemon_core/` is `daemon-python/src` copied
in verbatim at image build time (see Dockerfile) -- not a fork: same
`parser.py`, same `constants.py` (map/hero tables, `PARSER_VERSION`), same
`_protocol_versions.py`. Bumping the daemon's parser also bumps this
service's next image build; nothing here needs to change in lockstep.

Never exposed publicly -- only `apps/api` calls it, over the docker-compose
internal network (see `REPLAY_PARSER_URL` in apps/api/src/lib/env.ts).
"""

from __future__ import annotations

import json
import logging
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from daemon_core import parser as replay_parser

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="hots-stats replay-parser", docs_url=None, redoc_url=None)


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/parse")
async def parse(file: UploadFile = File(...), calibrations: str = Form(...)) -> JSONResponse:
    """Parses one uploaded replay and returns `replayPayloadSchema`-shaped
    JSON (see packages/shared-types) -- the exact same shape `parser.py`
    hands to `ApiClient.post_replay` in the daemon. `apps/api`'s `POST
    /uploads` feeds this straight into `ingestReplayPayload`, the same
    adapter-resolution/upsert path `POST /ingest` uses for the daemon.

    `calibrations` is a *required* JSON-encoded `{mapId: {minX, maxX, minY,
    maxY, ...}}` form field, passed straight through to `parse_replay` (see
    its docstring) so a web-uploaded replay gets a `spatial` block exactly
    like a daemon upload does when its map is calibrated -- this service has
    no daemon-style local cache of its own, so `apps/api`'s `POST /uploads`
    (which already reads `map_calibrations` directly for other purposes)
    fetches it fresh and forwards it on every request instead. Deliberately
    required (not defaulted to "none known") rather than optional: an
    earlier version let this field be omitted, and a web upload silently
    never got spatial data as a result -- a caller that forgets to fetch and
    send it now gets a loud 422 instead of a quiet, permanent feature gap.
    Send `"{}"` for "no maps calibrated yet", not an absent field. Malformed
    JSON in a *present* field still degrades to "no calibrations known"
    rather than failing the whole parse over it.

    422 (not 400) for a file that read fine but couldn't be turned into a
    valid payload -- `ReplaySkipped` (e.g. an AI player) and
    `ReplayParseError` (a corrupt or unrecognized replay) alike -- since the
    *request* itself was well-formed; only the file's content is the
    problem. `ReplaySkipped` must be caught before `ReplayParseError`: it's
    a subclass of it (see daemon_core/parser.py).
    """
    if not (file.filename or "").lower().endswith(".stormreplay"):
        raise HTTPException(status_code=400, detail={"message": "Expected a .StormReplay file."})

    try:
        parsed_calibrations: dict[str, dict] | None = json.loads(calibrations)
    except (TypeError, ValueError):
        logger.warning("Ignoring malformed calibrations field for %s", file.filename)
        parsed_calibrations = None

    data = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".StormReplay") as tmp:
        tmp.write(data)
        tmp.flush()
        try:
            payload = replay_parser.parse_replay(Path(tmp.name), calibrations=parsed_calibrations)
        except replay_parser.ReplaySkipped as err:
            logger.info("Skipped %s: %s", file.filename, err)
            raise HTTPException(status_code=422, detail={"reason": err.reason, "message": str(err)}) from err
        except replay_parser.ReplayParseError as err:
            logger.warning("Failed to parse %s: %s", file.filename, err)
            raise HTTPException(status_code=422, detail={"reason": "parse_error", "message": str(err)}) from err

    return JSONResponse(payload)
