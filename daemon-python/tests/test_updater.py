import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import velopack

from src import updater
from src.updater import (
    AvailableUpdate,
    UpdatePhase,
    UpdateStatusTracker,
    installed_exe_path,
    manual_fallback_message,
    perform_update,
    read_last_update_log_lines,
    release_page_url,
    trigger_manual_update,
    update_log_file_path,
    watch_for_updates,
)


def _velopack_asset(version: str) -> velopack.VelopackAsset:
    return velopack.VelopackAsset(
        "hots-analytics-daemon", version, "Full", f"{version}.nupkg", "sha1", "sha256", 100, "", ""
    )


def _update_info(version: str) -> velopack.UpdateInfo:
    return velopack.UpdateInfo(_velopack_asset(version), [], False, None)


def _available_update(version: str) -> AvailableUpdate:
    return AvailableUpdate(version=version, velopack_info=_update_info(version))


def _wait_until(predicate, timeout: float = 2.0) -> None:
    import time

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition never became true")


# -- installed_exe_path -------------------------------------------------


def test_installed_exe_path_returns_the_velopack_stub_path(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setattr("src.updater._PACK_ID", "hots-analytics-daemon")
    monkeypatch.setattr("src.updater._EXE_NAME", "hots-analytics-daemon.exe")

    result = installed_exe_path()

    assert result == tmp_path / "hots-analytics-daemon" / "hots-analytics-daemon.exe"


# -- manual_fallback_message -------------------------------------------------


def test_manual_fallback_message_names_the_release_page_and_version():
    """Signature changed (Task 2): only `version` now -- Velopack owns the
    download/apply staging directory itself, so there's no separate
    locally-staged file to point at; the message instead points at the
    GitHub release page."""
    message = manual_fallback_message("2.0.0")

    assert "2.0.0" in message
    assert release_page_url() in message


# -- UpdateStatusTracker --------------------------------------------------


def test_try_begin_succeeds_when_idle():
    status = UpdateStatusTracker()
    assert status.try_begin("2.0.0") is True
    snapshot = status.snapshot()
    assert snapshot.phase is UpdatePhase.DOWNLOADING
    assert snapshot.version == "2.0.0"
    assert snapshot.progress == 0.0


def test_try_begin_fails_while_already_downloading():
    status = UpdateStatusTracker()
    assert status.try_begin("2.0.0") is True
    assert status.try_begin("2.0.0") is False


def test_try_begin_fails_while_installing():
    status = UpdateStatusTracker()
    status.set(phase=UpdatePhase.INSTALLING)
    assert status.try_begin("2.0.0") is False


def test_set_can_set_manual_fallback_path_explicitly():
    status = UpdateStatusTracker()
    path = Path("/tmp/new-hots-analytics-daemon.exe")

    status.set(phase=UpdatePhase.ERROR, message="failed", manual_fallback_path=path)

    assert status.snapshot().manual_fallback_path == path


def test_set_resets_manual_fallback_path_by_default():
    """`manual_fallback_path` must never silently survive (via `replace`'s
    "keep the current value" behavior) into a status update that never
    meant to carry it -- otherwise a stale path from one failed update could
    still show an "Ouvrir le dossier" button pointing at it during a later,
    unrelated check or download."""
    status = UpdateStatusTracker()
    status.set(phase=UpdatePhase.ERROR, message="failed", manual_fallback_path=Path("/tmp/new-app.exe"))

    status.set(phase=UpdatePhase.CHECKING, message=None)

    assert status.snapshot().manual_fallback_path is None


# -- update_log_file_path / read_last_update_log_lines -----------------------


def test_update_log_file_path_is_next_to_config_file(monkeypatch, tmp_path):
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))

    assert update_log_file_path() == tmp_path / "AppData" / "hots-analytics" / "update.log"


def test_read_last_update_log_lines_returns_empty_when_missing(monkeypatch, tmp_path):
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))

    assert read_last_update_log_lines() == []


def test_read_last_update_log_lines_returns_tail(monkeypatch, tmp_path):
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    log_path = update_log_file_path()
    log_path.parent.mkdir(parents=True)
    log_path.write_text("\n".join(f"line {i}" for i in range(20)) + "\n", encoding="utf-8")

    lines = read_last_update_log_lines(max_lines=3)

    assert lines == ["line 17", "line 18", "line 19"]


# -- _get_update_manager (lazy singleton) -------------------------------------


