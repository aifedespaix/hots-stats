"""Turns a replay file on disk into an upload, shared by the CLI (`main.py`)
and the tray app's background daemon thread (`app.py`).

Split out of `main.py` so both can import it without `main` <-> `app`
becoming a circular import.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from . import api_client
from . import parser as replay_parser

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class IngestOutcome:
    """Result of one `ingest_file` call, for callers that want to react to
    it: the tray daemon's live stats (see status.py, app.py), and
    `--resync`'s summary below."""

    status: str  # "uploaded" | "skipped" | "error"
    detail: str | None = None


def ingest_file(client: api_client.ApiClient, path: Path) -> IngestOutcome:
    try:
        payload = replay_parser.parse_replay(path)
    except replay_parser.ReplayParseError as err:
        logger.warning("Skipping %s: %s", path, err)
        return IngestOutcome("error", str(err))

    try:
        result = client.post_replay(payload)
    except api_client.AuthError as err:
        # Every subsequent request will fail the same way, but the watcher
        # callback runs on a background thread, so we can only log loudly
        # here and keep going rather than cleanly stop the daemon.
        logger.error("%s", err)
        return IngestOutcome("error", str(err))
    except api_client.ValidationError as err:
        logger.error("Server rejected %s: %s (detail: %s)", path, err, err.detail)
        return IngestOutcome("error", f"{err} ({err.detail})")
    except api_client.ApiClientError as err:
        logger.error("Failed to ingest %s: %s", path, err)
        return IngestOutcome("error", str(err))

    if result.upserted:
        logger.info("Ingested %s -> match %s", path, result.match_id)
        return IngestOutcome("uploaded")
    logger.info("Skipped %s (%s)", path, result.reason)
    return IngestOutcome("skipped", result.reason)


def resync(client: api_client.ApiClient, replays_dir: Path) -> None:
    """Parses and (re-)uploads every replay in `replays_dir`.

    Safe to run repeatedly: the API upserts by `replayHash`, so re-posting
    an already-ingested replay is a no-op rather than a duplicate.
    """
    replay_files = sorted(replays_dir.glob("*.StormReplay"))
    logger.info("Resyncing %d replay(s) from %s", len(replay_files), replays_dir)
    uploaded = skipped = failed = 0
    for path in replay_files:
        outcome = ingest_file(client, path)
        if outcome.status == "uploaded":
            uploaded += 1
        elif outcome.status == "skipped":
            skipped += 1
        else:
            failed += 1
    logger.info(
        "Resync complete: %d uploaded, %d already up to date, %d failed", uploaded, skipped, failed
    )
