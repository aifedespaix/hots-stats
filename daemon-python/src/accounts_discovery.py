"""Discovers every Heroes of the Storm account folder that can hold replays.

The layout is::

    Documents/Heroes of the Storm/Accounts/<battlenetAccountId>/<toonHandle>/Replays/<queue>/

The folder named <toonHandle> is exactly the string that parser._toon_handle()
builds (<region>-Hero-<realm>-<id>), and the same identity the replay's own
player list uses -- which is what makes "which account wrote this replay?"
deterministic rather than a guess.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class AccountFolder:
    """One local HotS account, as found on disk."""

    account_id: str
    toon_handle: str
    replays_dir: Path


@dataclass(frozen=True)
class WatchDir:
    """One directory to watch, tagged with the account that wrote into it."""

    path: Path
    # None for a manually-configured extra folder: no account can be derived
    # from it, so those replays upload without a selfBattletag.
    toon_handle: str | None


def discover_account_folders(hots_dir: Path) -> list[AccountFolder]:
    """Every Accounts/<id>/<toon>/Replays folder under hots_dir, sorted."""
    accounts_root = hots_dir / "Accounts"
    if not accounts_root.is_dir():
        return []

    found: list[AccountFolder] = []
    for account in sorted(accounts_root.iterdir()):
        if not account.is_dir():
            continue
        for toon in sorted(account.iterdir()):
            # "2-Hero-1-4929240": the toon handle, not a sibling like Hotkeys/.
            if not toon.is_dir() or "-Hero-" not in toon.name:
                continue
            replays = toon / "Replays"
            if replays.is_dir():
                found.append(AccountFolder(account.name, toon.name, replays))
    return found


def replay_queues(replays_dir: Path) -> list[Path]:
    """The per-queue subfolders (Multiplayer, Custom, ...) of a Replays folder."""
    try:
        queues = [path for path in sorted(replays_dir.iterdir()) if path.is_dir()]
    except OSError:
        return []
    return queues or [replays_dir]


def watch_dirs(hots_dir: Path, extra_replay_dirs: Iterable[Path] = ()) -> list[WatchDir]:
    """Every directory to watch, deduped, each tagged with its account toon."""
    dirs: list[WatchDir] = []
    seen: set[str] = set()

    for folder in discover_account_folders(hots_dir):
        for queue in replay_queues(folder.replays_dir):
            key = str(queue)
            if key in seen:
                continue
            seen.add(key)
            dirs.append(WatchDir(queue, folder.toon_handle))

    for extra in extra_replay_dirs:
        if not extra.is_dir() or str(extra) in seen:
            continue
        seen.add(str(extra))
        dirs.append(WatchDir(extra, None))

    return dirs
