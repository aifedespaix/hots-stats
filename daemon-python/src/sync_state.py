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
    file_exists INTEGER NOT NULL DEFAULT 1,
    -- Non-NULL marks a row `mark_skipped` wrote for a replay that's
    -- intentionally excluded from ingestion (currently only "ai_player"),
    -- stored under status='synced' (see `mark_skipped`'s docstring for why)
    -- rather than a third CHECK'd status value, so this column can be added
    -- with a plain `ALTER TABLE ADD COLUMN` migration (see `_open`) instead
    -- of one that rebuilds the table to widen a CHECK constraint already
    -- baked into every database an installed daemon has on disk.
    skip_reason TEXT,
    -- How many consecutive times `mark_parse_error` has recorded this replay
    -- failing at `attempt_parser_version` (reset to 1 whenever that version
    -- changes -- see `mark_parse_error` and `parse_retry_budget_exhausted`).
    -- Only ever written by `mark_parse_error`; `mark_error` (the other 5
    -- error call sites in ingestion.py) leaves it untouched.
    attempt_count INTEGER NOT NULL DEFAULT 0,
    attempt_parser_version TEXT
);
CREATE INDEX IF NOT EXISTS idx_replays_status ON replays(status);

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- (file_path, file_size, mtime) -> content hash, so a replay already hashed
-- once doesn't need its full bytes read again on every daemon startup just
-- to confirm it hasn't changed (see `SyncState.cached_hash` /
-- `ingestion.ingest_file`, and tasks/daemon-audit-2026-08-12.md, 2.4). Keyed
-- by path (not hash) since the lookup always starts from "what's this file
-- on disk right now" -- a changed size or mtime for that path is a miss,
-- same as a path never seen before; the row is simply overwritten with the
-- freshly computed hash rather than needing an explicit invalidation step.
CREATE TABLE IF NOT EXISTS file_hash_cache (
    file_path TEXT PRIMARY KEY,
    file_size INTEGER NOT NULL,
    mtime REAL NOT NULL,
    replay_hash TEXT NOT NULL
);
"""


def _ensure_skip_reason_column(conn: sqlite3.Connection) -> None:
    """Adds `replays.skip_reason` to a database created before this column
    existed. `CREATE TABLE IF NOT EXISTS` (see `_SCHEMA`) is a no-op on a
    table that already exists, so a fresh column needs its own migration
    step here -- `ALTER TABLE ADD COLUMN` is safe on a live table (existing
    rows just get NULL), unlike changing `status`'s CHECK constraint would
    be, which is exactly why `skip_reason` is a separate nullable column
    rather than a third allowed `status` value (see `_SCHEMA`). Guarded with
    a try/except rather than SQLite's own `ADD COLUMN IF NOT EXISTS` (only
    available from SQLite 3.35+, March 2021) since the daemon's bundled
    sqlite3 isn't guaranteed to be that recent on every player's machine.
    """
    try:
        conn.execute("ALTER TABLE replays ADD COLUMN skip_reason TEXT")
        conn.commit()
    except sqlite3.OperationalError as err:
        if "duplicate column" not in str(err).lower():
            raise


def _ensure_attempt_tracking_columns(conn: sqlite3.Connection) -> None:
    """Adds `replays.attempt_count` / `attempt_parser_version` to a database
    created before the parse-retry budget existed (see `mark_parse_error` /
    `parse_retry_budget_exhausted`). Same `ALTER TABLE ADD COLUMN` + ignore
    "duplicate column" pattern as `_ensure_skip_reason_column` above, for the
    same reason (safe on a live table; SQLite's own `ADD COLUMN IF NOT
    EXISTS` isn't guaranteed available)."""
    for ddl in (
        "ALTER TABLE replays ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE replays ADD COLUMN attempt_parser_version TEXT",
    ):
        try:
            conn.execute(ddl)
            conn.commit()
        except sqlite3.OperationalError as err:
            if "duplicate column" not in str(err).lower():
                raise


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


@dataclass(frozen=True)
class ReplaySkippedRecord:
    """One replay that was intentionally excluded from ingestion (not a
    failure), as shown in the Debug window's separate "ignored on purpose"
    section (gui.py)."""

    replay_hash: str
    file_path: str
    last_attempt_at: str
    reason: str
    message: str | None
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
        _ensure_skip_reason_column(conn)
        _ensure_attempt_tracking_columns(conn)
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
                    file_exists = 1,
                    skip_reason = NULL
                """,
                (replay_hash, file_path, parser_version, api_version, match_id, now, now),
            )
            self._conn.commit()

    def mark_skipped(
        self,
        replay_hash: str,
        file_path: str,
        reason: str,
        message: str,
        parser_version: str,
    ) -> None:
        """Records a replay that's intentionally excluded from ingestion,
        not a failure -- currently only `reason="ai_player"`, from
        `parser.ReplaySkipped`. Stored under `status='synced'` (with
        `skip_reason` set, `api_version`/`match_id`/`synced_at` left NULL
        since nothing was actually uploaded) rather than a third `status`
        value, so it's gated by `parser_version` through `is_up_to_date` /
        `invalidate_stale` exactly like a real synced replay -- and so it's
        never re-parsed on every daemon restart -- while `get_error_records`
        (which filters on `status = 'error'`) never picks it up.
        `get_skipped_records` is the read side, for the Debug report's
        separate "ignored on purpose" section.
        """
        now = _now()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO replays
                    (replay_hash, file_path, status, parser_version, api_version,
                     match_id, synced_at, last_attempt_at, error_message, error_log,
                     file_exists, skip_reason)
                VALUES (?, ?, 'synced', ?, NULL, NULL, NULL, ?, ?, NULL, 1, ?)
                ON CONFLICT(replay_hash) DO UPDATE SET
                    file_path = excluded.file_path,
                    status = 'synced',
                    parser_version = excluded.parser_version,
                    api_version = NULL,
                    match_id = NULL,
                    synced_at = NULL,
                    last_attempt_at = excluded.last_attempt_at,
                    error_message = excluded.error_message,
                    error_log = NULL,
                    file_exists = 1,
                    skip_reason = excluded.skip_reason
                """,
                (replay_hash, file_path, parser_version, now, message, reason),
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
                    file_exists = 1,
                    skip_reason = NULL
                """,
                (replay_hash, file_path, now, error_message, error_log),
            )
            self._conn.commit()

    def mark_parse_error(
        self,
        replay_hash: str,
        file_path: str,
        error_message: str,
        error_log: str | None,
        parser_version: str,
    ) -> None:
        """Like `mark_error`, but for `parser.ReplayParseError` specifically:
        a corrupt/incomplete archive is a pure function of the file's bytes
        and this build's parsing code, so unlike a transient auth/server/
        validation failure it can never fix itself without a code change.
        Tracks `attempt_count` at `parser_version` (reset to 1 the first time
        a *different* version records an attempt, since a parser fix could
        legitimately make a previously-broken file parse) so
        `parse_retry_budget_exhausted` can tell `ingest_file` to stop
        reparsing and re-reporting a file that will never succeed at this
        build.
        """
        now = _now()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO replays
                    (replay_hash, file_path, status, parser_version, api_version,
                     match_id, synced_at, last_attempt_at, error_message, error_log,
                     file_exists, attempt_count, attempt_parser_version)
                VALUES (?, ?, 'error', NULL, NULL, NULL, NULL, ?, ?, ?, 1, 1, ?)
                ON CONFLICT(replay_hash) DO UPDATE SET
                    file_path = excluded.file_path,
                    status = 'error',
                    last_attempt_at = excluded.last_attempt_at,
                    error_message = excluded.error_message,
                    error_log = excluded.error_log,
                    file_exists = 1,
                    skip_reason = NULL,
                    attempt_count = CASE
                        WHEN replays.attempt_parser_version IS excluded.attempt_parser_version
                        THEN replays.attempt_count + 1
                        ELSE 1
                    END,
                    attempt_parser_version = excluded.attempt_parser_version
                """,
                (replay_hash, file_path, now, error_message, error_log, parser_version),
            )
            self._conn.commit()

    def parse_retry_budget_exhausted(self, replay_hash: str, parser_version: str, max_attempts: int) -> bool:
        """True once `mark_parse_error` has recorded `max_attempts` (or more)
        consecutive failures for `replay_hash` at `parser_version` -- lets
        `ingest_file` skip reparsing a file that's already proven it will
        never succeed at this build, instead of retrying it every sync cycle
        forever. Only ever true for rows written by `mark_parse_error`: a
        version change or a later `mark_synced`/`mark_error` call resets or
        bypasses it, since only a parse error is treated as unrecoverable
        without a code change.
        """
        with self._lock:
            row = self._conn.execute(
                "SELECT status, attempt_count, attempt_parser_version FROM replays WHERE replay_hash = ?",
                (replay_hash,),
            ).fetchone()
        if row is None:
            return False
        status, attempt_count, attempt_parser_version = row
        return status == "error" and attempt_parser_version == parser_version and attempt_count >= max_attempts

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

    def wipe_all(self) -> int:
        """Drops every "synced"/"error" record, regardless of parser version
        -- unlike `invalidate_stale`, which only drops entries older than a
        given version. Every replay still on disk is reparsed and
        re-uploaded from scratch on the next pass.

        Used when the API reports a new `dataResetAt` for this account (see
        `app.py`'s `_sync_api_version`): the server-side matches are already
        gone at that point, so there's nothing version-comparison could
        preserve -- the local cache just needs to match reality again.
        Returns how many rows were dropped, for the log line callers emit.
        """
        with self._lock:
            row = self._conn.execute("SELECT COUNT(*) FROM replays").fetchone()
            self._conn.execute("DELETE FROM replays")
            self._conn.commit()
        return row[0] if row else 0

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

    def get_skipped_records(self) -> list[ReplaySkippedRecord]:
        """Every replay intentionally excluded from ingestion (not a
        failure), most recent first -- backs the Debug window's separate
        "ignored on purpose" section (gui.py)."""
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT replay_hash, file_path, last_attempt_at, skip_reason, error_message, file_exists
                FROM replays
                WHERE skip_reason IS NOT NULL
                ORDER BY last_attempt_at DESC
                """
            ).fetchall()
        return [
            ReplaySkippedRecord(
                replay_hash=row[0],
                file_path=row[1],
                last_attempt_at=row[2],
                reason=row[3],
                message=row[4],
                file_exists=bool(row[5]),
            )
            for row in rows
        ]

    # -- file-hash cache (avoids re-reading unchanged files on startup) -----

    def cached_hash(self, file_path: str, file_size: int, mtime: float) -> str | None:
        """Returns the previously computed hash for `file_path`, but only if
        its size and mtime still match what was recorded when that hash was
        computed -- either one changing means the file was edited (or
        replaced) since, so the cache is treated as a miss rather than
        risking a stale hash. Called before `hasher.hash_replay_file` (see
        `ingestion.ingest_file`) so a replay whose bytes haven't changed
        since the last time this daemon ran doesn't need to be read in full
        again just to confirm that.
        """
        with self._lock:
            row = self._conn.execute(
                "SELECT replay_hash FROM file_hash_cache WHERE file_path = ? AND file_size = ? AND mtime = ?",
                (file_path, file_size, mtime),
            ).fetchone()
        return row[0] if row else None

    def cache_hash(self, file_path: str, file_size: int, mtime: float, replay_hash: str) -> None:
        """Records `file_path`'s freshly computed hash alongside the
        size/mtime it was computed from, so the next `cached_hash` lookup
        for the same path can skip re-reading the file -- until either of
        those two changes."""
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO file_hash_cache (file_path, file_size, mtime, replay_hash)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(file_path) DO UPDATE SET
                    file_size = excluded.file_size,
                    mtime = excluded.mtime,
                    replay_hash = excluded.replay_hash
                """,
                (file_path, file_size, mtime, replay_hash),
            )
            self._conn.commit()

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
