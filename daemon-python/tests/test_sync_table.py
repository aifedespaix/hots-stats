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
