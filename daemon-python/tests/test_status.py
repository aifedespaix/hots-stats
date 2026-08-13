from src.status import StatusTracker


def test_initial_snapshot_is_empty():
    tracker = StatusTracker()
    status = tracker.snapshot()

    assert status.found == 0
    assert status.synced == 0
    assert status.failed == 0
    assert status.skipped_ai_player == 0
    assert status.consecutive_failures == 0
    assert status.currently_syncing == frozenset()
    assert status.last_error is None


def test_set_found_and_bump_found():
    tracker = StatusTracker()
    tracker.set_found(5)
    tracker.bump_found()
    tracker.bump_found(2)

    assert tracker.snapshot().found == 8


def test_syncing_lifecycle_success():
    tracker = StatusTracker()
    tracker.start_syncing("Game1.StormReplay")
    assert tracker.snapshot().currently_syncing == frozenset({"Game1.StormReplay"})

    tracker.finish_syncing("Game1.StormReplay", ok=True)
    status = tracker.snapshot()
    assert status.currently_syncing == frozenset()
    assert status.synced == 1
    assert status.failed == 0
    assert status.consecutive_failures == 0


def test_syncing_lifecycle_failure_keeps_last_error():
    tracker = StatusTracker()
    tracker.start_syncing("Game1.StormReplay")
    tracker.finish_syncing("Game1.StormReplay", ok=False, error="Access token was rejected.")

    status = tracker.snapshot()
    assert status.failed == 1
    assert status.synced == 0
    assert status.consecutive_failures == 1
    assert status.last_error == "Access token was rejected."

    # A later success doesn't clear the last seen error -- it's still worth
    # surfacing until the user acts on it -- but does reset the consecutive
    # count, since the streak of failures is over.
    tracker.start_syncing("Game2.StormReplay")
    tracker.finish_syncing("Game2.StormReplay", ok=True)
    status = tracker.snapshot()
    assert status.last_error == "Access token was rejected."
    assert status.consecutive_failures == 0


def test_ai_player_skip_counts_as_success_but_is_broken_out_separately():
    """An AI-player replay is not a failure (see `ingestion.ReplaySkipped`),
    so it must land in `synced` like any other non-error outcome -- but
    `skipped_ai_player` (a subset of `synced`, not additional to it) lets
    the settings window explain *why* fewer replays than `found` ever reach
    the server."""
    tracker = StatusTracker()
    tracker.start_syncing("Game1.StormReplay")
    tracker.finish_syncing("Game1.StormReplay", ok=True, skip_reason="ai_player")

    status = tracker.snapshot()
    assert status.synced == 1
    assert status.failed == 0
    assert status.skipped_ai_player == 1


def test_plain_skip_does_not_bump_ai_player_counter():
    """A "already synced" / server-no-op skip has no `skip_reason` -- only
    the specific reasons worth surfacing in the UI (currently: "ai_player")
    should move this counter."""
    tracker = StatusTracker()
    tracker.start_syncing("Game1.StormReplay")
    tracker.finish_syncing("Game1.StormReplay", ok=True)

    assert tracker.snapshot().skipped_ai_player == 0


def test_syncing_tracks_multiple_concurrent_files():
    """The initial backlog is ingested by a small pool of worker threads
    (see app.py's `_run_sync_loop`), so more than one file can genuinely be
    "in progress" at the same time -- unlike the old single `str | None`
    field, `currently_syncing` must track all of them until each finishes
    individually."""
    tracker = StatusTracker()
    tracker.start_syncing("Game1.StormReplay")
    tracker.start_syncing("Game2.StormReplay")
    assert tracker.snapshot().currently_syncing == frozenset({"Game1.StormReplay", "Game2.StormReplay"})

    tracker.finish_syncing("Game1.StormReplay", ok=True)
    assert tracker.snapshot().currently_syncing == frozenset({"Game2.StormReplay"})

    tracker.finish_syncing("Game2.StormReplay", ok=True)
    assert tracker.snapshot().currently_syncing == frozenset()


def test_consecutive_failures_counts_a_run_without_success():
    tracker = StatusTracker()
    for i in range(3):
        tracker.start_syncing(f"Game{i}.StormReplay")
        tracker.finish_syncing(f"Game{i}.StormReplay", ok=False, error="boom")

    assert tracker.snapshot().consecutive_failures == 3
    assert tracker.snapshot().failed == 3
