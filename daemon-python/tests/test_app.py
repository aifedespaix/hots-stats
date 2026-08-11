import threading
from unittest.mock import patch

from src.app import _run_sync_loop
from src.status import StatusTracker


def _touch_replay(tmp_path, name: str):
    path = tmp_path / name
    path.write_bytes(b"")
    return path


def test_run_sync_loop_ingests_existing_replays_before_watching(tmp_path):
    """Regression test for the bug this branch fixes: a folder that already
    had replays in it before the daemon was ever configured must still get
    them uploaded, not just future ones."""
    a = _touch_replay(tmp_path, "A.StormReplay")
    b = _touch_replay(tmp_path, "B.StormReplay")
    ingested: list = []
    status = StatusTracker()
    stop_event = threading.Event()

    with patch("src.app.watch_replays") as watch:
        _run_sync_loop(tmp_path, ingested.append, stop_event, status)

    assert ingested == [a, b]
    assert status.snapshot().found == 2
    watch.assert_called_once()
    assert watch.call_args.args[0] == tmp_path
    assert watch.call_args.kwargs["stop_event"] is stop_event


def test_run_sync_loop_stops_early_when_stop_event_set(tmp_path):
    _touch_replay(tmp_path, "A.StormReplay")
    _touch_replay(tmp_path, "B.StormReplay")
    ingested: list = []
    status = StatusTracker()
    stop_event = threading.Event()
    stop_event.set()

    with patch("src.app.watch_replays") as watch:
        _run_sync_loop(tmp_path, ingested.append, stop_event, status)

    assert ingested == []
    assert status.snapshot().found == 2  # still reported, just not ingested
    watch.assert_not_called()


def test_run_sync_loop_new_replay_callback_bumps_found_and_ingests(tmp_path):
    ingested: list = []
    status = StatusTracker()
    stop_event = threading.Event()

    with patch("src.app.watch_replays") as watch:
        _run_sync_loop(tmp_path, ingested.append, stop_event, status)
        on_replay_ready = watch.call_args.kwargs["on_replay_ready"]
        new_file = tmp_path / "New.StormReplay"
        on_replay_ready(new_file)

    assert ingested == [new_file]
    assert status.snapshot().found == 1
