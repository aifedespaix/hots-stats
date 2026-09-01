import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import velopack

from src import updater
from src.updater import (
    AvailableUpdate,
    UpdatePhase,
    UpdateStatusTracker,
    installed_exe_path,
    is_running_from_legacy_install,
    manual_fallback_message,
    perform_update,
    read_last_update_log_lines,
    release_page_url,
    trigger_manual_update,
    update_log_file_path,
    watch_for_updates,
)


@pytest.fixture(autouse=True)
def _isolate_appdata(monkeypatch, tmp_path):
    """Every path this module touches on disk (`update.log`, `config.json`,
    the migration sentinel) is derived from `config.config_file_path()`,
    which reads `%APPDATA%`. Without this, `watch_for_updates`'s
    `_append_update_log_line(..., "Update found.")` appends real lines to the
    developer's actual `%APPDATA%\\hots-analytics\\update.log` -- the same
    file a maintainer reads when triaging a genuinely failed update.

    Autouse (rather than per-test) so no future test in this file can
    reintroduce that pollution by forgetting to redirect it. Individual tests
    may still `monkeypatch.setenv("APPDATA", ...)` to their own `tmp_path`
    subdirectory; that simply overrides this."""
    monkeypatch.setenv("APPDATA", str(tmp_path / "_autouse_appdata"))


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


# -- is_running_from_legacy_install (one-time migration shim) ----------------


#
# These deliberately drive the *real* inputs (`NUITKA_ONEFILE_BINARY`,
# `LOCALAPPDATA`) rather than monkeypatching `installed_exe_path`. Patching
# that function is what let the original bug ship: since Task 3,
# `installed_exe_path()` is a pure computation from `LOCALAPPDATA`, so
# comparing it against a recomputation of its own definition was
# tautologically equal and the predicate could never return True. Faking its
# return value tested the arithmetic of the comparison instead of the
# predicate, and happily passed.


def _make_exe(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"MZ")
    return path


def test_is_running_from_legacy_install_false_when_not_frozen(monkeypatch, tmp_path):
    """Never true for local dev, no matter where the running exe sits."""
    monkeypatch.setattr("src.updater.IS_FROZEN", False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "LocalAppData"))
    monkeypatch.setenv(
        "NUITKA_ONEFILE_BINARY", str(_make_exe(tmp_path / "Games" / "hots-analytics-daemon.exe"))
    )

    assert is_running_from_legacy_install() is False


def test_is_running_from_legacy_install_false_for_a_real_velopack_install(monkeypatch, tmp_path):
    """A frozen build launched from inside the Velopack-managed directory
    (`%LOCALAPPDATA%\\{packId}\\current\\{exeName}` -- Velopack runs the app
    out of `current\\`, only the stub sits at the folder root) is the normal,
    post-migration case: never flagged as legacy."""
    local_app_data = tmp_path / "LocalAppData"
    monkeypatch.setattr("src.updater.IS_FROZEN", True)
    monkeypatch.setenv("LOCALAPPDATA", str(local_app_data))
    running = _make_exe(
        local_app_data / "hots-analytics-daemon" / "current" / "hots-analytics-daemon.exe"
    )
    monkeypatch.setenv("NUITKA_ONEFILE_BINARY", str(running))

    assert is_running_from_legacy_install() is False


def test_is_running_from_legacy_install_true_for_an_arbitrary_old_location(monkeypatch, tmp_path):
    """The pre-Velopack model: a frozen raw .exe living wherever the user
    happened to put it, outside the Velopack install directory entirely.
    This is exactly the case the migration shim exists for."""
    monkeypatch.setattr("src.updater.IS_FROZEN", True)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "LocalAppData"))
    running = _make_exe(tmp_path / "Games" / "HotsDaemon" / "hots-analytics-daemon.exe")
    monkeypatch.setenv("NUITKA_ONEFILE_BINARY", str(running))

    assert is_running_from_legacy_install() is True


def test_is_running_from_legacy_install_falls_back_to_sys_executable(monkeypatch, tmp_path):
    """`NUITKA_ONEFILE_BINARY` is only set by --onefile builds; without it
    the running exe is `sys.executable`. Same verdict either way."""
    monkeypatch.setattr("src.updater.IS_FROZEN", True)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "LocalAppData"))
    monkeypatch.delenv("NUITKA_ONEFILE_BINARY", raising=False)
    monkeypatch.setattr(
        "src.updater.sys.executable",
        str(_make_exe(tmp_path / "Program Files" / "hots-analytics-daemon.exe")),
    )

    assert is_running_from_legacy_install() is True


def test_is_running_from_legacy_install_with_localappdata_unset(monkeypatch, tmp_path):
    """With `LOCALAPPDATA` missing, `installed_exe_path()` falls back to
    `~/AppData/Local/...` -- an absolute path, so the comparison stays
    meaningful. It must not return True merely because the environment
    degraded (the old code compared against the *relative* path
    `Path("hots-analytics-daemon")`, which never matched anything)."""
    monkeypatch.setattr("src.updater.IS_FROZEN", True)
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    fake_home = tmp_path / "home"
    monkeypatch.setattr("src.updater.Path.home", staticmethod(lambda: fake_home))

    velopack_exe = _make_exe(
        fake_home
        / "AppData"
        / "Local"
        / "hots-analytics-daemon"
        / "current"
        / "hots-analytics-daemon.exe"
    )
    monkeypatch.setenv("NUITKA_ONEFILE_BINARY", str(velopack_exe))
    assert is_running_from_legacy_install() is False

    legacy_exe = _make_exe(tmp_path / "Games" / "hots-analytics-daemon.exe")
    monkeypatch.setenv("NUITKA_ONEFILE_BINARY", str(legacy_exe))
    assert is_running_from_legacy_install() is True


