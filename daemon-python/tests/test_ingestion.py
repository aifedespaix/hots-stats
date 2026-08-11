from unittest.mock import MagicMock, patch

from src import api_client
from src.config import Config
from src.ingestion import IngestOutcome, ingest_file, resync


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


def test_resync_logs_summary(tmp_path, caplog):
    client = MagicMock()
    (tmp_path / "a.StormReplay").write_bytes(b"")
    (tmp_path / "b.StormReplay").write_bytes(b"")

    outcomes = iter([IngestOutcome("uploaded"), IngestOutcome("error", "boom")])
    with patch("src.ingestion.ingest_file", side_effect=lambda _c, _p: next(outcomes)):
        with caplog.at_level("INFO"):
            resync(client, tmp_path)

    assert "1 uploaded, 0 already up to date, 1 failed" in caplog.text
