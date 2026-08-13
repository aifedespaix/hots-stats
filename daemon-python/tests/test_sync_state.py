import sqlite3

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


def test_open_migrates_pre_existing_database_missing_skip_reason_column(tmp_path):
    """A `sync_state.db` created by a daemon build from before `skip_reason`
    existed doesn't get its `replays` table recreated by `CREATE TABLE IF
    NOT EXISTS` (see `_SCHEMA`) -- `_ensure_skip_reason_column` must add the
    column itself on open, or `mark_skipped` would raise `OperationalError:
    no such column` for every player who already has a sync_state.db on
    disk from before this feature shipped."""
    path = tmp_path / "sync_state.db"
    conn = sqlite3.connect(str(path))
    conn.executescript(
        """
        CREATE TABLE replays (
            replay_hash TEXT PRIMARY KEY,
            file_path TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL CHECK (status IN ('synced', 'error')),
            parser_version TEXT,
            api_version TEXT,
            match_id TEXT,
            synced_at TEXT,
            last_attempt_at TEXT NOT NULL,
            error_message TEXT,
            error_log TEXT,
            file_exists INTEGER NOT NULL DEFAULT 1
        );
        """
    )
    conn.commit()
    conn.close()

    state = SyncState(path)
    state.mark_skipped("abc", "C:\\replays\\a.StormReplay", "ai_player", "has an AI player", "1.2")

    skipped = state.get_skipped_records()
    assert len(skipped) == 1
    assert skipped[0].reason == "ai_player"


def test_open_migration_is_idempotent_across_repeated_opens(tmp_path):
    """The `ALTER TABLE ADD COLUMN` migration must not raise on a database
    that already has `skip_reason` -- true both for a brand new database
    (created with it from `_SCHEMA` already) and for a pre-existing one
    already migrated by an earlier `SyncState(path)` call."""
    path = tmp_path / "sync_state.db"
    SyncState(path)
    SyncState(path)  # must not raise "duplicate column name"


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


def test_mark_skipped_appears_in_skipped_records_not_error_records(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_skipped("abc", "C:\\replays\\a.StormReplay", "ai_player", "has an AI player", "1.2")

    assert state.get_error_records() == []
    skipped = state.get_skipped_records()
    assert len(skipped) == 1
    record = skipped[0]
    assert record.replay_hash == "abc"
    assert record.file_path == "C:\\replays\\a.StormReplay"
    assert record.reason == "ai_player"
    assert record.message == "has an AI player"
    assert record.file_exists is True


def test_mark_skipped_is_up_to_date_like_a_synced_replay(tmp_path):
    """A skipped replay must be gated by `parser_version` the same way a
    synced one is -- otherwise it gets reparsed (CPU-heavy heroprotocol
    decode) on every daemon restart just to learn the same thing again."""
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_skipped("abc", "path", "ai_player", "has an AI player", "1.2")

    assert state.is_up_to_date("abc", "1.2") is True
    assert state.is_up_to_date("abc", "1.3") is False  # a future parser version bump still re-queues it


def test_mark_skipped_after_error_clears_the_error(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_error("abc", "path", "boom")
    state.mark_skipped("abc", "path", "ai_player", "has an AI player", "1.2")

    assert state.get_error_records() == []
    assert len(state.get_skipped_records()) == 1


def test_mark_synced_after_skipped_clears_the_skip_reason(tmp_path):
    """If a future parser version reclassifies the same bytes as a normal
    synced replay, the stale `skip_reason` from the earlier skip must not
    linger -- otherwise a genuinely synced match would still show up in the
    Debug report's "ignored on purpose" section."""
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_skipped("abc", "path", "ai_player", "has an AI player", "1.2")
    state.mark_synced("abc", "1.3", file_path="path")

    assert state.get_skipped_records() == []
    assert state.is_up_to_date("abc", "1.3") is True


def test_mark_error_after_skipped_clears_the_skip_reason(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_skipped("abc", "path", "ai_player", "has an AI player", "1.2")
    state.mark_error("abc", "path", "boom")

    assert state.get_skipped_records() == []
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


def test_invalidate_stale_drops_skipped_replays_below_min_version(tmp_path):
    """A future parser version might resolve an "AI player" skip
    differently (or stop misdetecting it), so a stale skip must be requeued
    for reparsing the same way a stale synced replay is."""
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_skipped("abc", "path", "ai_player", "has an AI player", "1.0")

    invalidated = state.invalidate_stale("1.1")

    assert invalidated == 1
    assert state.get_skipped_records() == []


def test_wipe_all_clears_synced_and_error_records(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_synced("synced-one", "1.1", file_path="a")
    state.mark_synced("synced-two", "1.1", file_path="b")
    state.mark_error("errored", "c", "boom")

    wiped = state.wipe_all()

    assert wiped == 3
    assert state.is_up_to_date("synced-one", "1.0") is False
    assert state.is_up_to_date("synced-two", "1.0") is False
    assert state.get_error_records() == []


def test_wipe_all_clears_skipped_records_too(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_skipped("abc", "path", "ai_player", "has an AI player", "1.2")

    wiped = state.wipe_all()

    assert wiped == 1
    assert state.get_skipped_records() == []


def test_wipe_all_is_noop_on_empty_state(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")

    assert state.wipe_all() == 0


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


def test_cached_hash_is_a_miss_before_anything_is_cached(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    assert state.cached_hash("C:\\replays\\a.StormReplay", 1024, 12345.0) is None


def test_cache_hash_then_cached_hash_hits_on_exact_match(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.cache_hash("C:\\replays\\a.StormReplay", 1024, 12345.0, "abc")

    assert state.cached_hash("C:\\replays\\a.StormReplay", 1024, 12345.0) == "abc"


def test_cached_hash_misses_when_size_differs(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.cache_hash("C:\\replays\\a.StormReplay", 1024, 12345.0, "abc")

    assert state.cached_hash("C:\\replays\\a.StormReplay", 2048, 12345.0) is None


def test_cached_hash_misses_when_mtime_differs(tmp_path):
    """A replay overwritten in place (same size, by coincidence) but with a
    newer mtime must not reuse the old hash -- the whole point of keying on
    both is that either changing means the bytes may have changed too."""
    state = SyncState(tmp_path / "sync_state.db")
    state.cache_hash("C:\\replays\\a.StormReplay", 1024, 12345.0, "abc")

    assert state.cached_hash("C:\\replays\\a.StormReplay", 1024, 99999.0) is None


def test_cache_hash_overwrites_stale_entry_for_the_same_path(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.cache_hash("C:\\replays\\a.StormReplay", 1024, 12345.0, "abc")
    state.cache_hash("C:\\replays\\a.StormReplay", 2048, 67890.0, "def")

    assert state.cached_hash("C:\\replays\\a.StormReplay", 1024, 12345.0) is None
    assert state.cached_hash("C:\\replays\\a.StormReplay", 2048, 67890.0) == "def"


def test_meta_roundtrip(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    assert state.get_meta("api_version") is None

    state.set_meta("api_version", "1.2.0")
    assert state.get_meta("api_version") == "1.2.0"

    state.set_meta("api_version", "1.3.0")
    assert state.get_meta("api_version") == "1.3.0"
