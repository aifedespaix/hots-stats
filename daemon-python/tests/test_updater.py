import subprocess
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import requests

from src.updater import (
    AvailableUpdate,
    UpdatePhase,
    UpdateStatusTracker,
    _powershell_diagnostics,
    _render_relaunch_script,
    apply_update_and_exit,
    check_for_update,
    cleanup_stale_downloads,
    download_update,
    downloads_dir,
    find_update,
    installed_exe_path,
    manual_fallback_exe_path,
    manual_fallback_message,
    parse_version,
    perform_update,
    read_last_update_log_lines,
    stage_manual_fallback,
    trigger_manual_update,
    update_log_file_path,
    watch_for_updates,
)


@pytest.fixture(autouse=True)
def _no_real_temp_cleanup(monkeypatch):
    # `watch_for_updates` calls `cleanup_stale_downloads()` on every run;
    # stub it out so tests never touch the real machine's temp directory.
    monkeypatch.setattr("src.updater.cleanup_stale_downloads", lambda: None)


def _release(tag_name: str, assets: list[dict]) -> dict:
    return {"tag_name": tag_name, "assets": assets}


def _asset(name: str, url: str = "https://example.com/download") -> dict:
    return {"name": name, "browser_download_url": url}


def test_parse_version_plain():
    assert parse_version("1.2.3") == (1, 2, 3)


def test_parse_version_strips_v_prefix():
    assert parse_version("v1.2.3") == (1, 2, 3)


def test_parse_version_none_for_dev_build():
    assert parse_version("0.0.0-dev.abc1234") is None


def test_parse_version_none_for_empty():
    assert parse_version("") is None


def test_find_update_returns_none_when_up_to_date():
    release = _release("v1.0.0", [_asset("hots-analytics-daemon.exe")])
    assert find_update(release, "1.0.0") is None


def test_find_update_returns_none_when_current_is_newer():
    release = _release("v1.0.0", [_asset("hots-analytics-daemon.exe")])
    assert find_update(release, "1.2.0") is None


def test_find_update_returns_update_when_newer():
    """The asset itself is never versioned (see updater._ASSET_NAME) --
    the release's tag_name is the only source of truth for the version."""
    release = _release(
        "v1.2.0",
        [_asset("hots-analytics-daemon.exe", "https://example.com/asset.exe")],
    )
    update = find_update(release, "1.0.0")
    assert update == AvailableUpdate(
        version="1.2.0",
        download_url="https://example.com/asset.exe",
        asset_name="hots-analytics-daemon.exe",
    )


def test_find_update_ignores_unrelated_assets():
    release = _release(
        "v1.2.0",
        [_asset("checksums.txt"), _asset("hots-analytics-daemon.exe")],
    )
    update = find_update(release, "1.0.0")
    assert update is not None
    assert update.asset_name == "hots-analytics-daemon.exe"


def test_find_update_ignores_similarly_named_asset():
    """Exact match, not a prefix/suffix check -- a differently-purposed
    asset that merely starts with the same name (e.g. a future companion
    tool) must not be mistaken for the daemon build."""
    release = _release("v1.2.0", [_asset("hots-analytics-daemon-updater-helper.exe")])
    assert find_update(release, "1.0.0") is None


def test_find_update_none_when_no_matching_asset():
    release = _release("v1.2.0", [_asset("some-other-file.zip")])
    assert find_update(release, "1.0.0") is None


def test_find_update_none_for_dev_release_tag():
    release = _release("0.0.0-dev.abc1234", [_asset("hots-analytics-daemon.exe")])
    assert find_update(release, "1.0.0") is None


def _response(status_code: int, json_body: dict) -> MagicMock:
    resp = MagicMock(spec=requests.Response)
    resp.status_code = status_code
    resp.json.return_value = json_body
    resp.raise_for_status.return_value = None
    return resp


def test_check_for_update_returns_update():
    release = _release("v2.0.0", [_asset("hots-analytics-daemon.exe")])
    with patch("src.updater.requests.get", return_value=_response(200, release)):
        update = check_for_update("1.0.0")
    assert update is not None
    assert update.version == "2.0.0"


def test_check_for_update_none_on_network_error():
    with patch("src.updater.requests.get", side_effect=requests.ConnectionError("offline")):
        assert check_for_update("1.0.0") is None


def test_check_for_update_none_on_malformed_response():
    with patch("src.updater.requests.get", return_value=_response(200, {"unexpected": "shape"})):
        assert check_for_update("1.0.0") is None


# -- download_update ---------------------------------------------------------


class _FakeStreamingResponse:
    def __init__(self, chunks: list[bytes], content_length: str | None):
        self._chunks = chunks
        self.headers = {"Content-Length": content_length} if content_length is not None else {}

    def raise_for_status(self) -> None:
        pass

    def iter_content(self, chunk_size: int):
        return iter(self._chunks)

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False


