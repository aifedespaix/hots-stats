from src.sync_layout import progress_summary, recap_columns


def test_recap_columns_follow_the_available_width():
    assert recap_columns(900) == 3
    assert recap_columns(640) == 3
    assert recap_columns(500) == 2
    assert recap_columns(380) == 2
    assert recap_columns(300) == 1
    assert recap_columns(0) == 1


def test_progress_with_nothing_found_is_idle():
    p = progress_summary(0, 0, 0)
    assert (p.percent, p.state) == (0, "idle")


def test_progress_running_shows_done_over_found():
    p = progress_summary(40, 10, 2)
    assert p.percent == 30 and p.state == "running" and p.label == "12 / 40 parties"


def test_progress_done_without_failures_says_everything_is_up_to_date():
    p = progress_summary(40, 40, 0)
    assert p.percent == 100 and p.state == "done" and p.label == "Tout est à jour"


def test_progress_done_with_failures_reports_them():
    p = progress_summary(40, 38, 2)
    assert p.state == "done" and p.label == "Terminé — 2 échec(s)"


def test_progress_never_exceeds_100_when_counts_race_ahead_of_found():
    assert progress_summary(5, 7, 0).percent == 100


def test_already_synced_replays_count_as_done_so_a_fully_synced_library_reads_100():
    p = progress_summary(40, 0, 0, up_to_date=40)
    assert (p.percent, p.state, p.label) == (100, "done", "Tout est à jour")
    assert progress_summary(40, 5, 0, up_to_date=30).percent == 88
