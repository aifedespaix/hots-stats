"""Entrypoint for the HotS Analytics replay daemon.

Usage:
    python -m src.main                 # watch the replays folder continuously
    python -m src.main --resync        # parse + upload every replay already on disk, then exit
    python -m src.main --resync <dir>  # same, but scanning <dir> instead of the configured folder
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from . import api_client
from . import parser as replay_parser
from .config import ConfigError, load_config
from .watcher import watch_replays

logger = logging.getLogger(__name__)


def _ingest_file(client: api_client.ApiClient, path: Path) -> None:
    try:
        payload = replay_parser.parse_replay(path)
    except replay_parser.ReplayParseError as err:
        logger.warning("Skipping %s: %s", path, err)
        return

    try:
        result = client.post_replay(payload)
    except api_client.AuthError as err:
        # Every subsequent request will fail the same way, but the watcher
        # callback runs on a background thread, so we can only log loudly
        # here and keep going rather than cleanly stop the daemon.
        logger.error("%s", err)
        return
    except api_client.ValidationError as err:
        logger.error("Server rejected %s: %s (detail: %s)", path, err, err.detail)
        return
    except api_client.ApiClientError as err:
        logger.error("Failed to ingest %s: %s", path, err)
        return

    if result.upserted:
        logger.info("Ingested %s -> match %s", path, result.match_id)
    else:
        logger.info("Skipped %s (%s)", path, result.reason)


def resync(client: api_client.ApiClient, replays_dir: Path) -> None:
    """Parses and (re-)uploads every replay in `replays_dir`.

    Safe to run repeatedly: the API upserts by `replayHash`, so re-posting
    an already-ingested replay is a no-op rather than a duplicate.
    """
    replay_files = sorted(replays_dir.glob("*.StormReplay"))
    logger.info("Resyncing %d replay(s) from %s", len(replay_files), replays_dir)
    for path in replay_files:
        _ingest_file(client, path)


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

    try:
        config = load_config()
    except ConfigError as err:
        logger.error("%s", err)
        return 1

    client = api_client.ApiClient(config)

    if args.resync:
        target_dir = Path(args.resync) if isinstance(args.resync, str) else config.replays_dir
        resync(client, target_dir)
        return 0

    watch_replays(config.replays_dir, lambda path: _ingest_file(client, path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