def test_download_update_reports_progress_fraction(tmp_path):
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    response = _FakeStreamingResponse([b"1234567890", b"1234567890"], content_length="20")
    progress: list[float | None] = []

    with patch("src.updater.requests.get", return_value=response):
        dest = download_update(update, tmp_path, on_progress=progress.append)

    assert dest == tmp_path / "a.exe"
    assert dest.read_bytes() == b"12345678901234567890"
    assert progress == [0.5, 1.0]


def test_download_update_reports_none_progress_without_content_length(tmp_path):
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    response = _FakeStreamingResponse([b"data"], content_length=None)
    progress: list[float | None] = []

    with patch("src.updater.requests.get", return_value=response):
        download_update(update, tmp_path, on_progress=progress.append)

    assert progress == [None]


# -- installed_exe_path -------------------------------------------------


def test_installed_exe_path_returns_the_velopack_stub_path(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setattr("src.updater._PACK_ID", "hots-analytics-daemon")
    monkeypatch.setattr("src.updater._EXE_NAME", "hots-analytics-daemon.exe")

    result = installed_exe_path()

    assert result == tmp_path / "hots-analytics-daemon" / "hots-analytics-daemon.exe"


# -- manual fallback (stage_manual_fallback / manual_fallback_exe_path) --


def test_manual_fallback_exe_path_prefixes_the_installed_name(monkeypatch, tmp_path):
    monkeypatch.setattr("src.updater.installed_exe_path", lambda: tmp_path / "hots-analytics-daemon.exe")

    assert manual_fallback_exe_path() == tmp_path / "new-hots-analytics-daemon.exe"


def test_stage_manual_fallback_copies_next_to_the_installed_exe(monkeypatch, tmp_path):
    installed = tmp_path / "hots-analytics-daemon.exe"
    installed.write_bytes(b"old build")
    downloaded = tmp_path / "downloaded.exe"
    downloaded.write_bytes(b"new build")
    monkeypatch.setattr("src.updater.installed_exe_path", lambda: installed)

    result = stage_manual_fallback(downloaded)

    assert result == tmp_path / "new-hots-analytics-daemon.exe"
    assert result.read_bytes() == b"new build"
    # The installed .exe itself must be left completely untouched -- the
    # whole point is offering a manual alternative, not silently mutating
    # the build that's still the one actually running.
    assert installed.read_bytes() == b"old build"


def test_stage_manual_fallback_returns_none_without_raising_on_failure(monkeypatch, tmp_path):
    monkeypatch.setattr("src.updater.installed_exe_path", lambda: tmp_path / "hots-analytics-daemon.exe")

    assert stage_manual_fallback(tmp_path / "does-not-exist.exe") is None


def test_manual_fallback_message_names_the_real_files_and_version(monkeypatch, tmp_path):
    monkeypatch.setattr("src.updater.installed_exe_path", lambda: tmp_path / "hots-analytics-daemon.exe")
    fallback_path = tmp_path / "new-hots-analytics-daemon.exe"

    message = manual_fallback_message("2.0.0", fallback_path)

    assert "v2.0.0" in message
    assert "hots-analytics-daemon.exe" in message
    assert "new-hots-analytics-daemon.exe" in message
    # The concrete 3-step recovery: close the app, delete the old build,
    # launch the new one -- not just "something went wrong".
    assert "fermez" in message.lower()
    assert "supprimez" in message.lower()


# -- apply_update_and_exit -----------------------------------------------


def _fake_process(
    *, alive: bool, returncode: int | None = None, stdout: str = "", stderr: str = ""
) -> MagicMock:
    proc = MagicMock()
    proc.pid = 4242
    proc.poll.return_value = None if alive else (returncode if returncode is not None else 1)
    proc.returncode = returncode if returncode is not None else (None if alive else 1)
    proc.communicate.return_value = (stdout, stderr)
    return proc


def test_apply_update_and_exit_exits_when_relaunch_script_stays_alive(monkeypatch, tmp_path):
    monkeypatch.setattr("src.updater.installed_exe_path", lambda: tmp_path / "current.exe")
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    monkeypatch.setattr("src.updater._RELAUNCH_LIVENESS_CHECK_SECONDS", 0.05)
    monkeypatch.setattr("src.updater.subprocess.Popen", lambda *a, **k: _fake_process(alive=True))
    exit_mock = MagicMock()
    monkeypatch.setattr("src.updater.os._exit", exit_mock)

    apply_update_and_exit(tmp_path / "new.exe", version="2.0.0")

    exit_mock.assert_called_once_with(0)
    log_text = (tmp_path / "AppData" / "hots-analytics" / "update.log").read_text()
    assert "[v2.0.0]" in log_text
    assert "Handed off" in log_text


def test_apply_update_and_exit_aborts_when_relaunch_script_dies_immediately(monkeypatch, tmp_path):
    """The bug this guards against: `Popen` succeeding only means Windows
    accepted the request to start a process, not that it kept running --
    real-time antivirus killing an unsigned, freshly-spawned self-replace
    script within its first moment of life is a real failure mode. Before
    this check existed, the very next line unconditionally exited, so the
    app would vanish with nothing on disk to explain why."""
    monkeypatch.setattr("src.updater.installed_exe_path", lambda: tmp_path / "current.exe")
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    monkeypatch.setattr("src.updater._RELAUNCH_LIVENESS_CHECK_SECONDS", 0.05)
    monkeypatch.setattr("src.updater.subprocess.Popen", lambda *a, **k: _fake_process(alive=False, returncode=1))
    exit_mock = MagicMock()
    monkeypatch.setattr("src.updater.os._exit", exit_mock)

    result = apply_update_and_exit(tmp_path / "new.exe", version="2.0.0")

    assert result is False
    exit_mock.assert_not_called()
    log_text = (tmp_path / "AppData" / "hots-analytics" / "update.log").read_text()
    assert "[v2.0.0]" in log_text
    assert "antivirus" in log_text


def test_apply_update_and_exit_logs_captured_powershell_output_on_quick_exit(monkeypatch, tmp_path):
    """Previously the quick-exit log line was pure guesswork ("likely blocked
    by antivirus") because nothing PowerShell itself printed was ever
    captured. Whatever it wrote to stderr (an execution-policy or
    not-digitally-signed error, for instance) must now show up in
    update.log so a real failure has evidence behind it instead of a guess."""
    monkeypatch.setattr("src.updater.installed_exe_path", lambda: tmp_path / "current.exe")
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    monkeypatch.setattr("src.updater._RELAUNCH_LIVENESS_CHECK_SECONDS", 0.05)
    monkeypatch.setattr(
        "src.updater.subprocess.Popen",
        lambda *a, **k: _fake_process(
            alive=False,
            returncode=1,
            stderr="File ... cannot be loaded because running scripts is disabled on this system.",
        ),
    )
    exit_mock = MagicMock()
    monkeypatch.setattr("src.updater.os._exit", exit_mock)

    result = apply_update_and_exit(tmp_path / "new.exe", version="2.0.0")

    assert result is False
    log_text = (tmp_path / "AppData" / "hots-analytics" / "update.log").read_text()
    assert "cannot be loaded because running scripts is disabled" in log_text


def test_apply_update_and_exit_aborts_when_powershell_fails_to_launch(monkeypatch, tmp_path):
    monkeypatch.setattr("src.updater.installed_exe_path", lambda: tmp_path / "current.exe")
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))

    def _boom(*_a, **_k):
        raise OSError("powershell.exe not found")

    monkeypatch.setattr("src.updater.subprocess.Popen", _boom)
    exit_mock = MagicMock()
    monkeypatch.setattr("src.updater.os._exit", exit_mock)

    result = apply_update_and_exit(tmp_path / "new.exe", version="2.0.0")

    assert result is False
    exit_mock.assert_not_called()
    log_text = (tmp_path / "AppData" / "hots-analytics" / "update.log").read_text()
    assert "Could not launch" in log_text


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


