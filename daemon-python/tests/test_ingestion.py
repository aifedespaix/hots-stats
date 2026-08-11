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

    ingest_file(client, bad_file, sync_state)

    assert sync_state.is_up_to_date(replay_hash, constants.PARSER_VERSION) is False


def test_ingest_file_records_error_with_traceback_for_debug_report(tmp_path):
    client = api_client.ApiClient(_config(tmp_path))
    bad_file = tmp_path / "not-a-replay.StormReplay"
    bad_file.write_bytes(b"not an mpq archive")
    sync_state = SyncState(tmp_path / "synced.json")

    ingest_file(client, bad_file, sync_state)

    records = sync_state.get_error_records()
    assert len(records) == 1
    assert records[0].file_path == str(bad_file)
    assert records[0].error_message
    assert records[0].error_log  # full traceback for the Debug window


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


def test_resync_logs_summary(tmp_path, caplog):
    client = MagicMock()
    (tmp_path / "a.StormReplay").write_bytes(b"")
    (tmp_path / "b.StormReplay").write_bytes(b"")

    outcomes = iter([IngestOutcome("uploaded"), IngestOutcome("error", "boom")])
    with patch("src.ingestion.ingest_file", side_effect=lambda _c, _p, _s=None: next(outcomes)):
        with caplog.at_level("INFO"):
            resync(client, tmp_path)

    assert "1 uploaded, 0 already up to date, 1 failed" in caplog.text
