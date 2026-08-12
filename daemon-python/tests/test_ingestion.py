from unittest.mock import MagicMock, patch

from src import api_client, constants
from src.config import Config
from src.ingestion import IngestOutcome, ingest_file, resync
from src.sync_state import SyncState


def _config(tmp_path) -> Config:
    return Config(api_base_url="https://api.example.com", access_token="hots_pat_abc", replays_dir=tmp_path)


def test_ingest_file_parse_error_returns_error_outcome(tmp_path):
    client = api_client.ApiClient(_config(tmp_path))
    bad_file = tmp_path / "not-a-replay.StormReplay"
    bad_file.write_bytes(b"not an mpq archive")

    outcome = ingest_file(client, bad_file)

    assert outcome.status == "error"
    assert outcome.detail is not None


def test_ingest_file_uploaded(tmp_path):
    client = api_client.ApiClient(_config(tmp_path))
    replay = tmp_path / "game.StormReplay"
    replay.write_bytes(b"")

    with patch("src.ingestion.replay_parser.parse_replay", return_value={"replayHash": "abc"}):
        with patch.object(client, "post_replay", return_value=api_client.IngestResult(upserted=True, match_id="m1")):
            outcome = ingest_file(client, replay)

    assert outcome == IngestOutcome("uploaded")


def test_ingest_file_skipped_stale_version(tmp_path):
    client = api_client.ApiClient(_config(tmp_path))
    replay = tmp_path / "game.StormReplay"
    replay.write_bytes(b"")

    stale = api_client.IngestResult(upserted=False, match_id="m1", reason="stale_version")
    with patch("src.ingestion.replay_parser.parse_replay", return_value={"replayHash": "abc"}):
        with patch.object(client, "post_replay", return_value=stale):
            outcome = ingest_file(client, replay)

    assert outcome.status == "skipped"
    assert outcome.detail == "stale_version"


def test_ingest_file_auth_error_returns_error_outcome(tmp_path):
    client = api_client.ApiClient(_config(tmp_path))
    replay = tmp_path / "game.StormReplay"
    replay.write_bytes(b"")

    with patch("src.ingestion.replay_parser.parse_replay", return_value={"replayHash": "abc"}):
        with patch.object(client, "post_replay", side_effect=api_client.AuthError("nope")):
            outcome = ingest_file(client, replay)

    assert outcome.status == "error"


def test_ingest_file_skips_already_synced_replay_without_parsing(tmp_path):
    client = api_client.ApiClient(_config(tmp_path))
    replay = tmp_path / "game.StormReplay"
    replay.write_bytes(b"some replay bytes")

    from src.hasher import hash_replay_file

    sync_state = SyncState(tmp_path / "synced.json")
    sync_state.mark_synced(hash_replay_file(replay), constants.PARSER_VERSION)

    with patch("src.ingestion.replay_parser.parse_replay") as parse:
        outcome = ingest_file(client, replay, sync_state)

    parse.assert_not_called()
    assert outcome.status == "skipped"


def test_ingest_file_reuses_cached_hash_instead_of_rereading_the_file(tmp_path):
    """Regression test for 2.4 in tasks/daemon-audit-2026-08-12.md: a replay
    already hashed once (same path, size and mtime) must not have its bytes
    read again on a later `ingest_file` call, e.g. a subsequent daemon
    startup with the same file already on disk."""
    client = api_client.ApiClient(_config(tmp_path))
    replay = tmp_path / "game.StormReplay"
    replay.write_bytes(b"some replay bytes")
    sync_state = SyncState(tmp_path / "synced.json")

    from src.hasher import hash_replay_file

    replay_hash = hash_replay_file(replay)
    stat = replay.stat()
    sync_state.mark_synced(replay_hash, constants.PARSER_VERSION)
    sync_state.cache_hash(str(replay), stat.st_size, stat.st_mtime, replay_hash)

    with patch("src.ingestion.hash_replay_file") as hash_fn:
        outcome = ingest_file(client, replay, sync_state)

    hash_fn.assert_not_called()
    assert outcome.status == "skipped"