# -- perform_update ---------------------------------------------------------


def test_perform_update_downloads_and_applies(monkeypatch):
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    status = UpdateStatusTracker()
    applied: list[Path] = []

    monkeypatch.setattr("src.updater.download_update", lambda *_a, **_k: Path("/tmp/fake.exe"))
    # In reality `apply_update_and_exit` never returns on success (the
    # process replaces itself) -- the mock returns True purely so
    # `perform_update`'s "did the handoff report failure?" check sees a
    # truthy value and leaves the status at INSTALLING, same as the real
    # never-returns case would.
    monkeypatch.setattr("src.updater.apply_update_and_exit", lambda p, version=None: applied.append(p) or True)

    assert perform_update(update, status) is True
    assert applied == [Path("/tmp/fake.exe")]
    assert status.snapshot().phase is UpdatePhase.INSTALLING


def test_perform_update_reports_error_when_relaunch_handoff_fails(monkeypatch, tmp_path):
    """`apply_update_and_exit` returning False means it aborted instead of
    exiting (see its docstring: e.g. antivirus killed the relaunch script
    within its first moment of life) -- the status must flip to ERROR
    instead of staying stuck on INSTALLING forever, which is what the
    settings window's Update tab would otherwise show indefinitely with no
    indication anything went wrong. Since this process is still alive in
    this failure mode (nothing has exited), it also stages the
    already-downloaded build next to the installed .exe -- see
    `stage_manual_fallback` -- so the status carries a `manual_fallback_path`
    the GUI can point an "Ouvrir le dossier" button at."""
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    status = UpdateStatusTracker()

    installed = tmp_path / "hots-analytics-daemon.exe"
    installed.write_bytes(b"old")
    downloaded = tmp_path / "downloaded.exe"
    downloaded.write_bytes(b"new")
    monkeypatch.setattr("src.updater.installed_exe_path", lambda: installed)
    monkeypatch.setattr("src.updater.download_update", lambda *_a, **_k: downloaded)
    monkeypatch.setattr("src.updater.apply_update_and_exit", lambda p, version=None: False)

    assert perform_update(update, status) is True
    snapshot = status.snapshot()
    assert snapshot.phase is UpdatePhase.ERROR
    assert snapshot.message
    assert snapshot.manual_fallback_path == tmp_path / "new-hots-analytics-daemon.exe"
    assert snapshot.manual_fallback_path.read_bytes() == b"new"
    assert "hots-analytics-daemon.exe" in snapshot.message
    assert "new-hots-analytics-daemon.exe" in snapshot.message
    assert "v2.0.0" in snapshot.message


