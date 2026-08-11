"""Stable, content-based hashing of replay files.

A HotS replay file is never rewritten in place once the game finishes
writing it, so hashing the raw bytes is enough to get a value that's
identical across `--resync` runs of the same file and stable regardless of
filesystem metadata (mtime, path, etc).
"""

from __future__ import annotations

import hashlib
from pathlib import Path

_CHUNK_SIZE = 1024 * 1024


def hash_replay_file(path: Path) -> str:
    """Returns the SHA-256 hex digest of the replay file's contents."""
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(_CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()
