from pathlib import Path
from unittest.mock import MagicMock

from src.history_enricher import HistoryEnricher
from src.sync_state import SyncState


def _info(match_id: str, replay_hash: str = "srv", **kw) -> dict:
    base = {"matchId": match_id, "replayHash": replay_hash, "parserVersion": "1.19", "map": "cursed-hollow",
            "gameMode": "ARAM", "playedAt": "2026-09-30T19:14:03.000Z", "hero": "Xalatath", "won": True}
    base.update(kw)
    return base


def test_fills_display_data_for_synced_rows_by_match_id(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_synced("h", "1.19", file_path="a", match_id="m1")
    client = MagicMock()
    client.lookup_matches.return_value = [_info("m1")]
    assert HistoryEnricher(client, state, wait=lambda _s: None).run_once() == 1
    client.lookup_matches.assert_called_once_with(match_ids=["m1"])
    row = state.all_rows()[0]
    assert (row.hero, row.game_mode, row.map_slug, row.won) == ("Xalatath", "ARAM", "cursed-hollow", True)


def test_unknown_matches_are_asked_about_once_per_run_not_forever(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_synced("h", "1.19", file_path="a", match_id="deleted-server-side")
    client = MagicMock()
    client.lookup_matches.return_value = []
    assert HistoryEnricher(client, state, wait=lambda _s: None).run_once() == 0
    assert client.lookup_matches.call_count == 1


def test_offline_stops_the_run_without_touching_rows(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_synced("h", "1.19", file_path="a", match_id="m1")
    client = MagicMock()
    client.lookup_matches.return_value = None
    assert HistoryEnricher(client, state, wait=lambda _s: None).run_once() == 0
    assert state.all_rows()[0].hero is None


def test_batches_of_200_with_a_pause_between_batches(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    for i in range(450):
        state.mark_synced(f"h{i}", "1.19", file_path=f"f{i}", match_id=f"m{i}")
    client = MagicMock()
    client.lookup_matches.return_value = []
    waits: list[float] = []
    HistoryEnricher(client, state, pause_seconds=0.5, wait=waits.append).run_once()
    sizes = [len(call.kwargs["match_ids"]) for call in client.lookup_matches.call_args_list]
    assert sizes == [200, 200, 50]
    assert waits == [0.5, 0.5, 0.5]


def test_quarantined_rows_become_synced_once_the_server_has_the_match(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_error("hq", "a", "unknown build", None, error_kind="quarantine", base_build=93943)
    client = MagicMock()
    client.lookup_matches.return_value = [_info("m9", replay_hash="hq", parserVersion="1.18")]
    HistoryEnricher(client, state, wait=lambda _s: None).run_once()
    client.lookup_matches.assert_called_once_with(replay_hashes=["hq"])
    row = state.all_rows()[0]
    assert (row.status, row.match_id, row.parser_version, row.hero) == ("synced", "m9", "1.18", "Xalatath")


def test_a_quarantined_row_the_server_does_not_have_yet_stays_quarantined(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_error("hq", "a", "unknown build", None, error_kind="quarantine")
    client = MagicMock()
    client.lookup_matches.return_value = []
    HistoryEnricher(client, state, wait=lambda _s: None).run_once()
    assert [r.replay_hash for r in state.rows_quarantined()] == ["hq"]


def test_a_set_stop_event_makes_run_once_return_without_further_lookups(tmp_path: Path):
    import threading

    state = SyncState(tmp_path / "s.db")
    for i in range(450):
        state.mark_synced(f"h{i}", "1.19", file_path=f"f{i}", match_id=f"m{i}")
    state.mark_error("hq", "a", "unknown build", None, error_kind="quarantine")
    client = MagicMock()
    stop = threading.Event()

    def lookup(**_kw):
        stop.set()  # the app is shutting down while the first batch is in flight
        return []

    client.lookup_matches.side_effect = lookup
    HistoryEnricher(client, state, stop_event=stop).run_once()
    assert client.lookup_matches.call_count == 1
