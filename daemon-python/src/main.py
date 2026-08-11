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

from . import api_client
from .config import ConfigError, load_config
from .ingestion import resync

logger = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> int:
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
        target_dir = Path(args.resync) if isinstance(args.resync, str) else config.replays_dir
        resync(client, target_dir)
        return 0

    # Default (no flags): the tray app — settings window on first run (or
    # when the config is invalid/incomplete), then a tray icon with the sync
    # daemon running on a background thread. See app.py for the full flow.
    from .app import run_app

    return run_app()


if __name__ == "__main__":
    raise SystemExit(main())
