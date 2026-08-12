import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import requests

from src.updater import (
    AvailableUpdate,
    UpdatePhase,
    UpdateStatusTracker,
    check_for_update,
    download_update,
    find_update,
    installed_exe_path,
    parse_version,
    perform_update,
    trigger_manual_update,
    watch_for_updates,
)


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
    release = _release("v1.0.0", [_asset("hots-analytics-daemon-v1.0.0.exe")])
    assert find_update(release, "1.0.0") is None


def test_find_update_returns_none_when_current_is_newer():
    release = _release("v1.0.0", [_asset("hots-analytics-daemon-v1.0.0.exe")])
    assert find_update(release, "1.2.0") is None


def test_find_update_returns_update_when_newer():
    release = _release(
        "v1.2.0",
        [_asset("hots-analytics-daemon-v1.2.0.exe", "https://example.com/asset.exe")],
    )
    update = find_update(release, "1.0.0")
    assert update == AvailableUpdate(
        version="1.2.0",
        download_url="https://example.com/asset.exe",
        asset_name="hots-analytics-daemon-v1.2.0.exe",
    )


def test_find_update_ignores_non_exe_assets():
    release = _release(
        "v1.2.0",
        [_asset("checksums.txt"), _asset("hots-analytics-daemon-v1.2.0.exe")],
    )
    update = find_update(release, "1.0.0")
    assert update is not None
    assert update.asset_name == "hots-analytics-daemon-v1.2.0.exe"


def test_find_update_none_when_no_matching_asset():
    release = _release("v1.2.0", [_asset("some-other-file.zip")])
    assert find_update(release, "1.0.0") is None


def test_find_update_none_for_dev_release_tag():
    release = _release("0.0.0-dev.abc1234", [_asset("hots-analytics-daemon-v0.0.0-dev.abc1234.exe")])
    assert find_update(release, "1.0.0") is None


def _response(status_code: int, json_body: dict) -> MagicMock:
    resp = MagicMock(spec=requests.Response)
    resp.status_code = status_code
    resp.json.return_value = json_body
    resp.raise_for_status.return_value = None
    return resp


def test_check_for_update_returns_update():
    release = _release("v2.0.0", [_asset("hots-analytics-daemon-v2.0.0.exe")])
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


def test_installed_exe_path_prefers_onefile_binary_env(monkeypatch, tmp_path):
    real_exe = tmp_path / "hots-analytics-daemon.exe"
    real_exe.write_bytes(b"")
    monkeypatch.setenv("NUITKA_ONEFILE_BINARY", str(real_exe))

    assert installed_exe_path() == real_exe.resolve()


def test_installed_exe_path_falls_back_to_sys_executable(monkeypatch):
    monkeypatch.delenv("NUITKA_ONEFILE_BINARY", raising=False)
    monkeypatch.setattr("src.updater.sys.executable", "/tmp/fake-python")

    assert installed_exe_path() == Path("/tmp/fake-python").resolve()


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


# -- perform_update ---------------------------------------------------------


def test_perform_update_downloads_and_applies(monkeypatch):
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    status = UpdateStatusTracker()
    applied: list[Path] = []

    monkeypatch.setattr("src.updater.download_update", lambda *_a, **_k: Path("/tmp/fake.exe"))
    monkeypatch.setattr("src.updater.apply_update_and_exit", applied.append)

    assert perform_update(update, status) is True
    assert applied == [Path("/tmp/fake.exe")]
    assert status.snapshot().phase is UpdatePhase.INSTALLING


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
    monkeypatch.setattr("src.updater.apply_update_and_exit", lambda _p: None)

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
    monkeypatch.setattr("src.updater.apply_update_and_exit", applied.append)

    trigger_manual_update(status)
    _wait_until(lambda: applied)

    assert applied == [Path("/tmp/fake.exe")]


def test_trigger_manual_update_reports_up_to_date(monkeypatch):
    status = UpdateStatusTracker()
    monkeypatch.setattr("src.updater.check_for_update", lambda: None)

    trigger_manual_update(status)
    _wait_until(lambda: status.snapshot().phase is UpdatePhase.IDLE and status.snapshot().message)

    assert status.snapshot().message == "Aucune mise à jour disponible."


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
    monkeypatch.setattr("src.updater.apply_update_and_exit", applied.append)

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
    monkeypatch.setattr("src.updater.apply_update_and_exit", applied.append)

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
