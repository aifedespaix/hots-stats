from src.status import StatusTracker


def test_initial_snapshot_is_empty():
    tracker = StatusTracker()
    status = tracker.snapshot()

    assert status.found == 0
    assert status.synced == 0
    assert status.failed == 0
    assert status.currently_syncing is None
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
    assert tracker.snapshot().currently_syncing == "Game1.StormReplay"

    tracker.finish_syncing(ok=True)
    status = tracker.snapshot()
    assert status.currently_syncing is None
    assert status.synced == 1
    assert status.failed == 0


def test_syncing_lifecycle_failure_keeps_last_error():
    tracker = StatusTracker()
    tracker.start_syncing("Game1.StormReplay")
    tracker.finish_syncing(ok=False, error="Access token was rejected.")

    status = tracker.snapshot()
    assert status.failed == 1
    assert status.synced == 0
    assert status.last_error == "Access token was rejected."

    # A later success doesn't clear the last seen error -- it's still worth
    # surfacing until the user acts on it.
    tracker.start_syncing("Game2.StormReplay")
    tracker.finish_syncing(ok=True)
    assert tracker.snapshot().last_error == "Access token was rejected."
