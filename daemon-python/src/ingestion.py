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
from typing import Literal

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
    # Set only when `status == "skipped"` for a reason worth breaking out in
    # the UI as its own category (currently: "ai_player") -- as opposed to
    # the plain "already synced" / server no-op skips, which stay `None`
    # here since there's nothing notable to report about them.
    skip_reason: str | None = None


def _report_error(
    client: api_client.ApiClient,
    sync_state: SyncState | None,
    *,
    error_type: Literal["parse", "auth", "validation", "server"],
    replay_hash: str | None,
    base_build: int | None,
    message: str,
) -> None:
    """Best-effort forwards one local ingestion failure to the API (`POST
    /ingest/errors`, see `daemonErrorReportInputSchema`) so it's triageable
    centrally instead of only visible in this one player's local Debug
    window. Gated on `sync_state` being present, same as the `mark_error`
    call right before each of this function's 4 call sites below: both only
    run in the real background daemon / `--resync` CLI (see app.py /
    main.py), never in a bare `ingest_file(client, path)` call.

    Must be called while still inside the `except` block that caught the
    failure -- `traceback.format_exc()` reads the currently handled
    exception, which is only available within that block's dynamic extent.
    """
    if sync_state is None:
        return
    client.post_ingest_error(
        {
            "replayHash": replay_hash,
            "baseBuild": base_build,
            "errorType": error_type,
            "errorMessage": message[:2000],
            "errorLog": traceback.format_exc()[:8000],
            "parserVersion": constants.PARSER_VERSION,
            "daemonVersion": constants.APP_VERSION,
        }
    )


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
    Debug report. Figuring out "already synced" needs the file's content
    hash, which normally means reading it in full (`hasher.hash_replay_file`)
    -- but if this exact path, size and mtime were already hashed on a
    previous call, `sync_state.cached_hash` returns that hash straight away
    instead, so an unchanged replay isn't read from disk again on every
    daemon startup just to learn nothing changed (see
    tasks/daemon-audit-2026-08-12.md, 2.4). A replay that errors (e.g. an
    unparseable file, or a server rejection) is recorded with its error and
    full traceback instead -- shown in the Debug window (gui.py) -- and
    retried on the next call, since fixing the underlying issue (a code
    update, a reachable API) is exactly what should make it sync next time.
    A replay that's intentionally excluded rather than broken (currently:
    it includes an AI player -- `replay_parser.ReplaySkipped`) is recorded
    separately via `sync_state.mark_skipped`, gated by `parser_version` the
    same way a synced replay is (so it's not re-parsed every startup either)
    but kept out of the Debug report's error count.

    Never raises: every failure this function knows how to name (a bad
    replay file, a rejected/unreachable API call) gets a specific handler
    below, and anything it doesn't recognize -- a malformed API response, a
    local sqlite hiccup -- still falls through to a final catch-all rather
    than escaping. One bad replay must never take the whole sync loop down
    with it (`app.py`'s `_run_sync_loop` calls this from a small pool of
    worker threads, with no try/except of its own around each call): before
    this guarantee existed, an unanticipated exception here would silently
    kill the background "hots-replay-watcher" thread mid-run, leaving the
    settings window frozen on "en cours de synchronisation : <this file>"
    forever with the remaining replays never attempted and no error shown
    anywhere.
    """
    replay_hash: str | None = None
    if sync_state is not None:
        try:
            stat = path.stat()
        except OSError as err:
            logger.warning("Could not stat %s, hashing it in full: %s", path, err)
            stat = None

        cached = sync_state.cached_hash(str(path), stat.st_size, stat.st_mtime) if stat is not None else None
        if cached is not None:
            # Same path, size and mtime as the last time this daemon hashed
            # it -- the content hasn't changed, so skip reading the file's
            # bytes again just to recompute a hash we already know. This is
            # what keeps a startup with thousands of already-synced replays
            # from re-reading every single one of them in full every time.
            replay_hash = cached
        else:
            try:
                replay_hash = hash_replay_file(path)
            except OSError as err:
                logger.warning("Could not hash %s, parsing it in full: %s", path, err)
            else:
                if stat is not None:
                    sync_state.cache_hash(str(path), stat.st_size, stat.st_mtime, replay_hash)

        if replay_hash is not None and sync_state.is_up_to_date(replay_hash, constants.PARSER_VERSION):
            logger.debug("Skipping %s: already synced", path)
            return IngestOutcome("skipped", "already synced")

    payload: dict | None = None
    try:
        payload = replay_parser.parse_replay(path)
        result = client.post_replay(payload)
    except replay_parser.ReplaySkipped as err:
        # Not a failure -- the replay was read fine, it's just intentionally
        # excluded (e.g. it has an AI player). Must be matched before the
        # `ReplayParseError` branch below since it's a subclass of it. Never
        # forwarded via `_report_error`: there's nothing to triage centrally
        # about a deliberate skip, and `mark_skipped` (unlike `mark_error`)
        # keeps it out of the Debug report's error count while still
        # gating it by `parser_version` so it isn't re-parsed every startup.
        logger.info("Skipping %s: %s", path, err)
        if sync_state is not None and replay_hash is not None:
            sync_state.mark_skipped(replay_hash, str(path), err.reason, str(err), constants.PARSER_VERSION)
        return IngestOutcome("skipped", str(err), skip_reason=err.reason)
    except replay_parser.ReplayParseError as err:
        logger.warning("Skipping %s: %s", path, err)
        if sync_state is not None and replay_hash is not None:
            sync_state.mark_error(replay_hash, str(path), str(err), traceback.format_exc())
        _report_error(
            client, sync_state, error_type="parse", replay_hash=replay_hash, base_build=None, message=str(err)
        )
        return IngestOutcome("error", str(err))
    except api_client.AuthError as err:
        # Every subsequent request will fail the same way, but the watcher
        # callback runs on a background thread, so we can only log loudly
        # here and keep going rather than cleanly stop the daemon.
        logger.error("%s", err)
        if sync_state is not None:
            sync_state.mark_error(payload["replayHash"], str(path), str(err), traceback.format_exc())
        _report_error(
            client,
            sync_state,
            error_type="auth",
            replay_hash=payload["replayHash"],
            base_build=payload.get("m_baseBuild"),
            message=str(err),
        )
        return IngestOutcome("error", str(err))
    except api_client.QuarantinedError as err:
        # The server already recorded this replay server-side for review
        # (`raw_replays_quarantine`, see apps/api/src/services/
        # quarantine.service.ts) as part of returning this response --
        # forwarding it again via `_report_error` would just duplicate that
        # under a misleading "server error" label with a less complete copy
        # (no raw payload), so unlike the branches below this deliberately
        # skips it. Still recorded locally via `mark_error` so it's retried
        # automatically once the build is verified server-side.
        logger.warning("%s: %s", path, err)
        if sync_state is not None:
            sync_state.mark_error(payload["replayHash"], str(path), str(err), traceback.format_exc())
        return IngestOutcome("error", str(err))
    except api_client.ValidationError as err:
        logger.error("Server rejected %s: %s (detail: %s)", path, err, err.detail)
        message = f"{err} ({err.detail})"
        if sync_state is not None:
            sync_state.mark_error(payload["replayHash"], str(path), message, traceback.format_exc())
        _report_error(
            client,
            sync_state,
            error_type="validation",
            replay_hash=payload["replayHash"],
            base_build=payload.get("m_baseBuild"),
            message=message,
        )
        return IngestOutcome("error", message)
    except api_client.ApiClientError as err:
        logger.error("Failed to ingest %s: %s", path, err)
        if sync_state is not None:
            sync_state.mark_error(payload["replayHash"], str(path), str(err), traceback.format_exc())
        _report_error(
            client,
            sync_state,
            error_type="server",
            replay_hash=payload["replayHash"],
            base_build=payload.get("m_baseBuild"),
            message=str(err),
        )
        return IngestOutcome("error", str(err))
    except Exception as err:  # noqa: BLE001 -- deliberate catch-all, see docstring
        # Not something any handler above recognizes -- e.g. the server (or
        # a proxy/WAF in front of it) returning a 2xx response with a
        # non-JSON or unexpected-shape body, which raises deep inside
        # `requests`/`client.post_replay` rather than as one of the named
        # api_client exceptions. `payload` is bound here in every realistic
        # case (parse_replay only ever raises ReplayParseError, handled
        # above), but fall back to the pre-parse hash rather than risk a
        # second, masking exception if it somehow isn't.
        logger.exception("Unexpected error ingesting %s", path)
        message = f"{type(err).__name__}: {err}"
        error_hash = (payload or {}).get("replayHash") or replay_hash
        if sync_state is not None and error_hash is not None:
            sync_state.mark_error(error_hash, str(path), message, traceback.format_exc())
        _report_error(
            client,
            sync_state,
            error_type="server",
            replay_hash=error_hash,
            base_build=(payload or {}).get("m_baseBuild"),
            message=message,
        )
        return IngestOutcome("error", message)

    if sync_state is not None:
        try:
            sync_state.mark_synced(
                payload["replayHash"],
                payload["parserVersion"],
                file_path=str(path),
                api_version=api_version,
                match_id=result.match_id,
            )
        except Exception:
            # The upload itself already succeeded server-side (`result` is
            # back) -- losing the local "already synced" record only means
            # this one replay gets reparsed and re-POSTed next run, which the
            # server upserts as a no-op. A successful upload must never be
            # reported as an ingestion failure over a local bookkeeping
            # write, so this is deliberately not routed through mark_error /
            # _report_error like the branches above.
            logger.warning("Uploaded %s but failed to record it locally", path, exc_info=True)

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
