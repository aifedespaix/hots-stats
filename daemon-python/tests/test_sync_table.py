from src.sync_table import PAGE_SIZE, explorer_select_args, visible_page


def test_explorer_gets_the_path_as_one_argument_even_with_spaces_and_accents():
    args = explorer_select_args(r"C:\Users\Zoé Dupont\Documents\Heroes of the Storm\a b.StormReplay")
    assert args[0] == "explorer"
    assert len(args) == 2
    assert args[1].startswith("/select,")
    assert args[1].endswith("a b.StormReplay")


def test_pages_are_filled_500_at_a_time_so_opening_the_tab_stays_instant():
    views = list(range(10_000))
    first = visible_page(views, 0, PAGE_SIZE)
    assert len(first) == 500 and first[0] == 0
    second = visible_page(views, 500, PAGE_SIZE)
    assert second[0] == 500 and len(second) == 500
    assert visible_page(views, 9_800, PAGE_SIZE) == views[9_800:]
    assert visible_page(views, 10_000, PAGE_SIZE) == []


# -- headless Tk smoke tests ---------------------------------------------------------------------

import tkinter as tk
from unittest import mock

import pytest

from src.sync_state import ReplayRow
from src.sync_table import SyncTable


class _FakeState:
    def __init__(self, rows):
        self.rows = rows
        self.meta: dict[str, str] = {}

    def all_rows(self):
        return list(self.rows)

    def get_meta(self, key):
        return self.meta.get(key)

    def set_meta(self, key, value):
        self.meta[key] = value


def _row(i, status="synced", **kw):
    return ReplayRow(
        replay_hash=f"h{i}",
        file_path=f"C:/r/{i}.StormReplay",
        status=status,
        played_at=f"2026-01-{i + 1:02d}T10:00:00",
        **kw,
    )


@pytest.fixture(scope="module")
def tk_root():
    # One root for the module: creating/destroying several Tk roots in a row is flaky on Windows.
    try:
        root = tk.Tk()
    except tk.TclError:
        pytest.skip("Tk cannot create a root window here")
    root.withdraw()
    yield root
    root.destroy()


@pytest.fixture
def table_env(tk_root):
    state = _FakeState([_row(i) for i in range(5)])
    table = SyncTable(tk_root, sync_state=state, scheduler=None, min_parser_version=lambda: None)
    table.pack()
    tk_root.update()
    yield tk_root, state, table
    table.destroy()


def test_selection_survives_a_refresh_with_unchanged_data(table_env):
    root, _state, table = table_env
    table._tree.selection_set("h2")
    root.update()
    table.refresh(force=True)
    root.update()
    assert table._tree.selection() == ("h2",)
    assert "disabled" not in table._reveal_button.state()


def test_selection_survives_a_refresh_with_changed_data(table_env):
    root, state, table = table_env
    table._tree.selection_set("h2")
    state.rows.append(_row(9))
    table.refresh(force=True)
    root.update()
    assert "h9" in table._tree.get_children()
    assert table._tree.selection() == ("h2",)
    assert "disabled" not in table._reveal_button.state()


def test_selection_is_dropped_when_the_row_disappears_and_reveal_disables(table_env):
    root, state, table = table_env
    table._tree.selection_set("h2")
    root.update()
    state.rows = [r for r in state.rows if r.replay_hash != "h2"]
    table.refresh(force=True)
    root.update()
    assert table._tree.selection() == ()
    assert "disabled" in table._reveal_button.state()


def test_identical_data_does_not_rebuild_the_tree(table_env):
    _root, _state, table = table_env
    with mock.patch.object(table, "_append_page") as append:
        table._last_refresh = 0.0
        table.refresh()
    assert append.call_count == 0


def test_changed_data_does_rebuild_the_tree(table_env):
    _root, state, table = table_env
    state.rows.append(_row(9))
    table._last_refresh = 0.0
    table.refresh()
    assert "h9" in table._tree.get_children()


def test_filter_values_are_not_rewritten_when_unchanged(table_env):
    _root, _state, table = table_env
    with mock.patch.object(table._filter_box, "configure") as configure:
        table._last_refresh = 0.0
        table.refresh()
    assert configure.call_count == 0