def test_perform_update_falls_back_to_generic_message_when_staging_also_fails(monkeypatch, tmp_path):
    """If the handoff couldn't even start *and* staging the manual fallback
    also fails (e.g. the install folder itself is now unwritable), the
    status must still carry a useful message -- the original "retry next
    cycle" text -- rather than one referencing a file that was never
    actually written to disk."""
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    status = UpdateStatusTracker()

    monkeypatch.setattr("src.updater.installed_exe_path", lambda: tmp_path / "missing-dir" / "current.exe")
    monkeypatch.setattr("src.updater.download_update", lambda *_a, **_k: tmp_path / "does-not-exist.exe")
    monkeypatch.setattr("src.updater.apply_update_and_exit", lambda p, version=None: False)

    assert perform_update(update, status) is True
    snapshot = status.snapshot()
    assert snapshot.phase is UpdatePhase.ERROR
    assert snapshot.manual_fallback_path is None
    assert "antivirus" in snapshot.message
    assert "nouvel essai au prochain cycle" in snapshot.message


def test_perform_update_records_error_on_download_failure(monkeypatch):
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    status = UpdateStatusTracker()

    def _boom(*_a, **_k):
        raise requests.ConnectionError("offline")

    monkeypatch.setattr("src.updater.download_update", _boom)
    applied = MagicMock()
    monkeypatch.setattr("src.updater.apply_update_and_exit", applied)

    assert perform_update(update, status) is True
    applied.assert_not_called()
    snapshot = status.snapshot()
    assert snapshot.phase is UpdatePhase.ERROR
    assert "offline" in snapshot.message


def test_perform_update_records_error_on_download_os_error(monkeypatch):
    """`download_update` also touches disk (mkdir, writing the file) -- a
    disk-full/permission/AV-lock failure there raises OSError, not a
    requests exception, but must be just as non-fatal to the calling thread
    (see `perform_update`'s comment)."""
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    status = UpdateStatusTracker()

    def _boom(*_a, **_k):
        raise PermissionError("Access is denied")

    monkeypatch.setattr("src.updater.download_update", _boom)
    applied = MagicMock()
    monkeypatch.setattr("src.updater.apply_update_and_exit", applied)

    assert perform_update(update, status) is True
    applied.assert_not_called()
    snapshot = status.snapshot()
    assert snapshot.phase is UpdatePhase.ERROR
    assert "Access is denied" in snapshot.message


def test_perform_update_skips_when_already_in_progress(monkeypatch):
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    status = UpdateStatusTracker()
    status.try_begin("1.9.0")

    download = MagicMock()
    monkeypatch.setattr("src.updater.download_update", download)

    assert perform_update(update, status) is False
    download.assert_not_called()


def test_perform_update_progress_callback_updates_status(monkeypatch):
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    status = UpdateStatusTracker()
    seen_progress: list[float | None] = []

    def _fake_download(_update, _dest_dir, on_progress=None):
        on_progress(0.5)
        seen_progress.append(status.snapshot().progress)
        return Path("/tmp/fake.exe")

    monkeypatch.setattr("src.updater.download_update", _fake_download)
    monkeypatch.setattr("src.updater.apply_update_and_exit", lambda _p, version=None: True)

    perform_update(update, status)
    assert seen_progress == [0.5]


# -- trigger_manual_update ---------------------------------------------------


def _wait_until(predicate, timeout: float = 2.0) -> None:
    import time

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition never became true")


def test_trigger_manual_update_applies_when_available(monkeypatch):
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    status = UpdateStatusTracker()
    applied: list[Path] = []

    monkeypatch.setattr("src.updater.check_for_update", lambda: update)
    monkeypatch.setattr("src.updater.download_update", lambda *_a, **_k: Path("/tmp/fake.exe"))
    monkeypatch.setattr("src.updater.apply_update_and_exit", lambda p, version=None: applied.append(p) or True)

    trigger_manual_update(status)
    _wait_until(lambda: applied)

    assert applied == [Path("/tmp/fake.exe")]


