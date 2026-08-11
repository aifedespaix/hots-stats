import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import requests

from src.updater import AvailableUpdate, check_for_update, find_update, parse_version, watch_for_updates


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


def test_watch_for_updates_notifies_before_applying(monkeypatch):
    """`on_update_found` must fire once an update is confirmed, before the
    download/relaunch handoff -- this is what backs the tray notification
    in app.py, so the (fully automatic) self-update isn't invisible."""
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    applied: list[Path] = []

    monkeypatch.setattr("src.updater.IS_FROZEN", True)
    monkeypatch.setattr("src.updater.check_for_update", lambda: update)
    monkeypatch.setattr("src.updater.download_update", lambda *_a, **_k: Path("/tmp/fake.exe"))
    monkeypatch.setattr("src.updater.apply_update_and_exit", applied.append)

    stop_event = threading.Event()
    found: list[AvailableUpdate] = []
    with patch.object(stop_event, "wait", side_effect=[False, True]):
        watch_for_updates(stop_event, on_update_found=found.append)

    assert found == [update]
    assert applied == [Path("/tmp/fake.exe")]


def test_watch_for_updates_notification_failure_does_not_block_update(monkeypatch):
    update = AvailableUpdate(version="2.0.0", download_url="https://example.com/a.exe", asset_name="a.exe")
    applied: list[Path] = []

    monkeypatch.setattr("src.updater.IS_FROZEN", True)
    monkeypatch.setattr("src.updater.check_for_update", lambda: update)
    monkeypatch.setattr("src.updater.download_update", lambda *_a, **_k: Path("/tmp/fake.exe"))
    monkeypatch.setattr("src.updater.apply_update_and_exit", applied.append)

    def _boom(_update: AvailableUpdate) -> None:
        raise RuntimeError("notification backend unavailable")

    stop_event = threading.Event()
    with patch.object(stop_event, "wait", side_effect=[False, True]):
        watch_for_updates(stop_event, on_update_found=_boom)

    assert applied == [Path("/tmp/fake.exe")]
