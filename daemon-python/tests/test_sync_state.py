from src.sync_state import SyncState, _version_tuple


def test_version_tuple_numeric_compare():
    assert _version_tuple("1.10") > _version_tuple("1.9")
    assert _version_tuple("1.0") == _version_tuple("1.0")


def test_unknown_hash_is_not_up_to_date(tmp_path):
    state = SyncState(tmp_path / "synced.json")
    assert state.is_up_to_date("abc", "1.0") is False


def test_mark_synced_then_up_to_date_at_same_or_older_version(tmp_path):
    state = SyncState(tmp_path / "synced.json")
    state.mark_synced("abc", "1.0")

    assert state.is_up_to_date("abc", "1.0") is True
    assert state.is_up_to_date("abc", "0.9") is True


def test_stale_after_parser_version_bump(tmp_path):
    """A daemon update that bumps PARSER_VERSION must make previously
    synced replays eligible for resync again, so new fields it starts
    extracting get backfilled."""
    state = SyncState(tmp_path / "synced.json")
    state.mark_synced("abc", "1.0")

    assert state.is_up_to_date("abc", "1.1") is False


def test_persists_across_instances(tmp_path):
    path = tmp_path / "synced.json"
    SyncState(path).mark_synced("abc", "1.0")

    reloaded = SyncState(path)
    assert reloaded.is_up_to_date("abc", "1.0") is True


def test_missing_file_starts_empty(tmp_path):
    state = SyncState(tmp_path / "does-not-exist.json")
    assert state.is_up_to_date("abc", "1.0") is False


def test_corrupt_file_starts_empty_instead_of_crashing(tmp_path):
    path = tmp_path / "synced.json"
    path.write_text("not json", encoding="utf-8")

    state = SyncState(path)
    assert state.is_up_to_date("abc", "1.0") is False
