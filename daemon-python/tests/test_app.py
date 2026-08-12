import threading
import time
from unittest.mock import MagicMock, patch

from src.app import _DaemonRunner, _run_sync_loop, _sync_api_version
from src.config import Config
from src.status import StatusTracker
from src.sync_state import SyncState


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


def _config(tmp_path) -> Config:
    return Config(api_base_url="https://api.example.com", access_token="hots_pat_abc", replays_dir=tmp_path)


def test_sync_api_version_invalidates_stale_replays(tmp_path):
    sync_state = SyncState(tmp_path / "sync_state.db")
    sync_state.mark_synced("old", "1.0", file_path="a")

    with patch(
        "src.app.api_client.fetch_version",
        return_value={"apiVersion": "1.5.0", "minParserVersion": "1.1"},
    ):
        api_version = _sync_api_version(_config(tmp_path), sync_state)

    assert api_version == "1.5.0"
    assert sync_state.is_up_to_date("old", "1.0") is False
    assert sync_state.get_meta("api_version") == "1.5.0"


def test_sync_api_version_leaves_state_untouched_when_api_unreachable(tmp_path):
    sync_state = SyncState(tmp_path / "sync_state.db")
    sync_state.mark_synced("old", "1.0", file_path="a")
    sync_state.set_meta("api_version", "1.4.0")

    with patch("src.app.api_client.fetch_version", return_value=None):
        api_version = _sync_api_version(_config(tmp_path), sync_state)

    assert api_version == "1.4.0"  # falls back to the last known value
    assert sync_state.is_up_to_date("old", "1.0") is True


def test_sync_api_version_keeps_replays_at_or_above_min_version(tmp_path):
    sync_state = SyncState(tmp_path / "sync_state.db")
    sync_state.mark_synced("current", "1.1", file_path="a")

    with patch(
        "src.app.api_client.fetch_version",
        return_value={"apiVersion": "1.5.0", "minParserVersion": "1.1"},
    ):
        _sync_api_version(_config(tmp_path), sync_state)

    assert sync_state.is_up_to_date("current", "1.1") is True


def test_sync_api_version_wipes_on_first_sighting_of_data_reset_at(tmp_path):
    """Regression test: an install that has synced replays before but has
    never yet recorded a `dataResetAt` locally (i.e. this is the first time
    this account ever hit "Réinitialiser mes données") must still wipe its
    local state on the first startup that observes it -- "never seen
    locally" is not the same as "nothing to wipe". Previously this was
    (wrongly) treated as a no-op, so a first-ever reset silently never
    resynced anything until the user manually deleted their local appdata."""
    sync_state = SyncState(tmp_path / "sync_state.db")
    sync_state.mark_synced("old", "1.0", file_path="a")

    with patch(
        "src.app.api_client.fetch_version",
        return_value={"apiVersion": "1.5.0", "minParserVersion": "1.0", "dataResetAt": "2026-08-12T10:00:00Z"},
    ):
        _sync_api_version(_config(tmp_path), sync_state)

    assert sync_state.is_up_to_date("old", "1.0") is False
    assert sync_state.get_meta("data_reset_at") == "2026-08-12T10:00:00Z"


def test_sync_api_version_first_sighting_is_a_noop_on_a_fresh_install(tmp_path):
    """A genuinely fresh install (empty sync-state table, nothing ever
    synced) seeing a `dataResetAt` for the first time still "wipes", but
    there's nothing to wipe -- just confirms this doesn't error and records
    the value for future comparisons."""
    sync_state = SyncState(tmp_path / "sync_state.db")

    with patch(
        "src.app.api_client.fetch_version",
        return_value={"apiVersion": "1.5.0", "minParserVersion": "1.0", "dataResetAt": "2026-08-12T10:00:00Z"},
    ):
        _sync_api_version(_config(tmp_path), sync_state)

    assert sync_state.get_meta("data_reset_at") == "2026-08-12T10:00:00Z"


def test_sync_api_version_wipes_everything_when_data_reset_at_changes(tmp_path):
    sync_state = SyncState(tmp_path / "sync_state.db")
    sync_state.mark_synced("old", "1.0", file_path="a")
    sync_state.set_meta("data_reset_at", "2026-08-01T10:00:00Z")

    with patch(
        "src.app.api_client.fetch_version",
        return_value={"apiVersion": "1.5.0", "minParserVersion": "1.0", "dataResetAt": "2026-08-12T10:00:00Z"},
    ):
        _sync_api_version(_config(tmp_path), sync_state)

    assert sync_state.is_up_to_date("old", "1.0") is False
    assert sync_state.get_meta("data_reset_at") == "2026-08-12T10:00:00Z"


def test_sync_api_version_does_not_rewipe_on_unchanged_data_reset_at(tmp_path):
    sync_state = SyncState(tmp_path / "sync_state.db")
    sync_state.set_meta("data_reset_at", "2026-08-12T10:00:00Z")
    sync_state.mark_synced("current", "1.0", file_path="a")

    with patch(
        "src.app.api_client.fetch_version",
        return_value={"apiVersion": "1.5.0", "minParserVersion": "1.0", "dataResetAt": "2026-08-12T10:00:00Z"},
    ):
        _sync_api_version(_config(tmp_path), sync_state)

    assert sync_state.is_up_to_date("current", "1.0") is True


def _wait_until(predicate, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition never became true")


def test_trigger_draft_capture_is_noop_before_any_client_is_set():
    runner = _DaemonRunner()

    with patch("src.app.draft_capture.capture_and_submit") as capture:
        runner._trigger_draft_capture()
        time.sleep(0.05)

    capture.assert_not_called()


def test_trigger_draft_capture_spawns_thread_with_current_client():
    runner = _DaemonRunner()
    fake_client = MagicMock()
    runner._client = fake_client

    with patch("src.app.draft_capture.capture_and_submit") as capture:
        runner._trigger_draft_capture()
        _wait_until(lambda: capture.called)

    capture.assert_called_once_with(fake_client, coordinator=runner.draft_capture_status)