def test_get_update_manager_constructs_once_and_caches(monkeypatch):
    """`_get_update_manager` must construct `velopack.UpdateManager` at most
    once and share that instance across every caller -- constructing it
    eagerly at import time crashes outside a real Velopack install, which is
    exactly why this laziness exists (see the module docstring / the
    function's own docstring)."""
    monkeypatch.setattr("src.updater._update_manager", None)
    created = []

    def _fake_ctor(source):
        created.append(source)
        return MagicMock()

    monkeypatch.setattr("src.updater.velopack.UpdateManager", _fake_ctor)

    first = updater._get_update_manager()
    second = updater._get_update_manager()

    assert first is second
    assert len(created) == 1
    assert created[0] is updater._update_source


# -- _check_for_update --------------------------------------------------------


def test_check_for_update_returns_update_when_available(monkeypatch):
    info = _update_info("2.0.0")
    manager = MagicMock()
    manager.check_for_updates.return_value = info
    monkeypatch.setattr("src.updater._get_update_manager", lambda: manager)

    update = updater._check_for_update()

    assert update == AvailableUpdate(version="2.0.0", velopack_info=info)


def test_check_for_update_strips_v_prefix_from_version(monkeypatch):
    info = _update_info("v3.1.4")
    manager = MagicMock()
    manager.check_for_updates.return_value = info
    monkeypatch.setattr("src.updater._get_update_manager", lambda: manager)

    update = updater._check_for_update()

    assert update.version == "3.1.4"


def test_check_for_update_returns_none_when_up_to_date(monkeypatch):
    manager = MagicMock()
    manager.check_for_updates.return_value = None
    monkeypatch.setattr("src.updater._get_update_manager", lambda: manager)

    assert updater._check_for_update() is None


def test_check_for_update_returns_none_on_failure(monkeypatch):
    """An update check must never interrupt the daemon's actual job of
    syncing replays -- any exception from Velopack (offline, rate-limited,
    no release published yet) degrades to "no update found" rather than
    propagating."""
    manager = MagicMock()
    manager.check_for_updates.side_effect = RuntimeError("offline")
    monkeypatch.setattr("src.updater._get_update_manager", lambda: manager)

    assert updater._check_for_update() is None


# -- perform_update ---------------------------------------------------------


def test_perform_update_downloads_and_applies(monkeypatch):
    update = _available_update("2.0.0")
    status = UpdateStatusTracker()
    manager = MagicMock()
    monkeypatch.setattr("src.updater._get_update_manager", lambda: manager)

    assert perform_update(update, status) is True

    manager.download_updates.assert_called_once()
    assert manager.download_updates.call_args.args[0] is update.velopack_info
    manager.apply_updates_and_restart.assert_called_once_with(update.velopack_info)
    # In reality `apply_updates_and_restart` never returns on success (the
    # process replaces itself), so the status is left at INSTALLING rather
    # than flipped to some "done" phase afterward.
    assert status.snapshot().phase is UpdatePhase.INSTALLING


def test_perform_update_progress_callback_converts_percent_to_fraction(monkeypatch):
    """Velopack reports download progress as an int 0..100; `UpdateStatus.
    progress` is documented (and relied on by gui.py's progress bar) as a
    0..1 fraction."""
    update = _available_update("2.0.0")
    status = UpdateStatusTracker()
    seen_progress: list[float | None] = []

    def _fake_download(_info, progress_callback=None):
        progress_callback(50)
        seen_progress.append(status.snapshot().progress)

    manager = MagicMock()
    manager.download_updates.side_effect = _fake_download
    monkeypatch.setattr("src.updater._get_update_manager", lambda: manager)

    perform_update(update, status)

    assert seen_progress == [0.5]


def test_perform_update_records_error_on_download_failure(monkeypatch):
    update = _available_update("2.0.0")
    status = UpdateStatusTracker()
    manager = MagicMock()
    manager.download_updates.side_effect = RuntimeError("offline")
    monkeypatch.setattr("src.updater._get_update_manager", lambda: manager)

    assert perform_update(update, status) is True
    manager.apply_updates_and_restart.assert_not_called()
    snapshot = status.snapshot()
    assert snapshot.phase is UpdatePhase.ERROR
    assert "offline" in snapshot.message


def test_perform_update_records_error_on_apply_failure(monkeypatch):
    update = _available_update("2.0.0")
    status = UpdateStatusTracker()
    manager = MagicMock()
    manager.apply_updates_and_restart.side_effect = RuntimeError("install blocked")
    monkeypatch.setattr("src.updater._get_update_manager", lambda: manager)

    assert perform_update(update, status) is True
    manager.download_updates.assert_called_once()
    snapshot = status.snapshot()
    assert snapshot.phase is UpdatePhase.ERROR
    assert snapshot.message == manual_fallback_message("2.0.0")


def test_perform_update_skips_when_already_in_progress(monkeypatch):
    update = _available_update("2.0.0")
    status = UpdateStatusTracker()
    status.try_begin("1.9.0")
    manager = MagicMock()
    monkeypatch.setattr("src.updater._get_update_manager", lambda: manager)

    assert perform_update(update, status) is False
    manager.download_updates.assert_not_called()
    manager.apply_updates_and_restart.assert_not_called()