def test_ingest_file_caches_hash_after_computing_it(tmp_path):
    client = api_client.ApiClient(_config(tmp_path))
    replay = tmp_path / "game.StormReplay"
    replay.write_bytes(b"some replay bytes")
    sync_state = SyncState(tmp_path / "synced.json")

    from src.hasher import hash_replay_file

    replay_hash = hash_replay_file(replay)
    stat = replay.stat()

    with patch("src.ingestion.replay_parser.parse_replay", return_value={"replayHash": replay_hash}):
        with patch.object(client, "post_replay", side_effect=api_client.AuthError("nope")):
            ingest_file(client, replay, sync_state)

    assert sync_state.cached_hash(str(replay), stat.st_size, stat.st_mtime) == replay_hash


def test_ingest_file_recomputes_hash_when_the_file_changed_since_caching(tmp_path):
    client = api_client.ApiClient(_config(tmp_path))
    replay = tmp_path / "game.StormReplay"
    replay.write_bytes(b"some replay bytes")
    sync_state = SyncState(tmp_path / "synced.json")

    sync_state.cache_hash(str(replay), file_size=999999, mtime=1.0, replay_hash="stale-hash")

    with patch("src.ingestion.replay_parser.parse_replay", return_value={"replayHash": "abc"}):
        with patch.object(client, "post_replay", return_value=api_client.IngestResult(upserted=True, match_id="m1")):
            outcome = ingest_file(client, replay, sync_state)

    assert outcome == IngestOutcome("uploaded")


def test_ingest_file_marks_synced_on_success(tmp_path):
    client = api_client.ApiClient(_config(tmp_path))
    replay = tmp_path / "game.StormReplay"
    replay.write_bytes(b"some replay bytes")
    sync_state = SyncState(tmp_path / "synced.json")

    from src.hasher import hash_replay_file

    replay_hash = hash_replay_file(replay)

    with patch(
        "src.ingestion.replay_parser.parse_replay",
        return_value={"replayHash": replay_hash, "parserVersion": constants.PARSER_VERSION},
    ):
        with patch.object(client, "post_replay", return_value=api_client.IngestResult(upserted=True, match_id="m1")):
            ingest_file(client, replay, sync_state)

    assert sync_state.is_up_to_date(replay_hash, constants.PARSER_VERSION) is True


def test_ingest_file_does_not_mark_synced_on_error(tmp_path):
    client = api_client.ApiClient(_config(tmp_path))
    bad_file = tmp_path / "not-a-replay.StormReplay"
    bad_file.write_bytes(b"not an mpq archive")
    sync_state = SyncState(tmp_path / "synced.json")

    from src.hasher import hash_replay_file

    replay_hash = hash_replay_file(bad_file)

    with patch.object(client, "post_ingest_error"):
        ingest_file(client, bad_file, sync_state)

    assert sync_state.is_up_to_date(replay_hash, constants.PARSER_VERSION) is False


def test_ingest_file_records_error_with_traceback_for_debug_report(tmp_path):
    client = api_client.ApiClient(_config(tmp_path))
    bad_file = tmp_path / "not-a-replay.StormReplay"
    bad_file.write_bytes(b"not an mpq archive")
    sync_state = SyncState(tmp_path / "synced.json")

    with patch.object(client, "post_ingest_error"):
        ingest_file(client, bad_file, sync_state)

    records = sync_state.get_error_records()
    assert len(records) == 1
    assert records[0].file_path == str(bad_file)
    assert records[0].error_message
    assert records[0].error_log  # full traceback for the Debug window