def test_trigger_manual_update_reports_up_to_date(monkeypatch):
    status = UpdateStatusTracker()
    monkeypatch.setattr("src.updater.check_for_update", lambda: None)

    trigger_manual_update(status)
    _wait_until(lambda: status.snapshot().phase is UpdatePhase.IDLE and status.snapshot().message)

    assert status.snapshot().message == "Aucune mise à jour disponible."


def test_trigger_manual_update_logs_diagnostics_even_when_up_to_date(monkeypatch, tmp_path):
    """`apply_update_and_exit`'s diagnostics line only ever gets written
    during a real pending-update attempt, which needs a newer release to
    exist -- so a user already on the latest version would otherwise have no
    way to produce a fresh diagnostic short of waiting for the next release.
    The manual "Vérifier les mises à jour" button must double as an
    on-demand self-test regardless of whether an update is actually found."""
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    monkeypatch.setattr("src.updater.check_for_update", lambda: None)
    monkeypatch.setattr("src.updater._powershell_diagnostics", lambda: "powershell=fake stub output")
    status = UpdateStatusTracker()

    trigger_manual_update(status)
    _wait_until(lambda: status.snapshot().phase is UpdatePhase.IDLE and status.snapshot().message)

    log_text = (tmp_path / "AppData" / "hots-analytics" / "update.log").read_text()
    assert "Diagnostics: powershell=fake stub output" in log_text


# -- watch_for_updates --------------------------------------------------------


def test_watch_for_updates_notifies_and_auto_applies(monkeypatch):
    """`on_update_found` must fire once an update is confirmed, before the
    download/relaunch handoff -- this is what backs the tray notification
    in app.py, so the (fully automatic) self-update isn't invisible."""
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    applied: list[Path] = []
    status = UpdateStatusTracker()

    monkeypatch.setattr("src.updater.IS_FROZEN", True)
    monkeypatch.setattr("src.updater.check_for_update", lambda: update)
    monkeypatch.setattr("src.updater.download_update", lambda *_a, **_k: Path("/tmp/fake.exe"))
    monkeypatch.setattr("src.updater.apply_update_and_exit", lambda p, version=None: applied.append(p) or True)

    stop_event = threading.Event()
    found: list[AvailableUpdate] = []
    with patch.object(stop_event, "wait", side_effect=[False, True]):
        watch_for_updates(stop_event, status, on_update_found=found.append)

    assert found == [update]
    assert applied == [Path("/tmp/fake.exe")]


def test_watch_for_updates_notification_failure_does_not_block_update(monkeypatch):
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    applied: list[Path] = []
    status = UpdateStatusTracker()

    monkeypatch.setattr("src.updater.IS_FROZEN", True)
    monkeypatch.setattr("src.updater.check_for_update", lambda: update)
    monkeypatch.setattr("src.updater.download_update", lambda *_a, **_k: Path("/tmp/fake.exe"))
    monkeypatch.setattr("src.updater.apply_update_and_exit", lambda p, version=None: applied.append(p) or True)

    def _boom(_update: AvailableUpdate) -> None:
        raise RuntimeError("notification backend unavailable")

    stop_event = threading.Event()
    with patch.object(stop_event, "wait", side_effect=[False, True]):
        watch_for_updates(stop_event, status, on_update_found=_boom)

    assert applied == [Path("/tmp/fake.exe")]


def test_watch_for_updates_does_not_apply_when_auto_update_disabled(monkeypatch):
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    status = UpdateStatusTracker()

    monkeypatch.setattr("src.updater.IS_FROZEN", True)
    monkeypatch.setattr("src.updater.check_for_update", lambda: update)
    download = MagicMock()
    monkeypatch.setattr("src.updater.download_update", download)

    stop_event = threading.Event()
    found: list[AvailableUpdate] = []
    with patch.object(stop_event, "wait", side_effect=[False, True]):
        watch_for_updates(stop_event, status, auto_update_enabled=lambda: False, on_update_found=found.append)

    download.assert_not_called()
    assert found == [update]
    assert status.snapshot().phase is UpdatePhase.AVAILABLE
    assert status.snapshot().version == "2.0.0"


def test_watch_for_updates_notifies_only_once_per_version(monkeypatch):
    """With auto-update off, the same still-uninstalled version shouldn't
    re-trigger a tray notification on every 6h check cycle."""
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    status = UpdateStatusTracker()

    monkeypatch.setattr("src.updater.IS_FROZEN", True)
    monkeypatch.setattr("src.updater.check_for_update", lambda: update)

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


def test_watch_for_updates_cleans_up_stale_downloads_once_per_run(monkeypatch):
    status = UpdateStatusTracker()
    monkeypatch.setattr("src.updater.IS_FROZEN", True)
    monkeypatch.setattr("src.updater.check_for_update", lambda: None)
    cleanup = MagicMock()
    monkeypatch.setattr("src.updater.cleanup_stale_downloads", cleanup)

    stop_event = threading.Event()
    with patch.object(stop_event, "wait", side_effect=[True]):
        watch_for_updates(stop_event, status)

    cleanup.assert_called_once()


