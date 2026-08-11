from src.sync_state import SyncState, _version_tuple


def test_version_tuple_numeric_compare():
    assert _version_tuple("1.10") > _version_tuple("1.9")
    assert _version_tuple("1.0") == _version_tuple("1.0")


def test_unknown_hash_is_not_up_to_date(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    assert state.is_up_to_date("abc", "1.0") is False


def test_mark_synced_then_up_to_date_at_same_or_older_version(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_synced("abc", "1.0")

    assert state.is_up_to_date("abc", "1.0") is True
    assert state.is_up_to_date("abc", "0.9") is True


def test_stale_after_parser_version_bump(tmp_path):
    """A daemon update that bumps PARSER_VERSION must make previously
    synced replays eligible for resync again, so new fields it starts
    extracting get backfilled."""
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_synced("abc", "1.0")

    assert state.is_up_to_date("abc", "1.1") is False


def test_persists_across_instances(tmp_path):
    path = tmp_path / "sync_state.db"
    SyncState(path).mark_synced("abc", "1.0")

    reloaded = SyncState(path)
    assert reloaded.is_up_to_date("abc", "1.0") is True


def test_missing_file_starts_empty(tmp_path):
    state = SyncState(tmp_path / "does-not-exist.db")
    assert state.is_up_to_date("abc", "1.0") is False


def test_corrupt_file_starts_empty_instead_of_crashing(tmp_path):
    path = tmp_path / "sync_state.db"
    path.write_text("not a sqlite database", encoding="utf-8")

    state = SyncState(path)
    assert state.is_up_to_date("abc", "1.0") is False


def test_mark_synced_stores_file_path_api_version_and_match_id(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_synced("abc", "1.0", file_path="C:\\replays\\a.StormReplay", api_version="1.2.0", match_id="m1")

    assert state.get_error_records() == []


def test_mark_error_then_appears_in_error_records(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_error("abc", "C:\\replays\\a.StormReplay", "boom", "Traceback: ...")

    records = state.get_error_records()
    assert len(records) == 1
    record = records[0]
    assert record.replay_hash == "abc"
    assert record.file_path == "C:\\replays\\a.StormReplay"
    assert record.error_message == "boom"
    assert record.error_log == "Traceback: ..."
    assert record.file_exists is True
    assert state.is_up_to_date("abc", "1.0") is False


def test_mark_synced_after_error_clears_the_error(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_error("abc", "path", "boom")
    state.mark_synced("abc", "1.0", file_path="path")

    assert state.get_error_records() == []
    assert state.is_up_to_date("abc", "1.0") is True


def test_mark_error_after_synced_makes_it_stale_again(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_synced("abc", "1.0", file_path="path")
    state.mark_error("abc", "path", "boom")

    assert state.is_up_to_date("abc", "1.0") is False
    assert len(state.get_error_records()) == 1


def test_invalidate_stale_drops_replays_below_min_version(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_synced("old", "1.0", file_path="a")
    state.mark_synced("new", "1.1", file_path="b")

    invalidated = state.invalidate_stale("1.1")

    assert invalidated == 1
    assert state.is_up_to_date("old", "1.0") is False
    assert state.is_up_to_date("new", "1.1") is True


def test_invalidate_stale_is_noop_when_nothing_stale(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_synced("new", "1.1", file_path="b")

    assert state.invalidate_stale("1.0") == 0
    assert state.is_up_to_date("new", "1.1") is True


def test_refresh_file_existence_flags_missing_source_files(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_synced("abc", "1.0", file_path="C:\\replays\\a.StormReplay")

    state.refresh_file_existence(set())  # the file is no longer among those found on disk

    records_source = state._conn.execute(  # noqa: SLF001 -- easiest way to assert on a non-error row
        "SELECT file_exists FROM replays WHERE replay_hash = 'abc'"
    ).fetchone()
    assert records_source[0] == 0

    state.refresh_file_existence({"C:\\replays\\a.StormReplay"})
    records_source = state._conn.execute(
        "SELECT file_exists FROM replays WHERE replay_hash = 'abc'"
    ).fetchone()
    assert records_source[0] == 1


def test_meta_roundtrip(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    assert state.get_meta("api_version") is None

    state.set_meta("api_version", "1.2.0")
    assert state.get_meta("api_version") == "1.2.0"

    state.set_meta("api_version", "1.3.0")
    assert state.get_meta("api_version") == "1.3.0"