def test_ingest_file_reports_error_to_api_when_sync_state_present(tmp_path):
    """Mirrors sync_state's own local `mark_error` -- see `_report_error`
    in ingestion.py -- so a parse failure is triageable from `GET
    /_internal/errors` instead of only visible in this one player's own
    Debug window."""
    client = api_client.ApiClient(_config(tmp_path))
    bad_file = tmp_path / "not-a-replay.StormReplay"
    bad_file.write_bytes(b"not an mpq archive")
    sync_state = SyncState(tmp_path / "synced.json")

    with patch.object(client, "post_ingest_error") as post_ingest_error:
        ingest_file(client, bad_file, sync_state)

    post_ingest_error.assert_called_once()
    report = post_ingest_error.call_args.args[0]
    assert report["errorType"] == "parse"
    assert report["baseBuild"] is None
    assert report["errorMessage"]
    assert report["errorLog"]
    assert report["parserVersion"] == constants.PARSER_VERSION
    assert report["daemonVersion"] == constants.APP_VERSION


def test_ingest_file_does_not_report_error_to_api_without_sync_state(tmp_path):
    """A bare `ingest_file(client, path)` call (no `sync_state`) is not the
    real background daemon / `--resync` flow -- see `_report_error`'s
    docstring -- so it must not trigger a network call either."""
    client = api_client.ApiClient(_config(tmp_path))
    bad_file = tmp_path / "not-a-replay.StormReplay"
    bad_file.write_bytes(b"not an mpq archive")

    with patch.object(client, "post_ingest_error") as post_ingest_error:
        ingest_file(client, bad_file)

    post_ingest_error.assert_not_called()


def test_ingest_file_reports_auth_error_with_base_build(tmp_path):
    client = api_client.ApiClient(_config(tmp_path))
    replay = tmp_path / "game.StormReplay"
    replay.write_bytes(b"some replay bytes")
    sync_state = SyncState(tmp_path / "synced.json")

    payload = {"replayHash": "abc", "parserVersion": constants.PARSER_VERSION, "m_baseBuild": 93943}
    with patch("src.ingestion.replay_parser.parse_replay", return_value=payload):
        with patch.object(client, "post_replay", side_effect=api_client.AuthError("nope")):
            with patch.object(client, "post_ingest_error") as post_ingest_error:
                ingest_file(client, replay, sync_state)

    post_ingest_error.assert_called_once()
    report = post_ingest_error.call_args.args[0]
    assert report["errorType"] == "auth"
    assert report["replayHash"] == "abc"
    assert report["baseBuild"] == 93943


def test_ingest_file_quarantined_returns_error_outcome_without_reporting_error(tmp_path):
    """Regression test for the KeyError('upserted') crash: the server
    quarantines replays whose game build isn't verified yet (202 with
    `{quarantined: true, baseBuild}`, no `upserted`/`matchId` keys) instead
    of ingesting them. That must come back as a clear, retryable error --
    not an unhandled KeyError -- and must not double-report the failure via
    `_report_error`, since the server already recorded it server-side as
    part of quarantining it (see `raw_replays_quarantine`)."""
    client = api_client.ApiClient(_config(tmp_path))
    replay = tmp_path / "game.StormReplay"
    replay.write_bytes(b"some replay bytes")
    sync_state = SyncState(tmp_path / "synced.json")

    payload = {"replayHash": "abc", "parserVersion": constants.PARSER_VERSION, "m_baseBuild": 93943}
    with patch("src.ingestion.replay_parser.parse_replay", return_value=payload):
        with patch.object(client, "post_replay", side_effect=api_client.QuarantinedError("quarantined", 93943)):
            with patch.object(client, "post_ingest_error") as post_ingest_error:
                outcome = ingest_file(client, replay, sync_state)

    assert outcome.status == "error"
    post_ingest_error.assert_not_called()
    records = sync_state.get_error_records()
    assert len(records) == 1
    assert records[0].replay_hash == "abc"
    assert sync_state.is_up_to_date("abc", constants.PARSER_VERSION) is False


def test_ingest_file_marks_synced_with_api_version_and_match_id(tmp_path):
    client = api_client.ApiClient(_config(tmp_path))
    replay = tmp_path / "game.StormReplay"
    replay.write_bytes(b"some replay bytes")
    sync_state = SyncState(tmp_path / "synced.json")

    from src.hasher import hash_replay_file

    replay_hash = hash_replay_file(replay)

    with patch(
        "src.ingestion.replay_parser.parse_replay",
        return_value={"replayHash": replay_hash, "parserVersion": constants.PARSER_VERSION},
    ):
        with patch.object(client, "post_replay", return_value=api_client.IngestResult(upserted=True, match_id="m1")):
            ingest_file(client, replay, sync_state, api_version="1.2.0")

    assert sync_state.get_error_records() == []
    assert sync_state.is_up_to_date(replay_hash, constants.PARSER_VERSION) is True


