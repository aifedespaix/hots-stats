import re

from src.sync_state import ReplayRow
from src.sync_view import (
    build_views,
    count_by_state,
    derive_state,
    filter_views,
    format_when,
    sort_views,
)


def _row(**kwargs) -> ReplayRow:
    defaults = dict(replay_hash="h1", file_path=r"C:\r\a.StormReplay", status="synced", parser_version="1.19")
    defaults.update(kwargs)
    return ReplayRow(**defaults)


def test_synced_row_at_or_above_the_minimum_is_synced():
    assert derive_state(_row(parser_version="1.19"), "1.16") == "synced"


def test_synced_row_below_the_minimum_is_outdated():
    assert derive_state(_row(parser_version="1.10"), "1.16") == "outdated"


def test_no_minimum_known_means_never_outdated():
    assert derive_state(_row(parser_version="1.0"), None) == "synced"


def test_skip_reason_wins_over_synced():
    assert derive_state(_row(skip_reason="ai_player"), "1.16") == "skipped"


def test_error_row_is_error_and_quarantine_kind_is_quarantined():
    assert derive_state(_row(status="error", error_message="x"), None) == "error"
    assert derive_state(_row(status="error", error_kind="quarantine"), None) == "quarantined"


def test_missing_file_only_changes_rows_that_are_not_synced():
    assert derive_state(_row(status="error", file_exists=False), None) == "missing"
    assert derive_state(_row(file_exists=False), "1.16") == "synced"


def test_view_label_result_build_and_live_override():
    rows = [
        _row(
            map_slug="tomb-of-the-spider-queen",
            hero="Xalatath",
            game_mode="StormLeague",
            played_at="2026-09-30T19:14:03Z",
            won=True,
            base_build=96477,
        )
    ]
    view = build_views(rows, {}, "1.16")[0]
    assert view.label == "Tomb Of The Spider Queen · Xalatath · StormLeague"
    assert view.result == "Victoire"
    assert view.build == "96477"
    live = build_views(rows, {rows[0].file_path: "uploading"}, "1.16")[0]
    assert live.state == "uploading"


def test_label_falls_back_to_the_file_name_and_missing_values_show_a_dash():
    view = build_views([_row(file_path=r"C:\r\2026 Tomb.StormReplay")], {}, None)[0]
    assert view.label == "2026 Tomb"
    assert (view.result, view.build, view.played, view.uploaded) == ("—", "—", "—", "—")


def test_live_paths_without_a_row_become_pending_rows():
    views = build_views([], {r"C:\r\new.StormReplay": "pending"}, None)
    assert [(v.state, v.label, v.file_exists) for v in views] == [("pending", "new", True)]


def test_default_order_is_most_recent_game_first():
    rows = [
        _row(replay_hash="old", played_at="2026-01-01T00:00:00Z"),
        _row(replay_hash="new", played_at="2026-09-01T00:00:00Z"),
    ]
    assert [v.key for v in build_views(rows, {}, None)] == ["new", "old"]


def test_count_filter_and_sort():
    rows = [
        _row(replay_hash="a", status="error", error_message="x", played_at="2026-02-01T00:00:00Z"),
        _row(replay_hash="b", played_at="2026-03-01T00:00:00Z"),
        _row(replay_hash="c", played_at="2026-01-01T00:00:00Z"),
    ]
    views = build_views(rows, {}, None)
    assert count_by_state(views) == {"synced": 2, "error": 1}
    assert [v.key for v in filter_views(views, "synced")] == ["b", "c"]
    assert len(filter_views(views, None)) == 3
    assert [v.key for v in sort_views(views, "played", descending=False)] == ["c", "a", "b"]


def test_format_when_renders_local_time_or_a_dash():
    assert re.fullmatch(r"\d\d/\d\d/\d{4} \d\d:\d\d", format_when("2026-09-30T19:14:03Z"))
    assert format_when(None) == "—"
    assert format_when("not a date") == "—"