# -- downloads_dir / update_log_file_path ------------------------------------


def test_downloads_dir_is_under_the_system_temp_dir():
    assert downloads_dir().name == "hots-analytics-updates"
    assert downloads_dir().parent.exists()  # the system temp dir itself


def test_update_log_file_path_is_next_to_config_file(monkeypatch, tmp_path):
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))

    assert update_log_file_path() == tmp_path / "AppData" / "hots-analytics" / "update.log"


# -- cleanup_stale_downloads --------------------------------------------------


def test_cleanup_stale_downloads_removes_leftover_files(monkeypatch, tmp_path):
    stale_dir = tmp_path / "hots-analytics-updates"
    stale_dir.mkdir()
    (stale_dir / "old-build.exe").write_bytes(b"stale")
    monkeypatch.setattr("src.updater.downloads_dir", lambda: stale_dir)

    cleanup_stale_downloads()

    assert list(stale_dir.iterdir()) == []


def test_cleanup_stale_downloads_noop_when_dir_absent(tmp_path, monkeypatch):
    monkeypatch.setattr("src.updater.downloads_dir", lambda: tmp_path / "does-not-exist")

    cleanup_stale_downloads()  # must not raise


# -- read_last_update_log_lines -----------------------------------------------


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


# -- _render_relaunch_script --------------------------------------------------


def test_render_relaunch_script_includes_paths_version_and_retry_logic(tmp_path):
    script = _render_relaunch_script(
        pid=1234,
        new_exe=tmp_path / "new.exe",
        current_exe=tmp_path / "current.exe",
        script_path=tmp_path / "script.ps1",
        log_path=tmp_path / "update.log",
        version="2.0.0",
    )

    assert "Wait-Process -Id 1234" in script
    assert str(tmp_path / "new.exe") in script
    assert str(tmp_path / "current.exe") in script
    assert str(tmp_path / "update.log") in script
    assert "[v2.0.0]" in script
    assert "for ($attempt = 1; $attempt -le 10; $attempt++)" in script
    assert "Start-Process -FilePath" in script


def test_render_relaunch_script_falls_back_to_previous_version_on_copy_failure(tmp_path):
    """The bug this guards against: if Copy-Item never succeeds (e.g. a
    lingering antivirus lock on the freshly-downloaded build), the app must
    not just stay closed -- it should relaunch the untouched previous
    version instead, so a failed update degrades to "still on the old
    version" rather than "gone until the user notices and manually reruns
    an old installer"."""
    script = _render_relaunch_script(
        pid=1234,
        new_exe=tmp_path / "new.exe",
        current_exe=tmp_path / "current.exe",
        script_path=tmp_path / "script.ps1",
        log_path=tmp_path / "update.log",
        version="2.0.0",
    )

    assert "function Relaunch(" in script
    assert "if ($copied) {" in script
    assert "} else {" in script
    # Both the success and failure branches must call the same relaunch
    # helper against the (single, always-valid) current_exe path.
    assert script.count(f"Relaunch '{tmp_path / 'current.exe'}'") == 2
    assert "could not replace the running executable" in script


def test_render_relaunch_script_unblocks_before_relaunching(tmp_path):
    """`Start-Process` with a bare -FilePath goes through the same
    ShellExecute path as an Explorer double-click, so a Mark-of-the-Web left
    over on the installed .exe (it usually lives wherever the user's browser
    first downloaded it) could silently reproduce the SmartScreen prompt on
    every self-relaunch. Stripping it first avoids that regardless of where
    the installed .exe lives."""
    script = _render_relaunch_script(
        pid=1234,
        new_exe=tmp_path / "new.exe",
        current_exe=tmp_path / "current.exe",
        script_path=tmp_path / "script.ps1",
        log_path=tmp_path / "update.log",
        version="2.0.0",
    )

    assert "Unblock-File -LiteralPath $exePath" in script


def test_render_relaunch_script_path_arguments_are_single_quoted(tmp_path):
    """Paths are interpolated with single quotes, not double quotes: a `$`
    in a username or folder name is valid on Windows but is PowerShell
    variable-expansion syntax inside a double-quoted string, which would
    silently corrupt the path."""
    current_exe = tmp_path / "current.exe"
    new_exe = tmp_path / "new.exe"
    script = _render_relaunch_script(
        pid=1234,
        new_exe=new_exe,
        current_exe=current_exe,
        script_path=tmp_path / "script.ps1",
        log_path=tmp_path / "update.log",
        version="2.0.0",
    )

    assert f"'{current_exe}'" in script
    assert f'"{current_exe}"' not in script
    assert f"'{new_exe}'" in script
    assert f'"{new_exe}"' not in script


# -- _render_relaunch_script: manual fallback on copy failure -------------