def test_ingest_file_unexpected_post_replay_error_returns_error_outcome(tmp_path):
    """The bug this guards against: `client.post_replay` can raise something
    that isn't one of the specific api_client exceptions (e.g. a malformed
    2xx response body raising deep inside `requests`) -- that must still
    come back as an error outcome instead of propagating out of
    `ingest_file` and silently killing whatever loop is calling it (see
    `app.py`'s `_run_sync_loop`, which has no try/except of its own around
    each file)."""
    client = api_client.ApiClient(_config(tmp_path))
    replay = tmp_path / "game.StormReplay"
    replay.write_bytes(b"some replay bytes")

    with patch("src.ingestion.replay_parser.parse_replay", return_value={"replayHash": "abc"}):
        with patch.object(client, "post_replay", side_effect=ValueError("unexpected response shape")):
            outcome = ingest_file(client, replay)

    assert outcome.status == "error"
    assert "unexpected response shape" in outcome.detail


def test_ingest_file_unexpected_error_is_recorded_and_reported(tmp_path):
    client = api_client.ApiClient(_config(tmp_path))
    replay = tmp_path / "game.StormReplay"
    replay.write_bytes(b"some replay bytes")
    sync_state = SyncState(tmp_path / "synced.json")

    with patch(
        "src.ingestion.replay_parser.parse_replay",
        return_value={"replayHash": "abc", "m_baseBuild": 12345},
    ):
        with patch.object(client, "post_replay", side_effect=KeyError("matchId")):
            with patch.object(client, "post_ingest_error") as post_ingest_error:
                outcome = ingest_file(client, replay, sync_state)

    assert outcome.status == "error"
    records = sync_state.get_error_records()
    assert len(records) == 1
    assert records[0].replay_hash == "abc"
    post_ingest_error.assert_called_once()
    report = post_ingest_error.call_args.args[0]
    assert report["errorType"] == "server"
    assert report["replayHash"] == "abc"
    assert report["baseBuild"] == 12345


def test_ingest_file_mark_synced_failure_does_not_turn_success_into_error(tmp_path):
    """The upload already succeeded server-side by the time `mark_synced` is
    called -- a local bookkeeping failure (e.g. a locked sqlite file) must
    not be reported as an ingestion failure; worst case this replay is
    simply reparsed and re-POSTed next run, which the server upserts as a
    no-op."""
    client = api_client.ApiClient(_config(tmp_path))
    replay = tmp_path / "game.StormReplay"
    replay.write_bytes(b"some replay bytes")
    sync_state = SyncState(tmp_path / "synced.json")

    with patch(
        "src.ingestion.replay_parser.parse_replay",
        return_value={"replayHash": "abc", "parserVersion": constants.PARSER_VERSION},
    ):
        with patch.object(client, "post_replay", return_value=api_client.IngestResult(upserted=True, match_id="m1")):
            with patch.object(sync_state, "mark_synced", side_effect=RuntimeError("database is locked")):
                outcome = ingest_file(client, replay, sync_state)

    assert outcome == IngestOutcome("uploaded")
    assert sync_state.get_error_records() == []


def test_resync_logs_summary(tmp_path, caplog):
    client = MagicMock()
    (tmp_path / "a.StormReplay").write_bytes(b"")
    (tmp_path / "b.StormReplay").write_bytes(b"")

    outcomes = iter([IngestOutcome("uploaded"), IngestOutcome("error", "boom")])
    with patch("src.ingestion.ingest_file", side_effect=lambda _c, _p, _s=None: next(outcomes)):
        with caplog.at_level("INFO"):
            resync(client, tmp_path)

    assert "1 uploaded, 0 already up to date, 1 failed" in caplog.text