# -- trigger_manual_update ---------------------------------------------------


def test_trigger_manual_update_applies_when_available(monkeypatch):
    update = _available_update("2.0.0")
    status = UpdateStatusTracker()
    manager = MagicMock()

    monkeypatch.setattr("src.updater._check_for_update", lambda: update)
    monkeypatch.setattr("src.updater._get_update_manager", lambda: manager)

    trigger_manual_update(status)
    _wait_until(lambda: manager.apply_updates_and_restart.called)

    manager.download_updates.assert_called_once()
    manager.apply_updates_and_restart.assert_called_once_with(update.velopack_info)


def test_trigger_manual_update_reports_up_to_date(monkeypatch):
    status = UpdateStatusTracker()
    monkeypatch.setattr("src.updater._check_for_update", lambda: None)

    trigger_manual_update(status)
    _wait_until(lambda: status.snapshot().phase is UpdatePhase.IDLE and status.snapshot().message)

    assert status.snapshot().message == "Aucune mise à jour disponible."


# -- watch_for_updates --------------------------------------------------------


def test_watch_for_updates_notifies_and_auto_applies(monkeypatch):
    """`on_update_found` must fire once an update is confirmed, before the
    download/apply handoff -- this is what backs the tray notification in
    app.py, so the (fully automatic) self-update isn't invisible."""
    update = _available_update("2.0.0")
    status = UpdateStatusTracker()
    manager = MagicMock()

    monkeypatch.setattr("src.updater.IS_FROZEN", True)
    monkeypatch.setattr("src.updater._check_for_update", lambda: update)
    monkeypatch.setattr("src.updater._get_update_manager", lambda: manager)

    stop_event = threading.Event()
    found: list[AvailableUpdate] = []
    with patch.object(stop_event, "wait", side_effect=[False, True]):
        watch_for_updates(stop_event, status, on_update_found=found.append)

    assert found == [update]
    manager.apply_updates_and_restart.assert_called_once_with(update.velopack_info)


def test_watch_for_updates_notification_failure_does_not_block_update(monkeypatch):
    update = _available_update("2.0.0")
    status = UpdateStatusTracker()
    manager = MagicMock()

    monkeypatch.setattr("src.updater.IS_FROZEN", True)
    monkeypatch.setattr("src.updater._check_for_update", lambda: update)
    monkeypatch.setattr("src.updater._get_update_manager", lambda: manager)

    def _boom(_update: AvailableUpdate) -> None:
        raise RuntimeError("notification backend unavailable")

    stop_event = threading.Event()
    with patch.object(stop_event, "wait", side_effect=[False, True]):
        watch_for_updates(stop_event, status, on_update_found=_boom)

    manager.apply_updates_and_restart.assert_called_once_with(update.velopack_info)


def test_watch_for_updates_does_not_apply_when_auto_update_disabled(monkeypatch):
    update = _available_update("2.0.0")
    status = UpdateStatusTracker()
    manager = MagicMock()

    monkeypatch.setattr("src.updater.IS_FROZEN", True)
    monkeypatch.setattr("src.updater._check_for_update", lambda: update)
    monkeypatch.setattr("src.updater._get_update_manager", lambda: manager)

    stop_event = threading.Event()
    found: list[AvailableUpdate] = []
    with patch.object(stop_event, "wait", side_effect=[False, True]):
        watch_for_updates(stop_event, status, auto_update_enabled=lambda: False, on_update_found=found.append)

    manager.download_updates.assert_not_called()
    assert found == [update]
    assert status.snapshot().phase is UpdatePhase.AVAILABLE
    assert status.snapshot().version == "2.0.0"


def test_watch_for_updates_notifies_only_once_per_version(monkeypatch):
    """With auto-update off, the same still-uninstalled version shouldn't
    re-trigger a tray notification on every 6h check cycle."""
    update = _available_update("2.0.0")
    status = UpdateStatusTracker()

    monkeypatch.setattr("src.updater.IS_FROZEN", True)
    monkeypatch.setattr("src.updater._check_for_update", lambda: update)

    stop_event = threading.Event()
    found: list[AvailableUpdate] = []
    with patch.object(stop_event, "wait", side_effect=[False, False, True]):
        watch_for_updates(stop_event, status, auto_update_enabled=lambda: False, on_update_found=found.append)

    assert found == [update]


def test_watch_for_updates_noop_when_not_frozen():
    status = UpdateStatusTracker()
    stop_event = threading.Event()
    with patch.object(stop_event, "wait") as wait:
        watch_for_updates(stop_event, status)
    wait.assert_not_called()
    assert status.snapshot().phase is UpdatePhase.IDLE
