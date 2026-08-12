import threading
import time
from pathlib import Path
from unittest.mock import patch

from src.watcher import _scan_for_new_replays, watch_replays


def _touch(tmp_path: Path, name: str, content: bytes = b"data") -> Path:
    path = tmp_path / name
    path.write_bytes(content)
    return path


def _wait_until(predicate, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition never became true")


# -- _scan_for_new_replays (the periodic-poll fallback, in isolation) -------


def test_scan_for_new_replays_ignores_known_paths(tmp_path):
    a = _touch(tmp_path, "A.StormReplay")

    found = _scan_for_new_replays(tmp_path, {str(a)})

    assert found == []


def test_scan_for_new_replays_returns_and_marks_unseen_files(tmp_path):
    a = _touch(tmp_path, "A.StormReplay")
    b = _touch(tmp_path, "B.StormReplay")
    seen: set[str] = set()

    found = _scan_for_new_replays(tmp_path, seen)

    assert found == sorted([a, b])
    assert seen == {str(a), str(b)}


def test_scan_for_new_replays_ignores_non_replay_files(tmp_path):
    _touch(tmp_path, "notes.txt")

    found = _scan_for_new_replays(tmp_path, set())

    assert found == []


def test_scan_for_new_replays_is_idempotent(tmp_path):
    _touch(tmp_path, "A.StormReplay")
    seen: set[str] = set()

    first = _scan_for_new_replays(tmp_path, seen)
    second = _scan_for_new_replays(tmp_path, seen)

    assert len(first) == 1
    assert second == []


# -- watch_replays wiring ----------------------------------------------------


def test_watch_replays_does_not_redispatch_known_paths_on_first_poll(tmp_path):
    """Regression test: without seeding `known_paths`, the first periodic
    poll would treat every pre-existing replay (already ingested by
    `_run_sync_loop`'s startup scan) as newly found and re-dispatch it."""
    existing = _touch(tmp_path, "Existing.StormReplay")
    ready: list[Path] = []
    stop_event = threading.Event()

    with patch("src.watcher._POLL_INTERVAL_SECONDS", 0.05):
        thread = threading.Thread(
            target=watch_replays,
            args=(tmp_path,),
            kwargs={
                "on_replay_ready": ready.append,
                "stop_event": stop_event,
                "known_paths": {str(existing)},
            },
        )
        thread.start()
        time.sleep(0.3)  # several poll cycles
        stop_event.set()
        thread.join(timeout=5)

    assert ready == []


def test_watch_replays_poll_detects_a_file_the_observer_never_reported(tmp_path):
    """Forces detection through the periodic-poll path alone, by making the
    `watchdog` observer a no-op -- simulating a dropped filesystem event
    (observed in practice on Windows). The periodic re-scan must still find
    the file and report it exactly once."""
    ready: list[Path] = []
    stop_event = threading.Event()
    missed = _touch(tmp_path, "Missed.StormReplay")

    class _NoOpObserver:
        def schedule(self, *args, **kwargs):
            pass

        def start(self):
            pass

        def stop(self):
            pass

        def join(self):
            pass

    with patch("src.watcher.Observer", _NoOpObserver), patch("src.watcher._POLL_INTERVAL_SECONDS", 0.05):
        thread = threading.Thread(
            target=watch_replays,
            args=(tmp_path,),
            kwargs={"on_replay_ready": ready.append, "stop_event": stop_event},
        )
        thread.start()
        _wait_until(lambda: ready)
        stop_event.set()
        thread.join(timeout=5)

    assert ready == [missed]


def test_watch_replays_detects_a_new_file_via_filesystem_event(tmp_path):
    """The normal (non-fallback) path still works: a file created while
    watching is reported without waiting for a poll cycle."""
    ready: list[Path] = []
    stop_event = threading.Event()

    with patch("src.watcher._POLL_INTERVAL_SECONDS", 3600):  # keep the poll from firing during the test
        thread = threading.Thread(
            target=watch_replays,
            args=(tmp_path,),
            kwargs={"on_replay_ready": ready.append, "stop_event": stop_event},
        )
        thread.start()
        time.sleep(0.2)  # let the observer start watching before we create the file
        new_file = _touch(tmp_path, "New.StormReplay")
        _wait_until(lambda: ready)
        stop_event.set()
        thread.join(timeout=5)

    assert ready == [new_file]
