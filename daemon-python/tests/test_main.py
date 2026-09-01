"""`main()`'s argument handling around the one-time Velopack migration shim.

The shim downloads and launches a real installer, so it must only ever run
on the normal tray-launch path -- never as a side effect of `--help` or
`--resync`. It used to be checked before `argparse` ran at all, which made
both of those silently perform a migration instead of their actual job (and
would have turned CI's `hots-analytics-daemon.exe --help` smoke test into a
live installer launch on the runner).
"""

from unittest.mock import MagicMock

import pytest

from src import main as main_module


@pytest.fixture(autouse=True)
def _legacy_install(monkeypatch):
    """Pretend every run is a legacy (pre-Velopack) install, so the ordering
    is what's under test rather than the predicate."""
    monkeypatch.setattr(main_module.updater, "is_running_from_legacy_install", lambda: True)
    migrate = MagicMock()
    monkeypatch.setattr(main_module.updater, "migrate_to_velopack_install", migrate)
    return migrate


def test_help_does_not_trigger_a_migration(_legacy_install, capsys):
    with pytest.raises(SystemExit) as exit_info:
        main_module.main(["--help"])

    assert exit_info.value.code == 0
    assert "--resync" in capsys.readouterr().out
    _legacy_install.assert_not_called()


def test_resync_does_not_trigger_a_migration(_legacy_install, monkeypatch, tmp_path):
    """`--resync` must do its own job. Config loading is left to fail here
    (no config in a temp `%APPDATA%`), which is enough to prove control
    reached the resync branch rather than the migration."""
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    monkeypatch.delenv("HOTS_API_BASE_URL", raising=False)
    monkeypatch.delenv("HOTS_ACCESS_TOKEN", raising=False)

    assert main_module.main(["--resync", str(tmp_path / "replays")]) == 1
    _legacy_install.assert_not_called()


def test_tray_launch_migrates_and_exits_without_starting_the_app(_legacy_install, monkeypatch):
    """The one path the shim is for: no flags. It must migrate and return
    without also starting the tray/sync from the legacy location."""
    run_app = MagicMock(return_value=0)
    monkeypatch.setattr("src.app.run_app", run_app)

    assert main_module.main([]) == 0
    _legacy_install.assert_called_once()
    run_app.assert_not_called()
