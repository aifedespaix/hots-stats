"""Local persistence of "this replay is already synced" state, backed by
SQLite (not JSON) so that:

- Marking one replay synced/errored is a single indexed row write, not a
  full-file rewrite of every replay ever seen (what the old `synced.json`
  did on every `mark_synced` call) -- this matters once a player has
  thousands of replays on disk.
- The "debug" report (see gui.py's Debug button) can just `SELECT * WHERE
  status = 'error'` instead of scanning a blob in memory.
- Per-replay metadata (file path, last error + full traceback, which API
  version it was synced against, whether the source file still exists) has
  somewhere structured to live, instead of being bolted onto a
  hash -> version dict.

Without any of this, `_run_sync_loop` (app.py) re-parses (CPU-heavy
`heroprotocol` decode) and re-POSTs every `.StormReplay` file on disk on
every daemon restart -- the server no-ops the write via `replayHash`, but
the daemon redoes all the work to find that out, every single time.

`invalidate_stale` is the other half of this: the API (not the daemon)
decides when previously-synced replays are stale and need reprocessing --
see `app.py`'s `_sync_api_version`, which calls it with the
`minParserVersion` the API reports from `GET /ingest/version` on every
daemon startup.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .config import config_file_path

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS replays (
    replay_hash TEXT PRIMARY KEY,
    file_path TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('synced', 'error')),
    parser_version TEXT,
    api_version TEXT,
    match_id TEXT,
    synced_at TEXT,
    last_attempt_at TEXT NOT NULL,
    error_message TEXT,
    error_log TEXT,
    file_exists INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_replays_status ON replays(status);

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def sync_state_file_path() -> Path:
    """Path to the local sync-state database, next to `config.json`."""
    return config_file_path().with_name("sync_state.db")


def _version_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(part) if part.isdigit() else 0 for part in version.split("."))


def _version_gte(a: str, b: str) -> bool:
    return _version_tuple(a) >= _version_tuple(b)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass(frozen=True)
class ReplayErrorRecord:
    """One failed replay, as shown in the Debug window (gui.py)."""

    replay_hash: str
    file_path: str
    last_attempt_at: str
    error_message: str | None
    error_log: str | None
    file_exists: bool


class SyncState:
    """Tracks, per replay (keyed by content hash), whether it's synced or
    errored, at which parser/API version, when, and (for errors) why --
    persisted to a SQLite file so progress and error detail survive an
    unexpected exit rather than only being saved on clean shutdown.
    """

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or sync_state_file_path()
        self._lock = threading.Lock()
        self._conn = self._open()

    def _open(self) -> sqlite3.Connection:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self._path), check_same_thread=False)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(_SCHEMA)
        except sqlite3.DatabaseError as err:
            # Corrupt or pre-SQLite (old JSON) file at this path -- start
            # fresh rather than crash the daemon over a lost cache; the
            # worst case is replays already on the server get reparsed and
            # re-POSTed once, which the API upserts as a no-op.
            logger.warning("Sync state at %s is unreadable, starting fresh: %s", self._path, err)
            conn.close()
            try:
                self._path.unlink()
            except OSError:
                pass
            conn = sqlite3.connect(str(self._path), check_same_thread=False)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(_SCHEMA)
        return conn

    # -- sync status ----------------------------------------------------

    def is_up_to_date(self, replay_hash: str, parser_version: str) -> bool:
        """True if `replay_hash` was already synced at `parser_version` or newer."""
        with self._lock:
            row = self._conn.execute(
                "SELECT parser_version FROM replays WHERE replay_hash = ? AND status = 'synced'",
                (replay_hash,),
            ).fetchone()
        if row is None or row[0] is None:
            return False
        return _version_gte(row[0], parser_version)

    def mark_synced(
        self,
        replay_hash: str,
        parser_version: str,
        *,
        file_path: str = "",
        api_version: str | None = None,
        match_id: str | None = None,
    ) -> None:
        now = _now()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO replays
                    (replay_hash, file_path, status, parser_version, api_version,
                     match_id, synced_at, last_attempt_at, error_message, error_log, file_exists)
                VALUES (?, ?, 'synced', ?, ?, ?, ?, ?, NULL, NULL, 1)
                ON CONFLICT(replay_hash) DO UPDATE SET
                    file_path = excluded.file_path,
                    status = 'synced',
                    parser_version = excluded.parser_version,
                    api_version = excluded.api_version,
                    match_id = excluded.match_id,
                    synced_at = excluded.synced_at,
                    last_attempt_at = excluded.last_attempt_at,
                    error_message = NULL,
                    error_log = NULL,
                    file_exists = 1
                """,
                (replay_hash, file_path, parser_version, api_version, match_id, now, now),
            )
            self._conn.commit()

    def mark_error(
        self,
        replay_hash: str,
        file_path: str,
        error_message: str,
        error_log: str | None = None,
    ) -> None:
        """Records a failed parse/upload attempt so it shows up in the Debug
        report. A replay that errors keeps `status='error'` (never
        `is_up_to_date`), so the next run retries it -- fixing the
        underlying issue (a daemon update, a reachable API) is exactly what
        should make it sync next time.
        """
        now = _now()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO replays
                    (replay_hash, file_path, status, parser_version, api_version,
                     match_id, synced_at, last_attempt_at, error_message, error_log, file_exists)
                VALUES (?, ?, 'error', NULL, NULL, NULL, NULL, ?, ?, ?, 1)
                ON CONFLICT(replay_hash) DO UPDATE SET
                    file_path = excluded.file_path,
                    status = 'error',
                    last_attempt_at = excluded.last_attempt_at,
                    error_message = excluded.error_message,
                    error_log = excluded.error_log,
                    file_exists = 1
                """,
                (replay_hash, file_path, now, error_message, error_log),
            )
            self._conn.commit()

    # -- API-version-driven resync ---------------------------------------

    def invalidate_stale(self, min_parser_version: str) -> int:
        """Drops the "synced" record for every replay synced at a parser
        version older than `min_parser_version`, so it's reparsed and
        re-uploaded on the next pass instead of being skipped as already up
        to date. Returns how many were invalidated.

        This is what lets the API -- not the daemon -- decide when
        previously-synced replays need to be resent (e.g. after a schema
        change that backfills a new field): see `app.py`'s
        `_sync_api_version`, called once at startup with the
        `minParserVersion` reported by `GET /ingest/version`.
        """
        with self._lock:
            rows = self._conn.execute(
                "SELECT replay_hash, parser_version FROM replays WHERE status = 'synced'"
            ).fetchall()
            stale = [row[0] for row in rows if row[1] is None or not _version_gte(row[1], min_parser_version)]
            if stale:
                self._conn.executemany(
                    "DELETE FROM replays WHERE replay_hash = ?", [(h,) for h in stale]
                )
                self._conn.commit()
        return len(stale)

    # -- file existence ----------------------------------------------------

    def refresh_file_existence(self, existing_paths: set[str]) -> None:
        """Updates `file_exists` for every tracked replay against the set of
        `.StormReplay` paths currently found on disk (see `_run_sync_loop`'s
        startup scan), so the Debug report can flag "source file missing"
        instead of silently going stale.
        """
        with self._lock:
            rows = self._conn.execute("SELECT replay_hash, file_path, file_exists FROM replays").fetchall()
            updates = [
                (1 if path in existing_paths else 0, replay_hash)
                for replay_hash, path, file_exists in rows
                if (1 if path in existing_paths else 0) != file_exists
            ]
            if updates:
                self._conn.executemany("UPDATE replays SET file_exists = ? WHERE replay_hash = ?", updates)
                self._conn.commit()

    # -- debug report ------------------------------------------------------

    def get_error_records(self) -> list[ReplayErrorRecord]:
        """Every replay currently in an error state, most recent first --
        backs the Debug window's report (gui.py)."""
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT replay_hash, file_path, last_attempt_at, error_message, error_log, file_exists
                FROM replays
                WHERE status = 'error'
                ORDER BY last_attempt_at DESC
                """
            ).fetchall()
        return [
            ReplayErrorRecord(
                replay_hash=row[0],
                file_path=row[1],
                last_attempt_at=row[2],
                error_message=row[3],
                error_log=row[4],
                file_exists=bool(row[5]),
            )
            for row in rows
        ]

    # -- misc metadata (currently: last known API version) ------------------

    def get_meta(self, key: str) -> str | None:
        with self._lock:
            row = self._conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row[0] if row else None

    def set_meta(self, key: str, value: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO meta (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )
            self._conn.commit()
