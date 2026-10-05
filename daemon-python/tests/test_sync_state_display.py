import sqlite3
from pathlib import Path

from src.ingestion import display_fields
from src.sync_state import SyncState


def test_old_database_gains_the_display_columns(tmp_path: Path):
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE replays (replay_hash TEXT PRIMARY KEY, file_path TEXT NOT NULL DEFAULT '', "
        "status TEXT NOT NULL CHECK (status IN ('synced','error')), parser_version TEXT, api_version TEXT, "
        "match_id TEXT, synced_at TEXT, last_attempt_at TEXT NOT NULL, error_message TEXT, error_log TEXT, "
        "file_exists INTEGER NOT NULL DEFAULT 1)"
    )
    conn.execute("INSERT INTO replays (replay_hash, status, last_attempt_at) VALUES ('h', 'synced', 'x')")
    conn.commit()
    conn.close()
    state = SyncState(path)
    row = state.all_rows()[0]
    assert (row.hero, row.game_mode, row.played_at, row.won, row.base_build, row.error_kind) == (None,) * 6


def test_mark_synced_stores_display_fields_and_resync_without_them_keeps_them(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_synced(
        "h", "1.19", file_path="a", match_id="m1", map_slug="cursed-hollow",
        base_build=96477, hero="Xalatath", game_mode="ARAM", played_at="2026-09-30T19:14:03Z", won=False,
    )
    state.mark_synced("h", "1.19", file_path="a", match_id="m1", map_slug="cursed-hollow")
    row = state.all_rows()[0]
    assert (row.hero, row.game_mode, row.won, row.base_build) == ("Xalatath", "ARAM", False, 96477)


def test_mark_error_records_kind_and_build(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_error("h", "a", "unknown build", None, error_kind="quarantine", base_build=93943)
    row = state.all_rows()[0]
    assert (row.status, row.error_kind, row.base_build) == ("error", "quarantine", 93943)
    assert [r.replay_hash for r in state.rows_quarantined()] == ["h"]


def test_rows_needing_enrichment_only_lists_synced_rows_with_a_match_and_a_gap(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_synced("gap", "1.19", file_path="a", match_id="m1")
    state.mark_synced("full", "1.19", file_path="b", match_id="m2", hero="A", game_mode="ARAM",
                      played_at="2026-01-01T00:00:00Z", won=True)
    state.mark_synced("nomatch", "1.19", file_path="c")
    state.mark_skipped("skipped", "d", "ai_player", "AI", "1.19")
    assert [r.replay_hash for r in state.rows_needing_enrichment()] == ["gap"]


def test_apply_match_info_fills_gaps_without_erasing_known_values(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_synced("h", "1.19", file_path="a", match_id="m1", hero="Known")
    state.apply_match_info("m1", map_slug="cursed-hollow", game_mode="ARAM",
                           played_at="2026-09-30T19:14:03Z", hero=None, won=True)
    row = state.all_rows()[0]
    assert (row.hero, row.map_slug, row.game_mode, row.won) == ("Known", "cursed-hollow", "ARAM", True)


def test_reconcile_quarantined_turns_the_row_into_a_synced_one(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_error("h", "a", "unknown build", "tb", error_kind="quarantine", base_build=93943)
    state.reconcile_quarantined("h", "m9", "1.19", map_slug="cursed-hollow", game_mode="ARAM",
                                played_at="2026-09-30T19:14:03Z", hero="Xalatath", won=True)
    row = state.all_rows()[0]
    assert (row.status, row.error_kind, row.error_message, row.match_id, row.parser_version) == (
        "synced", None, None, "m9", "1.19")
    assert state.rows_quarantined() == []


def test_display_fields_picks_the_players_own_hero_and_result():
    payload = {
        "m_baseBuild": 96477, "gameMode": "StormLeague", "playedAt": "2026-09-30T19:14:03Z",
        "selfBattletag": "Me#1234",
        "players": [{"battletag": "Other#1", "heroId": "Abathur", "winner": True},
                    {"battletag": "Me#1234", "heroId": "Xalatath", "winner": False}],
    }
    assert display_fields(payload) == {
        "base_build": 96477, "game_mode": "StormLeague", "played_at": "2026-09-30T19:14:03Z",
        "hero": "Xalatath", "won": False,
    }


def test_display_fields_without_a_self_battletag_leaves_hero_and_result_empty():
    fields = display_fields({"gameMode": "ARAM", "players": [{"battletag": "A#1", "heroId": "X", "winner": True}]})
    assert (fields["hero"], fields["won"]) == (None, None)


def _quarantined(state: SyncState) -> None:
    state.mark_error("h", "a", "unknown build", "tb", error_kind="quarantine", base_build=93943)


def test_parse_error_after_quarantine_clears_the_quarantine_kind(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    _quarantined(state)
    state.mark_parse_error("h", "a", "corrupt", "tb", "1.19")
    assert state.all_rows()[0].error_kind is None
    assert state.rows_quarantined() == []


def test_plain_error_after_quarantine_clears_the_quarantine_kind(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    _quarantined(state)
    state.mark_error("h", "a", "server down", "tb")
    assert state.all_rows()[0].error_kind is None
    assert state.rows_quarantined() == []


def test_skip_after_quarantine_clears_the_quarantine_kind(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    _quarantined(state)
    state.mark_skipped("h", "a", "ai_player", "AI", "1.19")
    assert state.all_rows()[0].error_kind is None
    assert state.rows_quarantined() == []