# -- migrate_to_velopack_install (one-time migration shim) -------------------


def _stub_release_download(monkeypatch) -> MagicMock:
    """Makes the GitHub release lookup + Setup.exe download succeed, and
    returns the `subprocess.Popen` mock standing in for launching it."""
    release_response = MagicMock()
    release_response.json.return_value = {
        "tag_name": "v1.2.3",
        "assets": [
            {"name": updater._SETUP_ASSET_NAME, "browser_download_url": "https://example.com/Setup.exe"}
        ],
    }

    download_response = MagicMock()
    download_response.__enter__.return_value = download_response
    download_response.__exit__.return_value = False
    download_response.iter_content.return_value = [b"data"]

    def fake_get(url, **kwargs):
        if url == updater._LATEST_RELEASE_API_URL:
            return release_response
        return download_response

    popen = MagicMock()
    monkeypatch.setattr(updater.requests, "get", fake_get)
    monkeypatch.setattr(updater.subprocess, "Popen", popen)
    return popen


def test_migration_done_marker_is_a_file_that_save_config_cannot_erase(monkeypatch, tmp_path):
    """The marker must not live in config.json: `config.save_config` writes a
    fixed literal payload rather than merging, so a key there would be
    silently deleted the first time the user saves settings after migrating
    -- making the migration re-trigger on every subsequent launch."""
    from src import config

    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    assert updater._is_migration_marked_done() is False

    updater._mark_migration_done()
    assert updater._is_migration_marked_done() is True

    config.save_config("https://api.example.com", "token", str(tmp_path / "replays"))

    assert updater._is_migration_marked_done() is True
    assert "velopack" not in config.read_config_file()


def test_migrate_to_velopack_install_marks_done_with_a_sentinel_file(monkeypatch, tmp_path):
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    popen = _stub_release_download(monkeypatch)

    updater.migrate_to_velopack_install()

    popen.assert_called_once()
    sentinel = tmp_path / "AppData" / "hots-analytics" / updater._MIGRATION_DONE_SENTINEL_NAME
    assert sentinel.is_file()


def test_migrate_to_velopack_install_is_skipped_once_the_sentinel_exists(monkeypatch, tmp_path):
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    popen = _stub_release_download(monkeypatch)
    updater._mark_migration_done()

    updater.migrate_to_velopack_install()

    popen.assert_not_called()


def test_migrate_to_velopack_install_hands_autostart_over_when_enabled(monkeypatch, tmp_path):
    """Setup.exe doesn't touch the `HKCU\\...\\Run` value, which still points
    at the legacy exe. Without re-registering it against the Velopack stub,
    the next boot launches the old exe, which sees the migration already done
    and exits -- autostart silently stops working."""
    from src import autostart

    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    _stub_release_download(monkeypatch)
    set_enabled = MagicMock()
    monkeypatch.setattr(autostart, "is_enabled", lambda: True)
    monkeypatch.setattr(autostart, "set_enabled", set_enabled)

    updater.migrate_to_velopack_install()

    set_enabled.assert_called_once_with(True)


def test_migrate_to_velopack_install_leaves_autostart_alone_when_disabled(monkeypatch, tmp_path):
    from src import autostart

    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    _stub_release_download(monkeypatch)
    set_enabled = MagicMock()
    monkeypatch.setattr(autostart, "is_enabled", lambda: False)
    monkeypatch.setattr(autostart, "set_enabled", set_enabled)

    updater.migrate_to_velopack_install()

    set_enabled.assert_not_called()


def test_migrate_to_velopack_install_survives_a_failing_autostart_handover(monkeypatch, tmp_path):
    """A failed registry write must not abort a migration whose install is
    already underway -- log and continue to marking it done."""
    from src import autostart

    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    _stub_release_download(monkeypatch)
    monkeypatch.setattr(autostart, "is_enabled", lambda: True)
    monkeypatch.setattr(autostart, "set_enabled", MagicMock(side_effect=OSError("registry locked")))

    updater.migrate_to_velopack_install()  # must not raise

    assert updater._is_migration_marked_done() is True


def test_migrate_to_velopack_install_does_not_raise_when_marking_done_fails(monkeypatch, tmp_path):
    """The Setup.exe has already been launched by the time `_mark_migration_done`
    runs, so a failure to persist the completion flag (e.g. a locked/unwritable
    config dir) must be logged and swallowed -- exactly like every other
    failure path in this function -- rather than propagate out of
    `migrate_to_velopack_install()` and crash the caller."""
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    monkeypatch.setattr(updater, "_is_migration_marked_done", lambda: False)

    release_response = MagicMock()
    release_response.json.return_value = {
        "tag_name": "v1.2.3",
        "assets": [
            {"name": updater._SETUP_ASSET_NAME, "browser_download_url": "https://example.com/Setup.exe"}
        ],
    }

    download_response = MagicMock()
    download_response.__enter__.return_value = download_response
    download_response.__exit__.return_value = False
    download_response.iter_content.return_value = [b"data"]

    def fake_get(url, **kwargs):
        if url == updater._LATEST_RELEASE_API_URL:
            return release_response
        return download_response

    monkeypatch.setattr(updater.requests, "get", fake_get)
    monkeypatch.setattr(updater.subprocess, "Popen", MagicMock())
    monkeypatch.setattr(updater, "_mark_migration_done", MagicMock(side_effect=OSError("locked")))

    updater.migrate_to_velopack_install()  # must not raise

    lines = read_last_update_log_lines()
    assert any("marking complete failed" in line for line in lines)


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
