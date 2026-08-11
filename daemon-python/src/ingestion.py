"""Turns a replay file on disk into an upload, shared by the CLI (`main.py`)
and the tray app's background daemon thread (`app.py`).

Split out of `main.py` so both can import it without `main` <-> `app`
becoming a circular import.
"""

from __future__ import annotations

import logging
import traceback
from dataclasses import dataclass
from pathlib import Path

from . import api_client, constants
from . import parser as replay_parser
from .hasher import hash_replay_file
from .sync_state import SyncState

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class IngestOutcome:
    """Result of one `ingest_file` call, for callers that want to react to
    it: the tray daemon's live stats (see status.py, app.py), and
    `--resync`'s summary below."""

    status: str  # "uploaded" | "skipped" | "error"
    detail: str | None = None


def ingest_file(
    client: api_client.ApiClient,
    path: Path,
    sync_state: SyncState | None = None,
    api_version: str | None = None,
) -> IngestOutcome:
    """Parses and uploads one replay.

    When `sync_state` is given, a replay already recorded as synced at the
    current (or a newer) `constants.PARSER_VERSION` is skipped without
    re-parsing or re-uploading it, and any replay successfully confirmed by
    the server (newly uploaded, or already up to date there) is recorded so
    future calls skip it too, tagged with `api_version` (the version
    `GET /ingest/version` reported at daemon startup, see `app.py`) for the
    Debug report. A replay that errors (e.g. an unparseable file, or a
    server rejection) is recorded with its error and full traceback instead
    -- shown in the Debug window (gui.py) -- and retried on the next call,
    since fixing the underlying issue (a code update, a reachable API) is
    exactly what should make it sync next time.
    """
    replay_hash: str | None = None
    if sync_state is not None:
        try:
            replay_hash = hash_replay_file(path)
        except OSError as err:
            logger.warning("Could not hash %s, parsing it in full: %s", path, err)
        else:
            if sync_state.is_up_to_date(replay_hash, constants.PARSER_VERSION):
                logger.debug("Skipping %s: already synced", path)
                return IngestOutcome("skipped", "already synced")

    try:
        payload = replay_parser.parse_replay(path)
    except replay_parser.ReplayParseError as err:
        logger.warning("Skipping %s: %s", path, err)
        if sync_state is not None and replay_hash is not None:
            sync_state.mark_error(replay_hash, str(path), str(err), traceback.format_exc())
        return IngestOutcome("error", str(err))

    try:
        result = client.post_replay(payload)
    except api_client.AuthError as err:
        # Every subsequent request will fail the same way, but the watcher
        # callback runs on a background thread, so we can only log loudly
        # here and keep going rather than cleanly stop the daemon.
        logger.error("%s", err)
        if sync_state is not None:
            sync_state.mark_error(payload["replayHash"], str(path), str(err), traceback.format_exc())
        return IngestOutcome("error", str(err))
    except api_client.ValidationError as err:
        logger.error("Server rejected %s: %s (detail: %s)", path, err, err.detail)
        if sync_state is not None:
            sync_state.mark_error(
                payload["replayHash"], str(path), f"{err} ({err.detail})", traceback.format_exc()
            )
        return IngestOutcome("error", f"{err} ({err.detail})")
    except api_client.ApiClientError as err:
        logger.error("Failed to ingest %s: %s", path, err)
        if sync_state is not None:
            sync_state.mark_error(payload["replayHash"], str(path), str(err), traceback.format_exc())
        return IngestOutcome("error", str(err))

    if sync_state is not None:
        sync_state.mark_synced(
            payload["replayHash"],
            payload["parserVersion"],
            file_path=str(path),
            api_version=api_version,
            match_id=result.match_id,
        )

    if result.upserted:
        logger.info("Ingested %s -> match %s", path, result.match_id)
        return IngestOutcome("uploaded")
    logger.info("Skipped %s (%s)", path, result.reason)
    return IngestOutcome("skipped", result.reason)


def resync(client: api_client.ApiClient, replays_dir: Path, sync_state: SyncState | None = None) -> None:
    """Parses and (re-)uploads every replay in `replays_dir`.

    Safe to run repeatedly: the API upserts by `replayHash`, so re-posting
    an already-ingested replay is a no-op rather than a duplicate. Passing
    `sync_state` also skips replays already known to be up to date, instead
    of reparsing and reposting all of them every time.
    """
    replay_files = sorted(replays_dir.glob("*.StormReplay"))
    logger.info("Resyncing %d replay(s) from %s", len(replay_files), replays_dir)
    uploaded = skipped = failed = 0
    for path in replay_files:
        outcome = ingest_file(client, path, sync_state)
        if outcome.status == "uploaded":
            uploaded += 1
        elif outcome.status == "skipped":
            skipped += 1
        else:
            failed += 1
    logger.info(
        "Resync complete: %d uploaded, %d already up to date, %d failed", uploaded, skipped, failed
    )