def test_render_relaunch_script_stages_manual_fallback_next_to_current_exe(tmp_path):
    """The bug this guards against: when `Copy-Item` never succeeds, the
    already-downloaded, perfectly valid build used to just sit in a temp
    folder nobody has a reason to look in. The copy-failure branch must now
    also stage it right next to the .exe that's still running, under a
    "new-" prefixed name, so a player who goes looking finds it in the one
    place they'd already know to check."""
    current_exe = tmp_path / "hots-analytics-daemon.exe"
    new_exe = tmp_path / "new.exe"
    script = _render_relaunch_script(
        pid=1234,
        new_exe=new_exe,
        current_exe=current_exe,
        script_path=tmp_path / "script.ps1",
        log_path=tmp_path / "update.log",
        version="2.0.0",
    )

    fallback_exe = tmp_path / "new-hots-analytics-daemon.exe"
    assert f"Copy-Item -LiteralPath '{new_exe}' -Destination '{fallback_exe}' -Force" in script
    # Only in the copy-failed ("could not replace the running executable")
    # branch -- the successful-copy branch must not also stage a fallback,
    # there's nothing left to offer a manual alternative to.
    assert script.index("could not replace the running executable") < script.index(str(fallback_exe))


def test_render_relaunch_script_manual_fallback_dialog_guarded_by_test_path(tmp_path):
    """Without this guard, a machine with a persistent block (antivirus,
    Smart App Control) would re-pop the manual-install dialog on every
    single 6-hour retry, forever -- `Test-Path` on the destination before
    staging is what keeps a player from being nagged about the same
    already-staged file over and over."""
    script = _render_relaunch_script(
        pid=1234,
        new_exe=tmp_path / "new.exe",
        current_exe=tmp_path / "current.exe",
        script_path=tmp_path / "script.ps1",
        log_path=tmp_path / "update.log",
        version="2.0.0",
    )

    assert "$fallbackAlreadyStaged = Test-Path -LiteralPath" in script
    assert "if (-not $fallbackAlreadyStaged) {" in script


def test_render_relaunch_script_shows_a_message_box_offering_to_open_explorer(tmp_path):
    current_exe = tmp_path / "current.exe"
    script = _render_relaunch_script(
        pid=1234,
        new_exe=tmp_path / "new.exe",
        current_exe=current_exe,
        script_path=tmp_path / "script.ps1",
        log_path=tmp_path / "update.log",
        version="2.0.0",
    )

    assert "Add-Type -AssemblyName System.Windows.Forms" in script
    assert "[System.Windows.Forms.MessageBox]::Show(" in script
    assert "[System.Windows.Forms.MessageBoxButtons]::YesNo" in script
    assert f"Start-Process -FilePath 'explorer.exe' -ArgumentList '{current_exe.parent}'" in script
    # Showing the dialog itself is best-effort -- a machine missing the
    # WinForms assembly (unlikely, but see this module's general "never let
    # a diagnostic/notification nicety break the core recovery flow"
    # philosophy) must not stop the copy/relaunch logic above it.
    assert 'Log "Could not show the manual-install dialog:' in script


def test_render_relaunch_script_manual_fallback_message_names_the_real_files(tmp_path):
    current_exe = tmp_path / "hots-analytics-daemon.exe"
    script = _render_relaunch_script(
        pid=1234,
        new_exe=tmp_path / "new.exe",
        current_exe=current_exe,
        script_path=tmp_path / "script.ps1",
        log_path=tmp_path / "update.log",
        version="2.0.0",
    )

    assert "v2.0.0" in script
    assert "« hots-analytics-daemon.exe »" in script
    assert "« new-hots-analytics-daemon.exe »" in script
    assert "fermez HotS Analytics" in script


def test_render_relaunch_script_manual_fallback_message_escapes_apostrophes(tmp_path):
    """The message is single-quoted PowerShell (see the "path arguments are
    single-quoted" test above for why single- over double-quoted), and it's
    natural French prose full of apostrophes ("n'a pas pu", "l'application")
    -- each one must be doubled or it would prematurely close the string
    literal and corrupt the script."""
    script = _render_relaunch_script(
        pid=1234,
        new_exe=tmp_path / "new.exe",
        current_exe=tmp_path / "current.exe",
        script_path=tmp_path / "script.ps1",
        log_path=tmp_path / "update.log",
        version="2.0.0",
    )

    assert "n''a pas pu s''installer automatiquement" in script
    assert "l''application précédente a été relancée" in script
    # A raw, unescaped apostrophe from the message text would break the
    # literal it lives in -- none of the message's own contractions should
    # ever appear un-doubled.
    assert "n'a pas pu s'installer" not in script


def test_powershell_diagnostics_reports_missing_when_not_on_path(monkeypatch):
    monkeypatch.setattr("src.updater.shutil.which", lambda _name: None)

    assert _powershell_diagnostics() == "powershell.exe not found on PATH"


