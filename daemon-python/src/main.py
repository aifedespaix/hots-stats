"""Entrypoint for the HotS Analytics replay daemon.

Usage:
    python -m src.main                 # tray app: settings window on first run, then tray icon + background sync
    python -m src.main --resync        # headless: parse + upload every replay already on disk, then exit
    python -m src.main --resync <dir>  # same, but scanning <dir> instead of the configured folder
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from . import accounts_discovery, api_client, ui_kit, updater
from .accounts_discovery import WatchDir
from .config import ConfigError, load_config
from .ingestion import resync, sync_spatial_calibrations
from .sync_state import SyncState

logger = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> int:
    ui_kit.set_dpi_awareness()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    arg_parser = argparse.ArgumentParser(description="HotS Analytics replay daemon")
    arg_parser.add_argument(
        "--resync",
        nargs="?",
        const=True,
        default=False,
        metavar="DIR",
        help="Parse and upload every replay already in the replays folder (or DIR, if given), then exit.",
    )
    args = arg_parser.parse_args(argv)

    if args.resync:
        try:
            config = load_config()
        except ConfigError as err:
            logger.error("%s", err)
            return 1
        client = api_client.ApiClient(config)
        if isinstance(args.resync, str):
            # An explicit folder wins over discovery: still "just this one".
            watch_dirs = [WatchDir(Path(args.resync), None)]
        else:
            watch_dirs = accounts_discovery.watch_dirs(config.hots_dir, config.extra_replay_dirs)
        sync_state = SyncState()
        # Reuses the same calibration sync as the tray daemon's startup
        # (ingestion.sync_spatial_calibrations) instead of a bare fetch, so
        # a manual --resync also invalidates (and thus reparses) any map
        # that was newly or re-calibrated since the last run, not just
        # fetch calibrations for parsing replays that were already pending.
        calibrations = sync_spatial_calibrations(config, sync_state)
        resync(client, watch_dirs, sync_state, calibrations=calibrations)
        return 0

    # One-time pre-Velopack -> Velopack migration shim (TEMPORARY -- see
    # updater.py's `migrate_to_velopack_install` docstring and
    # docs/superpowers/plans/2026-08-31-daemon-velopack-auto-update.md, Task
    # 6, for why this exists and when to delete it). It's a no-op (returns
    # False immediately) for every normal Velopack install and every local
    # dev run, so this costs nothing outside the one legacy-install case it
    # exists for.
    #
    # Deliberately placed *after* `parse_args` and after the `--resync`
    # branch, not at the top of `main()`: migrating downloads and launches a
    # real installer, which must never be what `--help` or `--resync` does.
    # (`--help` exits inside `parse_args`; `--resync` returns above.) Unlike
    # `run.py`'s `velopack.App().run()` hook -- which genuinely must precede
    # every import -- this check only needs to precede `run_app()`.
    if updater.is_running_from_legacy_install():
        updater.migrate_to_velopack_install()
        return 0  # this run's only job was migrating; don't also start the tray/sync

    # Default (no flags): the tray app — settings window on first run (or
    # when the config is invalid/incomplete), then a tray icon with the sync
    # daemon running on a background thread. See app.py for the full flow.
    from .app import run_app

    return run_app()


if __name__ == "__main__":
    raise SystemExit(main())