def test_powershell_diagnostics_reports_probe_output(monkeypatch):
    monkeypatch.setattr("src.updater.shutil.which", lambda _name: r"C:\Windows\System32\powershell.exe")
    fake_result = MagicMock(
        returncode=0,
        stdout="PSVersion=5.1.19041.1 PSEdition=Desktop ExecutionPolicy=[MachinePolicy=Undefined, "
        "UserPolicy=Undefined, Process=Undefined, CurrentUser=Undefined, LocalMachine=RemoteSigned] "
        "SmartAppControl(0=off,1=on,2=audit,n/a=no-such-key)=n/a\n",
        stderr="",
    )
    monkeypatch.setattr("src.updater.subprocess.run", lambda *a, **k: fake_result)

    output = _powershell_diagnostics()

    assert output.startswith(r"powershell=C:\Windows\System32\powershell.exe (exit 0)")
    assert "ExecutionPolicy=[" in output
    assert "SmartAppControl" in output


def test_powershell_diagnostics_redirects_stdin(monkeypatch):
    """Regression test: this process has no console (frozen, windowed
    build), so its own stdin is not a valid inheritable handle. Leaving
    `stdin` on the default "inherit from parent" makes `subprocess.run`
    raise `OSError: [WinError 6] The handle is invalid` on exactly that kind
    of build -- which is what turned this probe into dead weight (a
    "probe failed" line instead of real diagnostics) until this was fixed."""
    monkeypatch.setattr("src.updater.shutil.which", lambda _name: "powershell.exe")
    calls: list[dict] = []

    def _fake_run(*_args, **kwargs):
        calls.append(kwargs)
        return MagicMock(returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr("src.updater.subprocess.run", _fake_run)

    _powershell_diagnostics()

    assert calls[0]["stdin"] == subprocess.DEVNULL


def test_powershell_diagnostics_falls_back_to_stderr_when_stdout_empty(monkeypatch):
    monkeypatch.setattr("src.updater.shutil.which", lambda _name: "powershell.exe")
    fake_result = MagicMock(returncode=1, stdout="", stderr="Access is denied.")
    monkeypatch.setattr("src.updater.subprocess.run", lambda *a, **k: fake_result)

    assert "Access is denied." in _powershell_diagnostics()


def test_powershell_diagnostics_handles_probe_failure_without_raising(monkeypatch):
    monkeypatch.setattr("src.updater.shutil.which", lambda _name: "powershell.exe")

    def _boom(*_a, **_k):
        raise OSError("blocked")

    monkeypatch.setattr("src.updater.subprocess.run", _boom)

    output = _powershell_diagnostics()

    assert "probe failed" in output
    assert "blocked" in output


def test_powershell_diagnostics_handles_timeout(monkeypatch):
    monkeypatch.setattr("src.updater.shutil.which", lambda _name: "powershell.exe")

    def _boom(*_a, **_k):
        raise subprocess.TimeoutExpired(cmd="powershell.exe", timeout=10)

    monkeypatch.setattr("src.updater.subprocess.run", _boom)

    assert "probe failed" in _powershell_diagnostics()


def test_apply_update_and_exit_logs_diagnostics_line(monkeypatch, tmp_path):
    """The diagnostics line must be written on every attempt, success or
    failure, so a report from the user always carries this context."""
    monkeypatch.setattr("src.updater.installed_exe_path", lambda: tmp_path / "current.exe")
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    monkeypatch.setattr("src.updater._RELAUNCH_LIVENESS_CHECK_SECONDS", 0.05)
    monkeypatch.setattr("src.updater.subprocess.Popen", lambda *a, **k: _fake_process(alive=True))
    monkeypatch.setattr("src.updater._powershell_diagnostics", lambda: "powershell=fake stub output")
    monkeypatch.setattr("src.updater.os._exit", MagicMock())

    apply_update_and_exit(tmp_path / "new.exe", version="2.0.0")

    log_text = (tmp_path / "AppData" / "hots-analytics" / "update.log").read_text()
    assert "Diagnostics: powershell=fake stub output" in log_text


def test_render_relaunch_script_logs_whether_relaunch_survived(tmp_path):
    """`Start-Process` doesn't wait, so on its own it can't tell "relaunched
    and running" apart from "relaunched but killed a moment later by
    antivirus/SmartScreen" -- capturing the process (`-PassThru`) and
    checking back after a short wait is what makes that distinction show up
    in update.log instead of every relaunch just logging "successfully"
    regardless of what actually happened next."""
    script = _render_relaunch_script(
        pid=1234,
        new_exe=tmp_path / "new.exe",
        current_exe=tmp_path / "current.exe",
        script_path=tmp_path / "script.ps1",
        log_path=tmp_path / "update.log",
        version="2.0.0",
    )

    assert "-PassThru" in script
    assert "HasExited" in script
