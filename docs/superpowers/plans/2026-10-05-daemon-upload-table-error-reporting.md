# Daemon upload table, discreet scheduler, error reporting, dependency guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every replay's sync state in a scrollable table in the daemon, upload without disturbing a running game, forward every daemon error (unhandled builds included) to the API, and require a daemon update only when `heroprotocol` itself must change.

**Architecture:** One shared vocabulary of upload states, *derived* from `SyncState` rows plus the scheduler's in-memory queue (no new `status` values — see "Deviations"). A single-worker `UploadScheduler` replaces the thread pool; an `ErrorReporter` (dedup, rate limit, offline queue) becomes the only path to `POST /ingest/errors`; a `HistoryEnricher` fills display columns from a new `POST /ingest/matches/lookup`; a `DependencyGuard` compares `heroprotocol` versions announced by `GET /ingest/version`.

**Tech Stack:** Python 3 + pytest + tkinter/ttk + sqlite3 (daemon-python); Hono/Bun + Drizzle/Postgres + zod + `bun test` (apps/api, packages/*).

**Spec:** `docs/superpowers/specs/2026-10-05-daemon-upload-table-error-reporting-design.md`

## Deviations from the spec (found while reading the code — the spec is outdated on these)

1. **No new `status` values.** `replays.status` has `CHECK (status IN ('synced','error'))` baked into every installed `sync_state.db`; widening it means rebuilding the table. Instead the 8 display states are *derived* (`sync_view.derive_state`) from `status`, `skip_reason`, `parser_version` vs the API's minimum, `file_exists`, and a new nullable `error_kind` column. `pending`/`uploading` have no row (a row's key is the content hash, unknown until the file is read), so they come from `UploadScheduler.snapshot()` and are merged by file path.
2. **`missing`** only applies to rows that are not `synced`. A synced replay whose file was moved/deleted stays `synced` (the server has it); only the explorer button is disabled.
3. **Lookup by `matchIds` as well as `replayHashes`.** When two players upload the same game the server dedups on `gameFingerprint`, so our own `replayHash` is not in `matches`. Synced rows are looked up by the `match_id` the daemon already stored; only quarantined rows (no match yet) use `replayHash`.
4. **Error report fields:** `fingerprint`, `heroprotocolVersion`, `occurrences` (spec also listed `status`; dropped — `replayHash` already links a report to a row). Reports with a `replayHash` keep the existing `(userId, replayHash)` upsert; reports without one (runtime/dependency) upsert on `(userId, fingerprint)` via a new partial unique index.
5. **No "forced" mode.** Scheduler modes are `auto` and `paused` only. Ignoring the game-process check is the existing checkbox "Synchroniser pendant le jeu" (stored in `SyncState` meta key `sync_during_game`, not `config.json`, so toggling needs no daemon restart).
6. **Hover detail** is a detail line under the table updated on mouse-over (ttk has no native tooltip), not a floating tooltip.

## Global Constraints

- Daemon runs on Windows; no new third-party Python dependency (game detection uses `ctypes` + `CreateToolhelp32Snapshot`, not `psutil`).
- Game process names: `HeroesOfTheStorm_x64.exe` (also match `HeroesOfTheStorm.exe`), case-insensitive.
- Scheduler: exactly one worker thread, one `requests.Session` (the one in `ApiClient`), backlog pause between files `1.0` s, game poll TTL `5.0` s, backoff `2 s` doubling to `300 s`, at most `2` re-queues per item.
- Error reporting limits: `1` send/second, `30` sends/minute, `500` queued offline reports, `500` pending in memory; messages ≤ 2000 chars, tracebacks ≤ 8000 chars; `C:\Users\<name>` replaced by `~`.
- Lookup: at most `200` ids per request (`replayHashes` + `matchIds` combined); only matches of the authenticated user (uploaded by them, or one of their linked BattleTags played in it).
- Table: pages of `500` rows; table refresh at most every `3` s and never while the user has scrolled away from the top.
- New SQLite columns are added with `ALTER TABLE ADD COLUMN` + ignore "duplicate column" (same pattern as `_ensure_map_slug_column`).
- Do **not** bump `PARSER_VERSION` or `MIN_PARSER_VERSION`; parsing output is unchanged.
- Code style: match the surrounding code (docstrings explain *why*; French UI strings, English code/identifiers).
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- After the last task, run `graphify update .` (project CLAUDE.md).

## Review Focus

Failure modes the spec implies that a reasonable user would hit. Each has a pinned test in the task that owns the code.

1. A 3000-replay backlog that all fail the same way must not flood the API (Task 2: rate-limit + dedup test).
2. The API is down at startup, then comes back: reports queued offline must still arrive, once (Task 2).
3. A log line emitted *while sending a report* must not create a new report (Task 2, reentrancy test).
4. Token revoked mid-backlog: the queue must stop, not mark thousands of replays as errors (Task 4).
5. The game exits mid-backlog: the backlog must resume by itself; a replay finished while the game runs must still upload (Task 4).
6. Two linked BattleTags in the same game must yield one lookup row, not two (Task 5).
7. A synced row whose match was deleted server-side must not be re-queried forever in one run (Task 5).
8. A path with spaces/accents must reach `explorer /select,` as one argument (Task 6).
9. 10 000 tracked replays must not make opening the tab slow: only one page is inserted (Task 6).

---

### Task 1: Server — new error types, fingerprint upsert, occurrences

**Files:**
- Modify: `packages/shared-types/src/daemon-error.ts`
- Create: `packages/shared-types/src/daemon-error.test.ts`
- Modify: `packages/db/src/schema/daemon-ingest-errors.ts`
- Create (generated): `packages/db/drizzle/0026_*.sql` (+ `meta/` snapshot and `_journal.json` updates)
- Modify: `apps/api/src/services/daemon-errors.service.ts`
- Create: `apps/api/src/services/daemon-errors.upsert.test.ts`

**Interfaces:**
- Produces: `DaemonErrorReportInput` gains `heroprotocolVersion?: string | null`, `fingerprint?: string | null`, `occurrences: number` (default 1); `DaemonErrorType` gains `"quarantine" | "runtime" | "dependency"`; `buildErrorUpsert(userId, input, now)` (pure, exported from `daemon-errors.service.ts`).

- [ ] **Step 1: Write the failing schema test**

Create `packages/shared-types/src/daemon-error.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { daemonErrorReportInputSchema } from "./daemon-error";

const base = {
  replayHash: null,
  baseBuild: null,
  errorType: "runtime",
  errorMessage: "boom",
  errorLog: null,
  parserVersion: "1.19",
  daemonVersion: "1.0.55",
};

describe("daemonErrorReportInputSchema", () => {
  test("accepts the three new error types", () => {
    for (const errorType of ["quarantine", "runtime", "dependency"]) {
      expect(daemonErrorReportInputSchema.safeParse({ ...base, errorType }).success).toBe(true);
    }
  });

  test("still accepts a report from an older daemon (no new fields) and defaults occurrences to 1", () => {
    const parsed = daemonErrorReportInputSchema.parse({ ...base, errorType: "parse" });
    expect(parsed.occurrences).toBe(1);
    expect(parsed.fingerprint).toBeUndefined();
  });

  test("rejects an unknown type and a non-positive occurrences count", () => {
    expect(daemonErrorReportInputSchema.safeParse({ ...base, errorType: "nope" }).success).toBe(false);
    expect(daemonErrorReportInputSchema.safeParse({ ...base, occurrences: 0 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/shared-types && bun test src/daemon-error.test.ts`
Expected: FAIL (`quarantine` is not in the enum).

- [ ] **Step 3: Extend the schema**

In `packages/shared-types/src/daemon-error.ts` replace the enum line and add three fields:

```ts
export const daemonErrorTypeSchema = z.enum([
  "parse",
  "auth",
  "validation",
  "server",
  // Build the API doesn't recognise yet (QuarantinedError in the daemon).
  "quarantine",
  // Any WARNING/ERROR from the daemon's own logging outside the ingestion path.
  "runtime",
  // The daemon's `heroprotocol` is older than the API's `minHeroprotocolVersion`.
  "dependency",
]);
```

and inside `daemonErrorReportInputSchema`, after `daemonVersion`:

```ts
  heroprotocolVersion: z.string().max(64).nullable().optional(),
  // Stable hash of (type, normalised message, replayHash) computed by the daemon; lets the
  // server collapse repeats of a runtime error that has no replayHash to key on.
  fingerprint: z.string().min(8).max(64).nullable().optional(),
  // How many times the daemon saw this exact report since the last one it sent.
  occurrences: z.number().int().min(1).max(100000).default(1),
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/shared-types && bun test src/daemon-error.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing upsert-builder test**

Create `apps/api/src/services/daemon-errors.upsert.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { daemonErrorReportInputSchema } from "@hots-stats/shared-types";
import { buildErrorUpsert } from "./daemon-errors.service";

const now = new Date("2026-10-05T10:00:00Z");
const parse = (over: Record<string, unknown>) =>
  daemonErrorReportInputSchema.parse({
    replayHash: null,
    baseBuild: null,
    errorType: "runtime",
    errorMessage: "boom",
    errorLog: null,
    parserVersion: "1.19",
    daemonVersion: "1.0.55",
    ...over,
  });

describe("buildErrorUpsert", () => {
  test("a report with a replayHash is keyed on (user, replay) and ignores the fingerprint", () => {
    const plan = buildErrorUpsert("u1", parse({ replayHash: "a".repeat(64), fingerprint: "f".repeat(32) }), now);
    expect(plan.kind).toBe("replay");
    expect(plan.values.fingerprint).toBeNull();
  });

  test("a report without a replayHash but with a fingerprint is keyed on (user, fingerprint)", () => {
    const plan = buildErrorUpsert("u1", parse({ fingerprint: "f".repeat(32) }), now);
    expect(plan.kind).toBe("fingerprint");
    expect(plan.values.fingerprint).toBe("f".repeat(32));
  });

  test("a report with neither is a plain insert", () => {
    expect(buildErrorUpsert("u1", parse({}), now).kind).toBe("insert");
  });

  test("occurrences seed the first row's count", () => {
    expect(buildErrorUpsert("u1", parse({ occurrences: 7 }), now).values.occurrenceCount).toBe(7);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd apps/api && bun test src/services/daemon-errors.upsert.test.ts`
Expected: FAIL (`buildErrorUpsert` is not exported).

- [ ] **Step 7: Extend the DB schema**

In `packages/db/src/schema/daemon-ingest-errors.ts`: add `sql` to the drizzle import (`import { sql } from "drizzle-orm";`), extend the enum:

```ts
export const daemonErrorTypeEnum = pgEnum("daemon_error_type", [
  "parse",
  "auth",
  "validation",
  "server",
  "quarantine",
  "runtime",
  "dependency",
]);
```

add columns after `daemonVersion`:

```ts
    heroprotocolVersion: text("heroprotocol_version"),
    // Only set for reports with no `replayHash` (runtime/dependency): the dedup key for those.
    fingerprint: text("fingerprint"),
```

and in the index callback add (after `userReplayUnique`):

```ts
    userFingerprintUnique: uniqueIndex("daemon_ingest_errors_user_fingerprint_idx")
      .on(table.userId, table.fingerprint)
      .where(sql`${table.fingerprint} IS NOT NULL`),
```

- [ ] **Step 8: Generate the migration and inspect it**

Run: `bun run --filter './packages/db' generate`
Expected: a new `packages/db/drizzle/0026_*.sql`. Open it and confirm it contains three `ALTER TYPE "public"."daemon_error_type" ADD VALUE '…'` statements, two `ADD COLUMN`, and a `CREATE UNIQUE INDEX … WHERE "fingerprint" IS NOT NULL`. If drizzle-kit asks interactive questions, answer "create" (never "rename").

- [ ] **Step 9: Implement `buildErrorUpsert` and use it**

In `apps/api/src/services/daemon-errors.service.ts` replace `recordDaemonError` with:

```ts
type ErrorValues = typeof daemonIngestErrors.$inferInsert;

export interface ErrorUpsertPlan {
  kind: "replay" | "fingerprint" | "insert";
  values: ErrorValues;
}

/**
 * Decides how one report is stored. Pure so it's unit-testable without a database.
 * A report with a `replayHash` keeps the original (user, replay) dedup; one without
 * (runtime / dependency errors have no replay) dedups on (user, fingerprint) instead,
 * since Postgres treats every NULL `replayHash` as distinct.
 */
export function buildErrorUpsert(userId: string, input: DaemonErrorReportInput, now: Date): ErrorUpsertPlan {
  const hasReplay = input.replayHash !== null;
  const fingerprint = hasReplay ? null : (input.fingerprint ?? null);
  return {
    kind: hasReplay ? "replay" : fingerprint !== null ? "fingerprint" : "insert",
    values: {
      userId,
      replayHash: input.replayHash,
      baseBuild: input.baseBuild,
      errorType: input.errorType,
      errorMessage: input.errorMessage,
      errorLog: input.errorLog,
      parserVersion: input.parserVersion,
      daemonVersion: input.daemonVersion,
      heroprotocolVersion: input.heroprotocolVersion ?? null,
      fingerprint,
      occurrenceCount: input.occurrences,
      firstOccurredAt: now,
      lastOccurredAt: now,
    },
  };
}

export async function recordDaemonError(userId: string, input: DaemonErrorReportInput): Promise<void> {
  const now = new Date();
  const plan = buildErrorUpsert(userId, input, now);
  const set = {
    baseBuild: input.baseBuild,
    errorType: input.errorType,
    errorMessage: input.errorMessage,
    errorLog: input.errorLog,
    parserVersion: input.parserVersion,
    daemonVersion: input.daemonVersion,
    heroprotocolVersion: input.heroprotocolVersion ?? null,
    status: "open" as const,
    occurrenceCount: sql`${daemonIngestErrors.occurrenceCount} + ${input.occurrences}`,
    lastOccurredAt: now,
    resolvedAt: null,
  };
  const insert = db.insert(daemonIngestErrors).values(plan.values);
  if (plan.kind === "replay") {
    await insert.onConflictDoUpdate({
      target: [daemonIngestErrors.userId, daemonIngestErrors.replayHash],
      set,
    });
  } else if (plan.kind === "fingerprint") {
    await insert.onConflictDoUpdate({
      target: [daemonIngestErrors.userId, daemonIngestErrors.fingerprint],
      targetWhere: sql`${daemonIngestErrors.fingerprint} IS NOT NULL`,
      set,
    });
  } else {
    await insert;
  }
}
```

Also keep the original doc comment above `recordDaemonError`, and add `heroprotocolVersion: string | null;` to `DaemonErrorGroup`, `heroprotocolVersion: daemonIngestErrors.heroprotocolVersion,` to the `select` in `getDaemonErrorGroups`, and `heroprotocolVersion: row.heroprotocolVersion,` to the group object it builds (next to `daemonVersion`).

- [ ] **Step 10: Run tests + typecheck**

Run: `cd apps/api && bun test src/services/daemon-errors.upsert.test.ts && cd ../.. && bun run typecheck`
Expected: PASS, and typecheck clean for every workspace.

- [ ] **Step 11: Smoke-test the DB path (manual, needs local Postgres)**

Run: `bun run docker:dev:up && bun run --filter './packages/db' migrate`
Expected: migration applies without error. (The upsert SQL itself has no automated DB test in this repo's setup; `bun run dev:api` plus a real daemon run in Task 2 exercises it.)

- [ ] **Step 12: Commit**

```bash
git add packages/shared-types packages/db apps/api/src/services
git commit -m "feat(api): quarantine/runtime/dependency daemon error types with fingerprint dedup

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Daemon — `ErrorReporter` (dedup, rate limit, offline queue, logging handler)

**Files:**
- Create: `daemon-python/src/error_reporter.py`
- Create: `daemon-python/tests/test_error_reporter.py`
- Modify: `daemon-python/src/constants.py` (add `HEROPROTOCOL_VERSION` next to `APP_VERSION`, ~line 330)
- Modify: `daemon-python/src/sync_state.py` (offline queue table + 3 methods)
- Modify: `daemon-python/src/ingestion.py` (`_report_error`, `ingest_file`, `resync`, quarantine branch)
- Modify: `daemon-python/src/app.py` (`_DaemonRunner.start/stop`)
- Modify: `daemon-python/src/main.py` (headless `--resync`, ~line 57)
- Modify: `daemon-python/tests/test_ingestion.py:438` (quarantine test)

**Interfaces:**
- Produces: `ErrorReporter(send: Callable[[dict], bool], state=None, *, clock=time.monotonic, max_per_minute=30, min_interval=1.0)` with `.report(error_type, message, *, replay_hash=None, base_build=None, error_log=None)`, `.flush() -> int`, `.is_flushing -> bool`; `install_logging_handler(reporter, logger_name=None) -> ReportingHandler`; `uninstall_logging_handler(handler)`; `scrub_paths(text)`; `make_fingerprint(error_type, message, replay_hash)`; `constants.HEROPROTOCOL_VERSION`; `SyncState.enqueue_error_report / peek_error_reports / delete_error_reports`; `ingest_file(..., reporter=None)`, `resync(..., reporter=None)`.

- [ ] **Step 1: Write the failing tests**

Create `daemon-python/tests/test_error_reporter.py`:

```python
import logging
import re
from pathlib import Path

from src import constants
from src.error_reporter import (
    ErrorReporter,
    ReportingHandler,
    make_fingerprint,
    scrub_paths,
)
from src.sync_state import SyncState


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def _reporter(sent: list, *, ok=lambda: True, state=None, clock=None, **kwargs) -> ErrorReporter:
    def send(report: dict) -> bool:
        sent.append(report)
        return ok()

    return ErrorReporter(send, state, clock=clock or FakeClock(), **kwargs)


def test_scrub_paths_replaces_the_windows_user_directory():
    text = r"File C:\Users\clape\AppData\Roaming\x.py, line 3"
    assert scrub_paths(text) == r"File ~\AppData\Roaming\x.py, line 3"


def test_fingerprint_ignores_digits_but_not_type_or_replay():
    a = make_fingerprint("runtime", "failed after 3 tries", None)
    assert a == make_fingerprint("runtime", "failed after 9 tries", None)
    assert a != make_fingerprint("server", "failed after 3 tries", None)
    assert a != make_fingerprint("runtime", "failed after 3 tries", "h" * 64)


def test_identical_reports_are_sent_once_with_an_occurrence_count():
    sent: list = []
    reporter = _reporter(sent)
    for _ in range(3):
        reporter.report("runtime", "watcher crashed")
    assert reporter.flush() == 1
    assert sent[0]["occurrences"] == 3
    assert sent[0]["errorType"] == "runtime"


def test_report_carries_every_version_and_a_scrubbed_message():
    sent: list = []
    reporter = _reporter(sent)
    reporter.report("parse", r"bad file C:\Users\bob\x.StormReplay", replay_hash="a" * 64, base_build=96477)
    reporter.flush()
    report = sent[0]
    assert report["parserVersion"] == constants.PARSER_VERSION
    assert report["daemonVersion"] == constants.APP_VERSION
    assert report["heroprotocolVersion"] == constants.HEROPROTOCOL_VERSION
    assert report["baseBuild"] == 96477
    assert "bob" not in report["errorMessage"]
    assert report["fingerprint"]


def test_a_flood_of_distinct_failures_is_capped_at_thirty_per_minute():
    sent: list = []
    clock = FakeClock()
    reporter = _reporter(sent, clock=clock)
    for i in range(3000):
        reporter.report("validation", "rejected", replay_hash=f"{i:064x}")
    for _ in range(60):
        reporter.flush()
        clock.advance(1.0)
    assert len(sent) == 30


def test_two_flushes_in_the_same_second_send_only_one_report():
    sent: list = []
    reporter = _reporter(sent)
    reporter.report("runtime", "one")
    reporter.report("runtime", "two")
    reporter.flush()
    reporter.flush()
    assert len(sent) == 1


def test_failed_send_is_queued_offline_and_delivered_once_the_api_is_back(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    sent: list = []
    api_up = {"value": False}
    clock = FakeClock()
    reporter = _reporter(sent, ok=lambda: api_up["value"], state=state, clock=clock)
    reporter.report("runtime", "while offline")
    assert reporter.flush() == 0
    assert len(state.peek_error_reports(10)) == 1

    api_up["value"] = True
    clock.advance(2.0)
    assert reporter.flush() == 1
    assert state.peek_error_reports(10) == []
    assert sent[-1]["errorMessage"] == "while offline"


def test_failed_send_without_a_state_db_is_retried_from_memory():
    sent: list = []
    api_up = {"value": False}
    clock = FakeClock()
    reporter = _reporter(sent, ok=lambda: api_up["value"], clock=clock)
    reporter.report("runtime", "kept in memory")
    reporter.flush()
    api_up["value"] = True
    clock.advance(2.0)
    assert reporter.flush() == 1


def test_offline_queue_is_capped_at_500_oldest_dropped(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    for i in range(520):
        state.enqueue_error_report(f"fp{i}", f'{{"n": {i}}}')
    rows = state.peek_error_reports(1000)
    assert len(rows) == 500
    assert rows[0][1] == '{"n": 20}'


def test_logging_handler_reports_warnings_and_skips_info_and_excluded_loggers():
    sent: list = []
    reporter = _reporter(sent)
    handler = ReportingHandler(reporter)
    log = logging.getLogger("hotsq.watcher")
    log.setLevel(logging.DEBUG)
    log.addHandler(handler)
    ingestion_log = logging.getLogger("hotsq.ingestion")
    ingestion_log.addHandler(handler)
    try:
        log.info("fine")
        log.warning("watcher died: %s", "disk gone")
        ingestion_log.error("already reported by ingest_file")
    finally:
        log.removeHandler(handler)
        ingestion_log.removeHandler(handler)
    reporter.flush()
    assert len(sent) == 1
    assert sent[0]["errorType"] == "runtime"
    assert "disk gone" in sent[0]["errorMessage"]


def test_a_log_line_emitted_while_sending_does_not_create_a_new_report():
    log = logging.getLogger("hotsq.reentrant")
    sent: list = []

    def send(report: dict) -> bool:
        sent.append(report)
        log.warning("noise from inside the send path")
        return True

    clock = FakeClock()
    reporter = ErrorReporter(send, None, clock=clock)
    handler = ReportingHandler(reporter)
    log.addHandler(handler)
    try:
        reporter.report("runtime", "first")
        reporter.flush()
        clock.advance(2.0)
        reporter.flush()
    finally:
        log.removeHandler(handler)
    assert len(sent) == 1


def test_heroprotocol_constant_matches_the_pin_in_pyproject():
    text = (Path(__file__).resolve().parents[1] / "pyproject.toml").read_text(encoding="utf-8")
    match = re.search(r"heroprotocol @ git\+https://[^@\s\"]+@v([\d.]+)", text)
    assert match is not None
    assert constants.HEROPROTOCOL_VERSION == match.group(1)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd daemon-python && pytest tests/test_error_reporter.py -q`
Expected: FAIL (`ModuleNotFoundError: src.error_reporter`).

- [ ] **Step 3: Add the constant**

In `daemon-python/src/constants.py`, right after the `APP_VERSION = "1.0.55"` line:

```python
# The `heroprotocol` release pinned in pyproject.toml (`heroprotocol @ git+...@v<this>`).
# Hard-coded rather than read via importlib.metadata, which is unreliable inside the
# Nuitka-built exe; tests/test_error_reporter.py fails if it drifts from the pin.
# Compared against the API's `minHeroprotocolVersion` (see dependency_guard.py).
HEROPROTOCOL_VERSION = "2.55.15.96477"
```

- [ ] **Step 4: Add the offline queue to `SyncState`**

In `daemon-python/src/sync_state.py`, append to `_SCHEMA` (before the closing `"""`):

```sql

-- Error reports the daemon couldn't deliver (API unreachable), retried by
-- `error_reporter.ErrorReporter.flush`. Capped (see `enqueue_error_report`).
CREATE TABLE IF NOT EXISTS pending_error_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```

add a module constant `_MAX_QUEUED_ERROR_REPORTS = 500` below `logger`, and these methods at the end of `SyncState`:

```python
    # -- offline error-report queue ---------------------------------------

    def enqueue_error_report(self, fingerprint: str, payload: str) -> None:
        """Persists one undelivered error report, dropping the oldest ones past the cap
        so a long outage can't grow this table without bound."""
        with self._lock:
            self._conn.execute(
                "INSERT INTO pending_error_reports (fingerprint, payload, created_at) VALUES (?, ?, ?)",
                (fingerprint, payload, _now()),
            )
            self._conn.execute(
                "DELETE FROM pending_error_reports WHERE id NOT IN "
                "(SELECT id FROM pending_error_reports ORDER BY id DESC LIMIT ?)",
                (_MAX_QUEUED_ERROR_REPORTS,),
            )
            self._conn.commit()

    def peek_error_reports(self, limit: int) -> list[tuple[int, str]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, payload FROM pending_error_reports ORDER BY id LIMIT ?", (limit,)
            ).fetchall()
        return [(int(row[0]), str(row[1])) for row in rows]

    def delete_error_reports(self, ids: list[int]) -> None:
        if not ids:
            return
        with self._lock:
            self._conn.executemany("DELETE FROM pending_error_reports WHERE id = ?", [(i,) for i in ids])
            self._conn.commit()
```

- [ ] **Step 5: Implement `error_reporter.py`**

Create `daemon-python/src/error_reporter.py`:

```python
"""The one path every daemon error takes to `POST /ingest/errors`.

Before this module, only 4 failure types inside `ingestion.ingest_file` were reported, each as
its own request. Now `ingest_file` *and* a `logging.Handler` (every WARNING/ERROR the daemon
logs) go through `ErrorReporter`, which keeps that from turning into a flood or a loop:

- repeats of the same report collapse into one with an `occurrences` count (a backlog of
  thousands of replays failing identically becomes a handful of requests);
- sends are rate-limited (`min_interval` seconds apart, `max_per_minute` per rolling minute);
- a report the API can't take (offline) is persisted in `SyncState`'s `pending_error_reports`
  (or kept in memory when there is no state db) and retried by a later `flush()`;
- nothing the reporter itself does logs above DEBUG, and records emitted *during* a flush on
  the flushing thread are ignored, so reporting can never report itself.

`report()` never blocks on the network: it only records. `flush()` does the sending and is
called by the upload scheduler between files (see `upload_scheduler.UploadScheduler`'s
`on_idle`) and once at the end of a headless `--resync`.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
from collections import deque
from typing import Callable, Protocol

from . import constants

logger = logging.getLogger(__name__)

_USER_DIR_RE = re.compile(r"[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s\"']+", re.IGNORECASE)
_NUMBER_RE = re.compile(r"\d+")
_MAX_PENDING_IN_MEMORY = 500
_MAX_MESSAGE_CHARS = 2000
_MAX_LOG_CHARS = 8000
# This module's package ("src"): the handler is attached there so it sees every daemon logger.
_PACKAGE_LOGGER = __name__.rpartition(".")[0]
# Loggers whose WARNING/ERROR records are *already* reported richly by ingest_file, or are
# retry noise (api_client logs every failed attempt). Matched on the last dotted segment.
_EXCLUDED_LOGGER_SUFFIXES = frozenset({"ingestion", "api_client", "error_reporter"})


class _State(Protocol):
    def enqueue_error_report(self, fingerprint: str, payload: str) -> None: ...
    def peek_error_reports(self, limit: int) -> list[tuple[int, str]]: ...
    def delete_error_reports(self, ids: list[int]) -> None: ...


def scrub_paths(text: str) -> str:
    """`C:\\Users\\<name>\\...` -> `~\\...`: tracebacks must not carry the player's Windows login."""
    return _USER_DIR_RE.sub("~", text)


def make_fingerprint(error_type: str, message: str, replay_hash: str | None) -> str:
    """Stable identity of a report. Digits are normalised so "failed after 3 tries" and
    "failed after 9 tries" collapse; the replay hash keeps per-replay failures distinct."""
    normalised = _NUMBER_RE.sub("#", scrub_paths(message))
    raw = f"{error_type}|{normalised}|{replay_hash or ''}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:32]


class ErrorReporter:
    def __init__(
        self,
        send: Callable[[dict], bool],
        state: _State | None = None,
        *,
        clock: Callable[[], float] = time.monotonic,
        max_per_minute: int = 30,
        min_interval: float = 1.0,
    ) -> None:
        self._send = send
        self._state = state
        self._clock = clock
        self._max_per_minute = max_per_minute
        self._min_interval = min_interval
        self._lock = threading.Lock()
        self._flush_lock = threading.Lock()
        self._local = threading.local()
        self._pending: dict[str, dict] = {}
        self._sent_at: deque[float] = deque()

    @property
    def is_flushing(self) -> bool:
        """True on the thread currently inside `flush()` (see `ReportingHandler`)."""
        return bool(getattr(self._local, "flushing", False))

    def report(
        self,
        error_type: str,
        message: str,
        *,
        replay_hash: str | None = None,
        base_build: int | None = None,
        error_log: str | None = None,
    ) -> None:
        message = scrub_paths(message)[:_MAX_MESSAGE_CHARS] or "(no message)"
        log = scrub_paths(error_log)[:_MAX_LOG_CHARS] if error_log else None
        fingerprint = make_fingerprint(error_type, message, replay_hash)
        with self._lock:
            existing = self._pending.get(fingerprint)
            if existing is not None:
                existing["occurrences"] += 1
                return
            if len(self._pending) >= _MAX_PENDING_IN_MEMORY:
                return
            self._pending[fingerprint] = {
                "replayHash": replay_hash,
                "baseBuild": base_build,
                "errorType": error_type,
                "errorMessage": message,
                "errorLog": log,
                "parserVersion": constants.PARSER_VERSION,
                "daemonVersion": constants.APP_VERSION,
                "heroprotocolVersion": constants.HEROPROTOCOL_VERSION,
                "fingerprint": fingerprint,
                "occurrences": 1,
            }

    def flush(self) -> int:
        """Sends what the rate limit allows, offline-queued reports first. Returns how many
        were delivered. Stops at the first failed send (the API is probably unreachable)."""
        if not self._flush_lock.acquire(blocking=False):
            return 0
        self._local.flushing = True
        try:
            sent = 0
            while self._may_send():
                queued = self._state.peek_error_reports(1) if self._state is not None else []
                if queued:
                    row_id, payload = queued[0]
                    if not self._send(json.loads(payload)):
                        break
                    self._state.delete_error_reports([row_id])
                else:
                    with self._lock:
                        if not self._pending:
                            break
                        fingerprint, report = next(iter(self._pending.items()))
                        del self._pending[fingerprint]
                    if not self._send(report):
                        self._requeue(fingerprint, report)
                        break
                self._sent_at.append(self._clock())
                sent += 1
            return sent
        finally:
            self._local.flushing = False
            self._flush_lock.release()

    def _may_send(self) -> bool:
        now = self._clock()
        while self._sent_at and now - self._sent_at[0] >= 60.0:
            self._sent_at.popleft()
        if len(self._sent_at) >= self._max_per_minute:
            return False
        return not self._sent_at or now - self._sent_at[-1] >= self._min_interval

    def _requeue(self, fingerprint: str, report: dict) -> None:
        if self._state is not None:
            self._state.enqueue_error_report(fingerprint, json.dumps(report))
            return
        with self._lock:
            self._pending.setdefault(fingerprint, report)


class ReportingHandler(logging.Handler):
    """Forwards WARNING+ records to an `ErrorReporter` as `runtime` errors."""

    def __init__(self, reporter: ErrorReporter) -> None:
        super().__init__(level=logging.WARNING)
        self._reporter = reporter

    def emit(self, record: logging.LogRecord) -> None:
        if self._reporter.is_flushing:
            return
        if record.name.rpartition(".")[2] in _EXCLUDED_LOGGER_SUFFIXES:
            return
        try:
            log = None
            if record.exc_info:
                log = "".join(logging.Formatter().formatException(record.exc_info))
            self._reporter.report(
                "runtime", f"{record.name.rpartition('.')[2]}: {record.getMessage()}", error_log=log
            )
        except Exception:  # noqa: BLE001 -- a logging handler must never raise
            self.handleError(record)


def install_logging_handler(reporter: ErrorReporter, logger_name: str | None = None) -> ReportingHandler:
    handler = ReportingHandler(reporter)
    logging.getLogger(_PACKAGE_LOGGER if logger_name is None else logger_name).addHandler(handler)
    return handler


def uninstall_logging_handler(handler: ReportingHandler, logger_name: str | None = None) -> None:
    logging.getLogger(_PACKAGE_LOGGER if logger_name is None else logger_name).removeHandler(handler)
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd daemon-python && pytest tests/test_error_reporter.py -q`
Expected: PASS (11 tests).

- [ ] **Step 7: Rewrite the quarantine test first (failing)**

In `daemon-python/tests/test_ingestion.py`, read the test at line 438 (`test_ingest_file_quarantined_returns_error_outcome_without_reporting_error`). Rename it to `test_ingest_file_quarantined_returns_error_outcome_and_reports_a_quarantine_error`, replace its docstring's last sentences with: "The server keeps the raw payload, but the daemon still reports a `quarantine` error so unhandled builds show up in the same triage view as every other failure.", and replace its final "not reported" assertion with:

```python
    report_mock.assert_called_once()
    report = report_mock.call_args.args[0]
    assert report["errorType"] == "quarantine"
    assert report["baseBuild"] == 93943
```

(`report_mock` is the mock the test already patches on `client.post_ingest_error`; keep its existing name/patch. `_report_error` only fires when a `sync_state` is passed — the real daemon and `--resync` always pass one — so if this test calls `ingest_file` without it, add `SyncState(tmp_path / "s.db")` as the third argument.) Run: `pytest tests/test_ingestion.py -q -k quarantined` → FAIL.

- [ ] **Step 8: Wire `ingestion.py`**

1. Imports: `from .error_reporter import ErrorReporter`.
2. `_report_error`: extend `error_type` Literal with `"quarantine"`; add keyword parameter `reporter: ErrorReporter | None = None` and `error_log` handled inside; replace its body after the `sync_state is None` guard with:

```python
    if reporter is not None:
        reporter.report(
            error_type,
            message,
            replay_hash=replay_hash,
            base_build=base_build,
            error_log=traceback.format_exc(),
        )
        return
    client.post_ingest_error(
        {
            "replayHash": replay_hash,
            "baseBuild": base_build,
            "errorType": error_type,
            "errorMessage": message[:2000],
            "errorLog": traceback.format_exc()[:8000],
            "parserVersion": constants.PARSER_VERSION,
            "daemonVersion": constants.APP_VERSION,
        }
    )
```

3. `ingest_file`: add parameter `reporter: ErrorReporter | None = None` after `toon_handle`; pass `reporter=reporter` to **every** existing `_report_error(...)` call (parse, auth, validation, server, catch-all).
4. In the `except api_client.QuarantinedError` branch, replace the long "deliberately skips" comment with: `# The server also keeps the raw payload (raw_replays_quarantine); the report here is the index entry that puts unhandled builds in the same triage view as every other failure.` and add before `return`:

```python
        _report_error(
            client,
            sync_state,
            error_type="quarantine",
            replay_hash=payload["replayHash"],
            base_build=err.base_build,
            message=str(err),
            reporter=reporter,
        )
```

5. `resync(...)`: add `reporter: ErrorReporter | None = None`, pass it to `ingest_file(..., reporter=reporter)`, and call `if reporter is not None: reporter.flush()` just before the final `logger.info("Resync complete...")`. (A headless resync has no scheduler, so this is its only flush; reports beyond the rate limit stay in the offline queue for the tray daemon.)

- [ ] **Step 9: Wire `app.py` and `main.py`**

`app.py`: `from .error_reporter import ErrorReporter, ReportingHandler, install_logging_handler, uninstall_logging_handler`. In `_DaemonRunner.__init__` add `self._reporter: ErrorReporter | None = None` and `self._log_handler: ReportingHandler | None = None`. In `start()`, right after `self.sync_state = sync_state`:

```python
        reporter = ErrorReporter(client.post_ingest_error, sync_state)
        self._reporter = reporter
        self._log_handler = install_logging_handler(reporter)
```

In `_ingest_and_track` pass `reporter=reporter` to `ingest_file(...)`, and after `self._maybe_notify_persistent_failure()` add `reporter.flush()`. In `stop()`, after the thread bookkeeping at the top (before `if self._thread is None ...` returns), add:

```python
        if self._log_handler is not None:
            uninstall_logging_handler(self._log_handler)
            self._log_handler = None
```

`main.py` at the `resync(client, watch_dirs, sync_state, calibrations=calibrations)` call: create `reporter = ErrorReporter(client.post_ingest_error, sync_state)` just before it (import from `.error_reporter`) and pass `reporter=reporter`.

- [ ] **Step 10: Run the whole daemon suite**

Run: `cd daemon-python && pytest -q`
Expected: PASS, including the rewritten quarantine test. If a `test_app.py` runner test now fails because a logging handler leaked, make sure `stop()` ran in that test.

- [ ] **Step 11: Commit**

```bash
git add daemon-python
git commit -m "feat(daemon): route every error through a deduped, rate-limited ErrorReporter

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Daemon — display columns on `SyncState`, derived states (`sync_view`)

**Files:**
- Modify: `daemon-python/src/sync_state.py`
- Modify: `daemon-python/src/ingestion.py`
- Modify: `daemon-python/src/app.py` (`_sync_api_version`)
- Create: `daemon-python/src/sync_view.py`
- Create: `daemon-python/tests/test_sync_view.py`
- Create: `daemon-python/tests/test_sync_state_display.py`
- Modify: `daemon-python/tests/test_app.py` (one new test)

**Interfaces:**
- Produces: `ReplayRow` (dataclass), `SyncState.all_rows() -> list[ReplayRow]`, `SyncState.rows_needing_enrichment()`, `SyncState.rows_quarantined()`, `SyncState.apply_match_info(match_id, *, map_slug, game_mode, played_at, hero, won)`, `SyncState.reconcile_quarantined(replay_hash, match_id, parser_version, *, map_slug, game_mode, played_at, hero, won)`; `mark_synced(..., base_build, hero, game_mode, played_at, won)`; `mark_error(..., error_kind, base_build)`; `ingestion.display_fields(payload) -> dict`; `sync_view`: `STATES`, `STATE_LABELS`, `SyncRowView`, `derive_state`, `build_views(rows, live, min_parser_version)`, `count_by_state`, `filter_views`, `sort_views`, `format_when`. Meta key `min_parser_version` written by `_sync_api_version`.

- [ ] **Step 1: Write the failing view tests**

Create `daemon-python/tests/test_sync_view.py`:

```python
import re

from src.sync_state import ReplayRow
from src.sync_view import (
    build_views,
    count_by_state,
    derive_state,
    filter_views,
    format_when,
    sort_views,
)


def _row(**kwargs) -> ReplayRow:
    defaults = dict(replay_hash="h1", file_path=r"C:\r\a.StormReplay", status="synced", parser_version="1.19")
    defaults.update(kwargs)
    return ReplayRow(**defaults)


def test_synced_row_at_or_above_the_minimum_is_synced():
    assert derive_state(_row(parser_version="1.19"), "1.16") == "synced"


def test_synced_row_below_the_minimum_is_outdated():
    assert derive_state(_row(parser_version="1.10"), "1.16") == "outdated"


def test_no_minimum_known_means_never_outdated():
    assert derive_state(_row(parser_version="1.0"), None) == "synced"


def test_skip_reason_wins_over_synced():
    assert derive_state(_row(skip_reason="ai_player"), "1.16") == "skipped"


def test_error_row_is_error_and_quarantine_kind_is_quarantined():
    assert derive_state(_row(status="error", error_message="x"), None) == "error"
    assert derive_state(_row(status="error", error_kind="quarantine"), None) == "quarantined"


def test_missing_file_only_changes_rows_that_are_not_synced():
    assert derive_state(_row(status="error", file_exists=False), None) == "missing"
    assert derive_state(_row(file_exists=False), "1.16") == "synced"


def test_view_label_result_build_and_live_override():
    rows = [
        _row(
            map_slug="tomb-of-the-spider-queen",
            hero="Xalatath",
            game_mode="StormLeague",
            played_at="2026-09-30T19:14:03Z",
            won=True,
            base_build=96477,
        )
    ]
    view = build_views(rows, {}, "1.16")[0]
    assert view.label == "Tomb Of The Spider Queen · Xalatath · StormLeague"
    assert view.result == "Victoire"
    assert view.build == "96477"
    live = build_views(rows, {rows[0].file_path: "uploading"}, "1.16")[0]
    assert live.state == "uploading"


def test_label_falls_back_to_the_file_name_and_missing_values_show_a_dash():
    view = build_views([_row(file_path=r"C:\r\2026 Tomb.StormReplay")], {}, None)[0]
    assert view.label == "2026 Tomb"
    assert (view.result, view.build, view.played, view.uploaded) == ("—", "—", "—", "—")


def test_live_paths_without_a_row_become_pending_rows():
    views = build_views([], {r"C:\r\new.StormReplay": "pending"}, None)
    assert [(v.state, v.label, v.file_exists) for v in views] == [("pending", "new", True)]


def test_default_order_is_most_recent_game_first():
    rows = [
        _row(replay_hash="old", played_at="2026-01-01T00:00:00Z"),
        _row(replay_hash="new", played_at="2026-09-01T00:00:00Z"),
    ]
    assert [v.key for v in build_views(rows, {}, None)] == ["new", "old"]


def test_count_filter_and_sort():
    rows = [
        _row(replay_hash="a", status="error", error_message="x", played_at="2026-02-01T00:00:00Z"),
        _row(replay_hash="b", played_at="2026-03-01T00:00:00Z"),
        _row(replay_hash="c", played_at="2026-01-01T00:00:00Z"),
    ]
    views = build_views(rows, {}, None)
    assert count_by_state(views) == {"synced": 2, "error": 1}
    assert [v.key for v in filter_views(views, "synced")] == ["b", "c"]
    assert len(filter_views(views, None)) == 3
    assert [v.key for v in sort_views(views, "played", descending=False)] == ["c", "a", "b"]


def test_format_when_renders_local_time_or_a_dash():
    assert re.fullmatch(r"\d\d/\d\d/\d{4} \d\d:\d\d", format_when("2026-09-30T19:14:03Z"))
    assert format_when(None) == "—"
    assert format_when("not a date") == "—"
```

- [ ] **Step 2: Write the failing SyncState tests**

Create `daemon-python/tests/test_sync_state_display.py`:

```python
import sqlite3
from pathlib import Path

from src.ingestion import display_fields
from src.sync_state import SyncState


def test_old_database_gains_the_display_columns(tmp_path: Path):
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE replays (replay_hash TEXT PRIMARY KEY, file_path TEXT NOT NULL DEFAULT '', "
        "status TEXT NOT NULL CHECK (status IN ('synced','error')), parser_version TEXT, api_version TEXT, "
        "match_id TEXT, synced_at TEXT, last_attempt_at TEXT NOT NULL, error_message TEXT, error_log TEXT, "
        "file_exists INTEGER NOT NULL DEFAULT 1)"
    )
    conn.execute("INSERT INTO replays (replay_hash, status, last_attempt_at) VALUES ('h', 'synced', 'x')")
    conn.commit()
    conn.close()
    state = SyncState(path)
    row = state.all_rows()[0]
    assert (row.hero, row.game_mode, row.played_at, row.won, row.base_build, row.error_kind) == (None,) * 6


def test_mark_synced_stores_display_fields_and_resync_without_them_keeps_them(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_synced(
        "h", "1.19", file_path="a", match_id="m1", map_slug="cursed-hollow",
        base_build=96477, hero="Xalatath", game_mode="ARAM", played_at="2026-09-30T19:14:03Z", won=False,
    )
    state.mark_synced("h", "1.19", file_path="a", match_id="m1", map_slug="cursed-hollow")
    row = state.all_rows()[0]
    assert (row.hero, row.game_mode, row.won, row.base_build) == ("Xalatath", "ARAM", False, 96477)


def test_mark_error_records_kind_and_build(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_error("h", "a", "unknown build", None, error_kind="quarantine", base_build=93943)
    row = state.all_rows()[0]
    assert (row.status, row.error_kind, row.base_build) == ("error", "quarantine", 93943)
    assert [r.replay_hash for r in state.rows_quarantined()] == ["h"]


def test_rows_needing_enrichment_only_lists_synced_rows_with_a_match_and_a_gap(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_synced("gap", "1.19", file_path="a", match_id="m1")
    state.mark_synced("full", "1.19", file_path="b", match_id="m2", hero="A", game_mode="ARAM",
                      played_at="2026-01-01T00:00:00Z", won=True)
    state.mark_synced("nomatch", "1.19", file_path="c")
    state.mark_skipped("skipped", "d", "ai_player", "AI", "1.19")
    assert [r.replay_hash for r in state.rows_needing_enrichment()] == ["gap"]


def test_apply_match_info_fills_gaps_without_erasing_known_values(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_synced("h", "1.19", file_path="a", match_id="m1", hero="Known")
    state.apply_match_info("m1", map_slug="cursed-hollow", game_mode="ARAM",
                           played_at="2026-09-30T19:14:03Z", hero=None, won=True)
    row = state.all_rows()[0]
    assert (row.hero, row.map_slug, row.game_mode, row.won) == ("Known", "cursed-hollow", "ARAM", True)


def test_reconcile_quarantined_turns_the_row_into_a_synced_one(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_error("h", "a", "unknown build", "tb", error_kind="quarantine", base_build=93943)
    state.reconcile_quarantined("h", "m9", "1.19", map_slug="cursed-hollow", game_mode="ARAM",
                                played_at="2026-09-30T19:14:03Z", hero="Xalatath", won=True)
    row = state.all_rows()[0]
    assert (row.status, row.error_kind, row.error_message, row.match_id, row.parser_version) == (
        "synced", None, None, "m9", "1.19")
    assert state.rows_quarantined() == []


def test_display_fields_picks_the_players_own_hero_and_result():
    payload = {
        "m_baseBuild": 96477, "gameMode": "StormLeague", "playedAt": "2026-09-30T19:14:03Z",
        "selfBattletag": "Me#1234",
        "players": [{"battletag": "Other#1", "heroId": "Abathur", "winner": True},
                    {"battletag": "Me#1234", "heroId": "Xalatath", "winner": False}],
    }
    assert display_fields(payload) == {
        "base_build": 96477, "game_mode": "StormLeague", "played_at": "2026-09-30T19:14:03Z",
        "hero": "Xalatath", "won": False,
    }


def test_display_fields_without_a_self_battletag_leaves_hero_and_result_empty():
    fields = display_fields({"gameMode": "ARAM", "players": [{"battletag": "A#1", "heroId": "X", "winner": True}]})
    assert (fields["hero"], fields["won"]) == (None, None)
```

Add to `daemon-python/tests/test_app.py` (after the existing `_sync_api_version` tests; `_config` helper already exists there):

```python
def test_sync_api_version_remembers_the_api_minimum_parser_version(tmp_path):
    state = SyncState(tmp_path / "s.db")
    info = {"apiVersion": "9", "minParserVersion": "1.16", "dataResetAt": None}
    with patch("src.app.api_client.fetch_version", return_value=info):
        _sync_api_version(_config(tmp_path), state)
    assert state.get_meta("min_parser_version") == "1.16"
```

- [ ] **Step 3: Run to verify failures**

Run: `cd daemon-python && pytest tests/test_sync_view.py tests/test_sync_state_display.py tests/test_app.py -q -k "view or display or minimum_parser"`
Expected: FAIL (`ImportError: ReplayRow`).

- [ ] **Step 4: Implement the `SyncState` changes**

In `sync_state.py`:

1. Add migration (below `_ensure_map_slug_column`):

```python
def _ensure_display_columns(conn: sqlite3.Connection) -> None:
    """Adds the columns the Sync tab's table shows (see sync_view.py) plus `error_kind`, which
    is how a quarantined replay is told apart from other errors without widening `status`'s
    CHECK constraint (see `_ensure_skip_reason_column` for why that matters). Same ADD COLUMN
    + ignore-duplicate pattern as the other `_ensure_*` migrations."""
    for ddl in (
        "ALTER TABLE replays ADD COLUMN error_kind TEXT",
        "ALTER TABLE replays ADD COLUMN base_build INTEGER",
        "ALTER TABLE replays ADD COLUMN hero TEXT",
        "ALTER TABLE replays ADD COLUMN game_mode TEXT",
        "ALTER TABLE replays ADD COLUMN played_at TEXT",
        "ALTER TABLE replays ADD COLUMN won INTEGER",
    ):
        try:
            conn.execute(ddl)
            conn.commit()
        except sqlite3.OperationalError as err:
            if "duplicate column" not in str(err).lower():
                raise
```

and call `_ensure_display_columns(conn)` in `_open` after `_ensure_map_slug_column(conn)`.

2. Add the dataclass above `class SyncState`:

```python
@dataclass(frozen=True)
class ReplayRow:
    """One tracked replay as the Sync tab's table needs it (see sync_view.py)."""

    replay_hash: str
    file_path: str = ""
    status: str = "synced"
    parser_version: str | None = None
    match_id: str | None = None
    synced_at: str | None = None
    last_attempt_at: str = ""
    error_message: str | None = None
    error_kind: str | None = None
    skip_reason: str | None = None
    file_exists: bool = True
    map_slug: str | None = None
    base_build: int | None = None
    hero: str | None = None
    game_mode: str | None = None
    played_at: str | None = None
    won: bool | None = None
```

3. Replace `mark_synced` with a version that takes and stores the new fields (keep existing parameters; add `base_build: int | None = None, hero: str | None = None, game_mode: str | None = None, played_at: str | None = None, won: bool | None = None`). SQL becomes:

```python
            self._conn.execute(
                """
                INSERT INTO replays
                    (replay_hash, file_path, status, parser_version, api_version,
                     match_id, synced_at, last_attempt_at, error_message, error_log, file_exists, map_slug,
                     base_build, hero, game_mode, played_at, won, error_kind)
                VALUES (?, ?, 'synced', ?, ?, ?, ?, ?, NULL, NULL, 1, ?, ?, ?, ?, ?, ?, NULL)
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
                    error_kind = NULL,
                    file_exists = 1,
                    skip_reason = NULL,
                    map_slug = excluded.map_slug,
                    base_build = COALESCE(excluded.base_build, base_build),
                    hero = COALESCE(excluded.hero, hero),
                    game_mode = COALESCE(excluded.game_mode, game_mode),
                    played_at = COALESCE(excluded.played_at, played_at),
                    won = COALESCE(excluded.won, won)
                """,
                (
                    replay_hash, file_path, parser_version, api_version, match_id, now, now, map_slug,
                    base_build, hero, game_mode, played_at, None if won is None else int(won),
                ),
            )
```

4. `mark_error`: add parameters `error_kind: str | None = None, base_build: int | None = None`; INSERT column list gains `error_kind, base_build` (values `?, ?` appended to the params tuple) and the `DO UPDATE SET` gains `error_kind = excluded.error_kind, base_build = COALESCE(excluded.base_build, base_build),`.

5. New methods at the end of the "sync status" group:

```python
    _ROW_COLUMNS = (
        "replay_hash, file_path, status, parser_version, match_id, synced_at, last_attempt_at, "
        "error_message, error_kind, skip_reason, file_exists, map_slug, base_build, hero, "
        "game_mode, played_at, won"
    )

    @staticmethod
    def _to_row(r: tuple) -> ReplayRow:
        return ReplayRow(
            replay_hash=r[0], file_path=r[1], status=r[2], parser_version=r[3], match_id=r[4],
            synced_at=r[5], last_attempt_at=r[6], error_message=r[7], error_kind=r[8],
            skip_reason=r[9], file_exists=bool(r[10]), map_slug=r[11], base_build=r[12],
            hero=r[13], game_mode=r[14], played_at=r[15], won=None if r[16] is None else bool(r[16]),
        )

    def _rows(self, where: str = "") -> list[ReplayRow]:
        with self._lock:
            rows = self._conn.execute(f"SELECT {self._ROW_COLUMNS} FROM replays {where}").fetchall()
        return [self._to_row(r) for r in rows]

    def all_rows(self) -> list[ReplayRow]:
        """Every tracked replay, for the Sync tab's table (thousands of small rows: one query)."""
        return self._rows()

    def rows_needing_enrichment(self) -> list[ReplayRow]:
        """Synced rows with a known match but missing display data (anything synced before the
        display columns existed) -- filled by `HistoryEnricher` from the API, without reparsing."""
        return self._rows(
            "WHERE status = 'synced' AND skip_reason IS NULL AND match_id IS NOT NULL AND "
            "(hero IS NULL OR game_mode IS NULL OR played_at IS NULL OR won IS NULL)"
        )

    def rows_quarantined(self) -> list[ReplayRow]:
        return self._rows("WHERE status = 'error' AND error_kind = 'quarantine'")

    def apply_match_info(
        self, match_id: str, *, map_slug: str | None, game_mode: str | None,
        played_at: str | None, hero: str | None, won: bool | None,
    ) -> None:
        with self._lock:
            self._conn.execute(
                """
                UPDATE replays SET
                    map_slug = COALESCE(?, map_slug), game_mode = COALESCE(?, game_mode),
                    played_at = COALESCE(?, played_at), hero = COALESCE(?, hero), won = COALESCE(?, won)
                WHERE match_id = ?
                """,
                (map_slug, game_mode, played_at, hero, None if won is None else int(won), match_id),
            )
            self._conn.commit()

    def reconcile_quarantined(
        self, replay_hash: str, match_id: str, parser_version: str, *, map_slug: str | None,
        game_mode: str | None, played_at: str | None, hero: str | None, won: bool | None,
    ) -> None:
        """The server verified the build and inserted the quarantined replay: record it as
        synced (at the parser version the *server* stored) without re-parsing or re-uploading."""
        now = _now()
        with self._lock:
            self._conn.execute(
                """
                UPDATE replays SET status = 'synced', parser_version = ?, match_id = ?, synced_at = ?,
                    last_attempt_at = ?, error_message = NULL, error_log = NULL, error_kind = NULL,
                    map_slug = COALESCE(?, map_slug), game_mode = COALESCE(?, game_mode),
                    played_at = COALESCE(?, played_at), hero = COALESCE(?, hero), won = COALESCE(?, won)
                WHERE replay_hash = ? AND status = 'error' AND error_kind = 'quarantine'
                """,
                (parser_version, match_id, now, now, map_slug, game_mode, played_at, hero,
                 None if won is None else int(won), replay_hash),
            )
            self._conn.commit()
```

- [ ] **Step 5: Implement `sync_view.py`**

Create `daemon-python/src/sync_view.py`:

```python
"""Turns `SyncState` rows plus the upload scheduler's live queue into the rows the Sync tab's
table shows. Pure (no tkinter, no I/O) so it is unit-tested directly.

The 8 display states are *derived*, never stored, because `replays.status` has a CHECK
constraint limiting it to 'synced'/'error' (see sync_state._ensure_skip_reason_column).
`pending` / `uploading` have no row at all -- a row is keyed by content hash, unknown until
the scheduler reads the file -- so they arrive via `live` (file path -> state).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .sync_state import ReplayRow, _version_gte

STATES = ("pending", "uploading", "synced", "outdated", "error", "quarantined", "skipped", "missing")
STATE_LABELS = {
    "pending": "En attente",
    "uploading": "Envoi…",
    "synced": "À jour",
    "outdated": "À renvoyer",
    "error": "Erreur",
    "quarantined": "Build non géré",
    "skipped": "Ignorée",
    "missing": "Fichier absent",
}
_DASH = "—"


@dataclass(frozen=True)
class SyncRowView:
    key: str  # replay hash, or "path:<path>" for a file with no row yet
    state: str
    label: str
    played: str  # display strings
    uploaded: str
    result: str
    build: str
    file_path: str
    file_exists: bool
    detail: str | None  # error / skip message, shown on hover
    sort_at: str  # ISO string used for the default most-recent-first order
    played_raw: str
    uploaded_raw: str


def derive_state(row: ReplayRow, min_parser_version: str | None) -> str:
    if row.status == "error":
        if not row.file_exists:
            return "missing"
        return "quarantined" if row.error_kind == "quarantine" else "error"
    if row.skip_reason:
        return "skipped"
    if min_parser_version and row.parser_version and not _version_gte(row.parser_version, min_parser_version):
        return "outdated"
    return "synced"


def _pretty(value: str) -> str:
    text = value.replace("-", " ").replace("_", " ")
    return text.title() if text == text.lower() else text


def format_when(iso: str | None) -> str:
    """ISO timestamp -> `dd/mm/yyyy hh:mm` in local time; a dash when absent or unparseable."""
    if not iso:
        return _DASH
    try:
        moment = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return _DASH
    if moment.tzinfo is not None:
        moment = moment.astimezone()
    return moment.strftime("%d/%m/%Y %H:%M")


def _label(row: ReplayRow) -> str:
    parts = [
        _pretty(row.map_slug) if row.map_slug else None,
        _pretty(row.hero) if row.hero else None,
        row.game_mode or None,
    ]
    shown = [p for p in parts if p]
    return " · ".join(shown) if shown else Path(row.file_path).stem or row.replay_hash[:8]


def _result(won: bool | None) -> str:
    return _DASH if won is None else ("Victoire" if won else "Défaite")


def build_views(
    rows: list[ReplayRow], live: dict[str, str], min_parser_version: str | None
) -> list[SyncRowView]:
    views: list[SyncRowView] = []
    seen: set[str] = set()
    for row in rows:
        seen.add(row.file_path)
        views.append(
            SyncRowView(
                key=row.replay_hash,
                state=live.get(row.file_path) or derive_state(row, min_parser_version),
                label=_label(row),
                played=format_when(row.played_at),
                uploaded=format_when(row.synced_at),
                result=_result(row.won),
                build=str(row.base_build) if row.base_build else _DASH,
                file_path=row.file_path,
                file_exists=row.file_exists,
                detail=row.error_message,
                sort_at=row.played_at or row.synced_at or row.last_attempt_at,
                played_raw=row.played_at or "",
                uploaded_raw=row.synced_at or "",
            )
        )
    for path, state in live.items():
        if path in seen:
            continue
        views.append(
            SyncRowView(
                key=f"path:{path}", state=state, label=Path(path).stem, played=_DASH, uploaded=_DASH,
                result=_DASH, build=_DASH, file_path=path, file_exists=True, detail=None,
                sort_at="", played_raw="", uploaded_raw="",
            )
        )
    return sorted(views, key=lambda v: v.sort_at, reverse=True)


def count_by_state(views: list[SyncRowView]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for view in views:
        counts[view.state] = counts.get(view.state, 0) + 1
    return counts


def filter_views(views: list[SyncRowView], state: str | None) -> list[SyncRowView]:
    return list(views) if state is None else [v for v in views if v.state == state]


_SORT_KEYS = {
    "label": lambda v: v.label.lower(),
    "played": lambda v: v.played_raw,
    "uploaded": lambda v: v.uploaded_raw,
    "result": lambda v: v.result,
    "state": lambda v: v.state,
    "build": lambda v: v.build,
}


def sort_views(views: list[SyncRowView], column: str, *, descending: bool) -> list[SyncRowView]:
    return sorted(views, key=_SORT_KEYS[column], reverse=descending)
```

- [ ] **Step 6: Wire `ingestion.py` and `app.py`**

`ingestion.py`: add

```python
def display_fields(payload: dict) -> dict:
    """The few payload fields the Sync tab shows, so a freshly uploaded replay's row is complete
    without asking the API. Hero/result are the *account owner's* (`selfBattletag`), absent when
    the replay's folder account didn't play in it."""
    self_tag = payload.get("selfBattletag")
    me = next((p for p in payload.get("players", []) if self_tag and p.get("battletag") == self_tag), None)
    return {
        "base_build": payload.get("m_baseBuild"),
        "game_mode": payload.get("gameMode"),
        "played_at": payload.get("playedAt"),
        "hero": me.get("heroId") if me else None,
        "won": me.get("winner") if me else None,
    }
```

pass `**display_fields(payload)` as extra keyword arguments to the `sync_state.mark_synced(...)` call in `ingest_file`, and in the `QuarantinedError` branch change its `mark_error` call to `sync_state.mark_error(payload["replayHash"], str(path), str(err), traceback.format_exc(), error_kind="quarantine", base_build=err.base_build)`.

`app.py` `_sync_api_version`: inside `if min_parser_version:` before `invalidate_stale`, add `sync_state.set_meta("min_parser_version", min_parser_version)`.

- [ ] **Step 7: Run to verify**

Run: `cd daemon-python && pytest -q`
Expected: PASS (new tests plus the whole suite).

- [ ] **Step 8: Commit**

```bash
git add daemon-python
git commit -m "feat(daemon): track display columns and derive upload states for the sync table

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Daemon — `UploadScheduler` (one worker, pause while the game runs)

**Files:**
- Create: `daemon-python/src/game_process.py`
- Create: `daemon-python/src/upload_scheduler.py`
- Create: `daemon-python/tests/test_game_process.py`
- Create: `daemon-python/tests/test_upload_scheduler.py`
- Modify: `daemon-python/src/ingestion.py` (`IngestOutcome.error_kind`)
- Modify: `daemon-python/src/app.py` (`_run_sync_loop`, `_DaemonRunner`)
- Modify: `daemon-python/tests/test_app.py` (the 4 `_run_sync_loop` tests)

**Interfaces:**
- Consumes: `ErrorReporter.flush` (Task 2) as `on_idle`; `IngestOutcome` from `ingestion.py`.
- Produces: `GameDetector(lister=..., ttl=5.0, clock=...)` with `.is_running()`; `UploadScheduler(ingest, *, stop_event, is_game_running, sync_during_game, backlog_gate, backlog_pause, on_idle, on_auth_blocked, on_thread_start, wait, poll_seconds, backoff_base, backoff_max, max_requeues)` with `.start()`, `.stop()`, `.enqueue_new(path, toon)`, `.enqueue_backlog(items)`, `.set_mode(mode)`, `.mode`, `.snapshot() -> SchedulerSnapshot(live, mode, blocked)`, `.step() -> bool`; constants `MODE_AUTO`, `MODE_PAUSED`, `SYNC_DURING_GAME_META_KEY`; `IngestOutcome.error_kind: str | None` (`"auth"` / `"server"` / `None`); `_DaemonRunner.scheduler`.

- [ ] **Step 1: Write the failing game-detection tests**

Create `daemon-python/tests/test_game_process.py`:

```python
import sys

import pytest

from src.game_process import GameDetector, _list_process_names


def test_detects_the_game_case_insensitively():
    detector = GameDetector(lister=lambda: ["explorer.exe", "HeroesOfTheStorm_x64.exe"])
    assert detector.is_running() is True


def test_other_processes_do_not_count():
    assert GameDetector(lister=lambda: ["chrome.exe", "HeroesLauncher.exe"]).is_running() is False


def test_result_is_cached_for_the_ttl_then_refreshed():
    calls: list[int] = []
    now = {"t": 0.0}

    def lister() -> list[str]:
        calls.append(1)
        return ["HeroesOfTheStorm_x64.exe"] if len(calls) == 1 else []

    detector = GameDetector(lister=lister, ttl=5.0, clock=lambda: now["t"])
    assert detector.is_running() is True
    now["t"] = 4.0
    assert detector.is_running() is True and len(calls) == 1
    now["t"] = 5.0
    assert detector.is_running() is False and len(calls) == 2


def test_a_failing_lister_means_not_running():
    def boom() -> list[str]:
        raise OSError("snapshot failed")

    assert GameDetector(lister=boom).is_running() is False


@pytest.mark.skipif(sys.platform != "win32", reason="Windows process snapshot")
def test_real_process_listing_returns_names_including_this_interpreter():
    names = [n.lower() for n in _list_process_names()]
    assert any(n.startswith("python") for n in names)
```

- [ ] **Step 2: Implement `game_process.py`**

Create `daemon-python/src/game_process.py`:

```python
"""Is Heroes of the Storm running right now? Lets the upload scheduler hold the *backlog*
back while the player is in the game (see upload_scheduler.py).

Uses the Win32 process snapshot through `ctypes` rather than `psutil`, so the frozen exe
doesn't gain a dependency for one boolean. Non-Windows (dev machines running the tests)
always reports "not running".
"""

from __future__ import annotations

import ctypes
import logging
import sys
import time
from ctypes import wintypes
from typing import Callable

logger = logging.getLogger(__name__)

GAME_PROCESS_NAMES = frozenset({"heroesofthestorm_x64.exe", "heroesofthestorm.exe"})
_TH32CS_SNAPPROCESS = 0x00000002


def _list_process_names() -> list[str]:
    if sys.platform != "win32":
        return []

    class PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", ctypes.c_wchar * 260),
        ]

    kernel32 = ctypes.windll.kernel32
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

    snapshot = kernel32.CreateToolhelp32Snapshot(_TH32CS_SNAPPROCESS, 0)
    if snapshot in (None, ctypes.c_void_p(-1).value):
        return []
    names: list[str] = []
    try:
        entry = PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(entry)
        ok = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        while ok:
            names.append(entry.szExeFile)
            ok = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snapshot)
    return names


class GameDetector:
    """Caches the answer for `ttl` seconds: the scheduler asks before every backlog file, and a
    process snapshot per file would be wasted work."""

    def __init__(
        self,
        *,
        lister: Callable[[], list[str]] = _list_process_names,
        ttl: float = 5.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._lister = lister
        self._ttl = ttl
        self._clock = clock
        self._checked_at: float | None = None
        self._running = False

    def is_running(self) -> bool:
        now = self._clock()
        if self._checked_at is None or now - self._checked_at >= self._ttl:
            try:
                self._running = any(name.lower() in GAME_PROCESS_NAMES for name in self._lister())
            except Exception:  # noqa: BLE001 -- detection is a courtesy, never a reason to stall the sync
                logger.debug("Game process detection failed", exc_info=True)
                self._running = False
            self._checked_at = now
        return self._running
```

- [ ] **Step 3: Run game tests**

Run: `cd daemon-python && pytest tests/test_game_process.py -q`
Expected: PASS.

- [ ] **Step 4: Write the failing scheduler tests**

Create `daemon-python/tests/test_upload_scheduler.py`:

```python
import threading
from pathlib import Path

from src.ingestion import IngestOutcome
from src.upload_scheduler import MODE_AUTO, MODE_PAUSED, UploadScheduler


def _p(name: str) -> Path:
    return Path(f"C:/r/{name}.StormReplay")


class Harness:
    def __init__(self, **kwargs) -> None:
        self.ingested: list[Path] = []
        self.waits: list[float] = []
        self.outcomes: dict[Path, IngestOutcome] = {}
        self.game = False
        self.auth_blocked = 0
        self.idle = 0

        def ingest(path: Path, _toon: str | None) -> IngestOutcome:
            self.ingested.append(path)
            return self.outcomes.get(path, IngestOutcome("uploaded"))

        defaults = dict(
            stop_event=threading.Event(),
            is_game_running=lambda: self.game,
            on_idle=lambda: setattr(self, "idle", self.idle + 1),
            on_auth_blocked=lambda: setattr(self, "auth_blocked", self.auth_blocked + 1),
            wait=self.waits.append,
            poll_seconds=0,
        )
        defaults.update(kwargs)
        self.scheduler = UploadScheduler(ingest, **defaults)

    def drain(self, limit: int = 50) -> None:
        for _ in range(limit):
            if not self.scheduler.step():
                return


def test_new_replays_go_before_the_backlog():
    h = Harness()
    h.scheduler.enqueue_backlog([(_p("old1"), None), (_p("old2"), None)])
    h.scheduler.enqueue_new(_p("fresh"), None)
    h.drain()
    assert [p.stem.split(".")[0] for p in h.ingested] == ["fresh", "old1", "old2"]


def test_backlog_files_are_followed_by_a_pause_but_new_ones_are_not():
    h = Harness(backlog_pause=1.0)
    h.scheduler.enqueue_new(_p("fresh"), None)
    h.scheduler.enqueue_backlog([(_p("old"), None)])
    h.drain()
    assert h.waits == [1.0]


def test_backlog_waits_while_the_game_runs_but_new_replays_still_upload():
    h = Harness()
    h.game = True
    h.scheduler.enqueue_backlog([(_p("old"), None)])
    h.scheduler.enqueue_new(_p("fresh"), None)
    h.drain()
    assert [p.stem.split(".")[0] for p in h.ingested] == ["fresh"]
    assert h.scheduler.snapshot().blocked == "game"
    h.game = False
    h.drain()
    assert [p.stem.split(".")[0] for p in h.ingested] == ["fresh", "old"]


def test_paused_mode_blocks_the_backlog_even_without_the_game():
    h = Harness()
    h.scheduler.set_mode(MODE_PAUSED)
    h.scheduler.enqueue_backlog([(_p("old"), None)])
    h.drain()
    assert h.ingested == []
    assert h.scheduler.snapshot().blocked == "paused"
    h.scheduler.set_mode(MODE_AUTO)
    h.drain()
    assert len(h.ingested) == 1


def test_sync_during_game_setting_overrides_the_game_check():
    h = Harness(sync_during_game=lambda: True)
    h.game = True
    h.scheduler.enqueue_backlog([(_p("old"), None)])
    h.drain()
    assert len(h.ingested) == 1


def test_backlog_gate_blocks_the_backlog_only():
    h = Harness(backlog_gate=lambda: False)
    h.scheduler.enqueue_backlog([(_p("old"), None)])
    h.scheduler.enqueue_new(_p("fresh"), None)
    h.drain()
    assert [p.stem.split(".")[0] for p in h.ingested] == ["fresh"]
    assert h.scheduler.snapshot().blocked == "dependency"


def test_auth_error_stops_everything_and_notifies_once():
    h = Harness()
    h.outcomes[_p("a")] = IngestOutcome("error", "token rejected", error_kind="auth")
    h.scheduler.enqueue_backlog([(_p("a"), None), (_p("b"), None), (_p("c"), None)])
    h.drain()
    assert len(h.ingested) == 1
    assert h.auth_blocked == 1
    assert h.scheduler.snapshot().blocked == "auth"
    h.scheduler.enqueue_new(_p("d"), None)
    h.drain()
    assert len(h.ingested) == 1


def test_server_errors_back_off_exponentially_and_requeue_at_most_twice():
    h = Harness(backoff_base=2.0, backoff_max=300.0, max_requeues=2)
    h.outcomes[_p("flaky")] = IngestOutcome("error", "502", error_kind="server")
    h.scheduler.enqueue_new(_p("flaky"), None)
    h.drain()
    assert len(h.ingested) == 3  # first try + 2 re-queues
    assert h.waits == [2.0, 4.0, 8.0]


def test_a_success_resets_the_backoff():
    h = Harness(backoff_base=2.0)
    h.outcomes[_p("flaky")] = IngestOutcome("error", "502", error_kind="server")
    h.scheduler.enqueue_new(_p("flaky"), None)
    h.scheduler.step()
    h.outcomes.pop(_p("flaky"))
    h.drain()
    h.outcomes[_p("later")] = IngestOutcome("error", "502", error_kind="server")
    h.scheduler.enqueue_new(_p("later"), None)
    h.scheduler.step()
    assert h.waits[-1] == 2.0


def test_snapshot_reports_queued_files_as_pending_and_clears_them_when_done():
    h = Harness()
    h.scheduler.enqueue_backlog([(_p("old"), None)])
    assert h.scheduler.snapshot().live == {str(_p("old")): "pending"}
    h.drain()
    assert h.scheduler.snapshot().live == {}


def test_idle_ticks_call_on_idle():
    h = Harness()
    assert h.scheduler.step() is False
    assert h.idle == 1
```

- [ ] **Step 5: Run to verify failure**

Run: `cd daemon-python && pytest tests/test_upload_scheduler.py -q`
Expected: FAIL (module missing).

- [ ] **Step 6: Add `error_kind` to `IngestOutcome`**

In `ingestion.py`, add to `IngestOutcome` (after `skip_reason`):

```python
    # Set on `status == "error"` for the two kinds the scheduler reacts to: "auth" (every later
    # request will fail the same way -- stop) and "server" (network/5xx after `post_replay`'s own
    # retries -- back off). None for everything else (a bad replay says nothing about the API).
    error_kind: str | None = None
```

and set it in two return statements: the `api_client.AuthError` branch returns `IngestOutcome("error", str(err), error_kind="auth")`; the `api_client.ApiClientError` branch returns `IngestOutcome("error", str(err), error_kind="server")`. (The `ValidationError`, `QuarantinedError`, parse and catch-all branches keep `None`.)

- [ ] **Step 7: Implement `upload_scheduler.py`**

Create `daemon-python/src/upload_scheduler.py`:

```python
"""Uploads replays one at a time, so syncing never competes with a game being played.

Replaces the 4-thread pool the initial backlog used to run through (`app._run_sync_loop`):
one worker thread, one HTTP session (the one inside `ApiClient`), two queues.

- **new** replays (a game just ended, seen by `watch_replays`) always go first and are never
  held back -- one file is cheap and the player wants it on the dashboard.
- the **backlog** (everything already on disk at startup) drains slowly, `backlog_pause`
  seconds apart, and is held back while Heroes of the Storm is running (unless the player
  turned on "Synchroniser pendant le jeu"), while the player paused it, or while the
  `backlog_gate` says no (daemon's `heroprotocol` too old, see dependency_guard.py).
- an auth failure stops *everything* (every later request would fail the same way, and
  `ingest_file` would mark each file as an error); a network/5xx failure backs off
  exponentially and re-queues the file at most `max_requeues` times.

`step()` does one unit of work and is what the tests drive; the thread just loops over it.
"""

from __future__ import annotations

import logging
import threading
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .ingestion import IngestOutcome

logger = logging.getLogger(__name__)

MODE_AUTO = "auto"
MODE_PAUSED = "paused"
# `SyncState` meta key behind the "Synchroniser pendant le jeu" checkbox ("1" / "0"). Stored
# there rather than in config.json so toggling it needs no daemon restart.
SYNC_DURING_GAME_META_KEY = "sync_during_game"


@dataclass
class _Item:
    path: Path
    toon: str | None
    backlog: bool
    attempts: int = 0


@dataclass(frozen=True)
class SchedulerSnapshot:
    live: dict[str, str]  # file path -> "pending" | "uploading"
    mode: str
    blocked: str | None  # "auth" | "paused" | "game" | "dependency" | None


class UploadScheduler:
    def __init__(
        self,
        ingest: Callable[[Path, str | None], IngestOutcome],
        *,
        stop_event: threading.Event,
        is_game_running: Callable[[], bool],
        sync_during_game: Callable[[], bool] = lambda: False,
        backlog_gate: Callable[[], bool] = lambda: True,
        backlog_pause: float = 1.0,
        on_idle: Callable[[], None] | None = None,
        on_auth_blocked: Callable[[], None] | None = None,
        on_thread_start: Callable[[], None] | None = None,
        wait: Callable[[float], object] | None = None,
        poll_seconds: float = 1.0,
        backoff_base: float = 2.0,
        backoff_max: float = 300.0,
        max_requeues: int = 2,
    ) -> None:
        self._ingest = ingest
        self._stop = stop_event
        self._is_game_running = is_game_running
        self._sync_during_game = sync_during_game
        self._backlog_gate = backlog_gate
        self._backlog_pause = backlog_pause
        self._on_idle = on_idle
        self._on_auth_blocked = on_auth_blocked
        self._on_thread_start = on_thread_start
        self._wait = wait if wait is not None else stop_event.wait
        self._poll = poll_seconds
        self._backoff_base = backoff_base
        self._backoff_max = backoff_max
        self._max_requeues = max_requeues
        self._cond = threading.Condition()
        self._new: deque[_Item] = deque()
        self._backlog: deque[_Item] = deque()
        self._live: dict[str, str] = {}
        self._mode = MODE_AUTO
        self._auth_blocked = False
        self._consecutive_server_errors = 0
        self._thread: threading.Thread | None = None

    # -- public ---------------------------------------------------------

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="hots-upload-scheduler", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 10.0) -> None:
        self._stop.set()
        with self._cond:
            self._cond.notify_all()
        if self._thread is not None:
            self._thread.join(timeout=timeout)

    def enqueue_new(self, path: Path, toon: str | None) -> None:
        with self._cond:
            self._new.append(_Item(path, toon, backlog=False))
            self._live[str(path)] = "pending"
            self._cond.notify_all()

    def enqueue_backlog(self, items: list[tuple[Path, str | None]]) -> None:
        with self._cond:
            for path, toon in items:
                self._backlog.append(_Item(path, toon, backlog=True))
                self._live[str(path)] = "pending"
            self._cond.notify_all()

    @property
    def mode(self) -> str:
        return self._mode

    def set_mode(self, mode: str) -> None:
        with self._cond:
            self._mode = mode
            self._cond.notify_all()

    def snapshot(self) -> SchedulerSnapshot:
        with self._cond:
            return SchedulerSnapshot(dict(self._live), self._mode, self._blocked_reason())

    def step(self) -> bool:
        item = self._take()
        if item is None:
            if self._on_idle is not None:
                try:
                    self._on_idle()
                except Exception:  # noqa: BLE001 -- an idle hook must never kill the worker
                    logger.debug("Scheduler idle hook failed", exc_info=True)
            return False
        self._handle(item)
        return True

    # -- internals ------------------------------------------------------

    def _run(self) -> None:
        if self._on_thread_start is not None:
            self._on_thread_start()
        while not self._stop.is_set():
            self.step()

    def _backlog_allowed(self) -> bool:
        if not self._backlog_gate() or self._mode == MODE_PAUSED:
            return False
        return self._sync_during_game() or not self._is_game_running()

    def _blocked_reason(self) -> str | None:
        if self._auth_blocked:
            return "auth"
        if not self._backlog:
            return None
        if self._mode == MODE_PAUSED:
            return "paused"
        if not self._backlog_gate():
            return "dependency"
        if not self._sync_during_game() and self._is_game_running():
            return "game"
        return None

    def _take(self) -> _Item | None:
        with self._cond:
            if not self._auth_blocked:
                item = None
                if self._new:
                    item = self._new.popleft()
                elif self._backlog and self._backlog_allowed():
                    item = self._backlog.popleft()
                if item is not None:
                    self._live[str(item.path)] = "uploading"
                    return item
            self._cond.wait(self._poll)
            return None

    def _handle(self, item: _Item) -> None:
        try:
            outcome = self._ingest(item.path, item.toon)
        except Exception as err:  # noqa: BLE001 -- ingest_file never raises; belt and braces
            logger.exception("Unexpected failure ingesting %s", item.path)
            outcome = IngestOutcome("error", f"{type(err).__name__}: {err}")

        requeue = False
        if outcome.error_kind == "auth":
            with self._cond:
                self._auth_blocked = True
                self._live.pop(str(item.path), None)
            logger.error("Upload paused: the access token was rejected.")
            if self._on_auth_blocked is not None:
                self._on_auth_blocked()
            return
        if outcome.error_kind == "server":
            delay = min(self._backoff_max, self._backoff_base * (2 ** self._consecutive_server_errors))
            self._consecutive_server_errors += 1
            self._wait(delay)
            requeue = item.attempts < self._max_requeues
        else:
            self._consecutive_server_errors = 0

        with self._cond:
            if requeue:
                item.attempts += 1
                (self._backlog if item.backlog else self._new).append(item)
                self._live[str(item.path)] = "pending"
            else:
                self._live.pop(str(item.path), None)
        if item.backlog and not requeue:
            self._wait(self._backlog_pause)
```

Note: `test_a_success_resets_the_backoff` relies on `_consecutive_server_errors` resetting on any non-`server` outcome, as written above.

- [ ] **Step 8: Run scheduler tests**

Run: `cd daemon-python && pytest tests/test_upload_scheduler.py tests/test_game_process.py -q`
Expected: PASS. If `test_backlog_files_are_followed_by_a_pause_but_new_ones_are_not` fails with an extra `1.0`, check `_handle` only waits `backlog_pause` for backlog items.

- [ ] **Step 9: Rewrite the four `_run_sync_loop` tests (failing)**

In `daemon-python/tests/test_app.py` add a helper above the first `_run_sync_loop` test:

```python
class _RecordingScheduler:
    """Stands in for UploadScheduler: records what `_run_sync_loop` hands it."""

    def __init__(self) -> None:
        self.backlog: list = []
        self.new: list = []

    def enqueue_backlog(self, items) -> None:
        self.backlog.extend(items)

    def enqueue_new(self, path, toon) -> None:
        self.new.append(path)
```

Then change each test: build `scheduler = _RecordingScheduler()`, call `_run_sync_loop([WatchDir(tmp_path, None)], scheduler, stop_event, status, ...)` instead of passing the lambda, and assert on the recorder:

- `..._ingests_existing_replays_before_watching`: `assert sorted(p for p, _ in scheduler.backlog) == sorted([a, b])` (drop the thread-pool comment); keep the `watch` assertions.
- `..._calls_on_initial_scan_once_with_the_found_count` and `..._with_zero_when_folder_is_empty`: only the scheduler argument changes (`_RecordingScheduler()` in place of `lambda _p, _t: None`).
- `..._stops_early_when_stop_event_set`: `assert scheduler.backlog == []`.
- `..._new_replay_callback_bumps_found_and_ingests`: `assert scheduler.new == [new_file]`.

Run: `cd daemon-python && pytest tests/test_app.py -q -k run_sync_loop` → FAIL (signature).

- [ ] **Step 10: Rewire `app.py`**

1. Remove `from concurrent.futures import ThreadPoolExecutor`, the `_INITIAL_SYNC_WORKERS` constant and its comment block. Keep `_lower_worker_priority` (now run by the scheduler thread; update its docstring's first sentence to "Runs once on the upload scheduler's worker thread (`UploadScheduler`'s `on_thread_start`)").
2. Imports: `from .game_process import GameDetector` and `from .upload_scheduler import SYNC_DURING_GAME_META_KEY, UploadScheduler`.
3. Replace `_run_sync_loop`'s signature and its `if existing:` pool block:

```python
def _run_sync_loop(
    watch_dirs: Sequence[WatchDir],
    scheduler,
    stop_event: threading.Event,
    status: StatusTracker,
    sync_state: SyncState | None = None,
    on_initial_scan: Callable[[int], None] | None = None,
) -> None:
```

with the docstring updated ("Hands every replay already on disk to `scheduler` as backlog, then watches for new ones, which it hands over as high-priority work"), the unchanged scanning code, and:

```python
    if existing and not stop_event.is_set():
        scheduler.enqueue_backlog([(path, toon_by_path.get(str(path))) for path in existing])
    if stop_event.is_set():
        return

    def _on_new_replay(path: Path) -> None:
        status.bump_found()
        toon_handle = toon_by_path.get(str(path), toon_by_dir.get(str(path.parent)))
        scheduler.enqueue_new(path, toon_handle)
```

(`watch_replays(...)` call unchanged.)
4. `_DaemonRunner.__init__`: `self.scheduler: UploadScheduler | None = None`.
5. In `start()`: make `_ingest_and_track` `return outcome` (and annotate `-> IngestOutcome`; import it from `.ingestion`), then before `_run` is defined add:

```python
        detector = GameDetector()
        scheduler = UploadScheduler(
            _ingest_and_track,
            stop_event=stop_event,
            is_game_running=detector.is_running,
            sync_during_game=lambda: sync_state.get_meta(SYNC_DURING_GAME_META_KEY) == "1",
            on_idle=reporter.flush,
            on_auth_blocked=self._notify_auth_blocked,
            on_thread_start=_lower_worker_priority,
        )
        self.scheduler = scheduler
        scheduler.start()
```

change `_run` to pass `scheduler` instead of `_ingest_and_track` to `_run_sync_loop`. Add the method:

```python
    def _notify_auth_blocked(self) -> None:
        if self._tray_notify is not None:
            self._tray_notify(
                "Le jeton d'accès a été refusé : la synchronisation est suspendue. "
                "Reconnectez-vous dans les paramètres.",
                "HotS Analytics",
            )
```

6. `stop()`: before joining the watcher thread, add `if self.scheduler is not None: self.scheduler.stop(); self.scheduler = None`.

- [ ] **Step 11: Run the full suite**

Run: `cd daemon-python && pytest -q`
Expected: PASS. A `_DaemonRunner` test that now hangs or errors is starting the real scheduler: make sure it calls `runner.stop()`, or patch `src.app.UploadScheduler` with a `MagicMock` in that test.

- [ ] **Step 12: Manual check (needs Windows + a replay folder)**

Run: `cd daemon-python && python -m src.main`
Expected: with a populated replays folder the backlog uploads about one file per second (watch `logging` output), the game being open pauses it (log nothing, uploads stop; check the process list).

- [ ] **Step 13: Commit**

```bash
git add daemon-python
git commit -m "feat(daemon): single-worker upload scheduler that yields to a running game

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: API lookup endpoint + daemon `HistoryEnricher`

**Files:**
- Create: `packages/shared-types/src/match-lookup.ts`, `packages/shared-types/src/match-lookup.test.ts`
- Modify: `packages/shared-types/src/index.ts`
- Create: `apps/api/src/services/match-lookup.service.ts`, `apps/api/src/services/match-lookup.service.test.ts`
- Modify: `apps/api/src/routes/ingest.ts`
- Modify: `daemon-python/src/api_client.py`
- Create: `daemon-python/src/history_enricher.py`, `daemon-python/tests/test_history_enricher.py`
- Modify: `daemon-python/tests/test_api_client.py`
- Modify: `daemon-python/src/app.py` (maintenance thread)

**Interfaces:**
- Consumes: `SyncState.rows_needing_enrichment / rows_quarantined / apply_match_info / reconcile_quarantined` (Task 3).
- Produces: `POST /ingest/matches/lookup` body `{replayHashes?: string[], matchIds?: string[]}` → `{matches: {matchId, replayHash, parserVersion, map, gameMode, playedAt, hero, won}[]}`; `ApiClient.lookup_matches(*, replay_hashes=(), match_ids=(), timeout=15.0) -> list[dict] | None`; `HistoryEnricher(client, sync_state, *, batch_size=200, pause_seconds=0.5, wait=time.sleep).run_once() -> int`; `_DaemonRunner` maintenance thread; `MATCH_LOOKUP_MAX = 200`.

- [ ] **Step 1: Failing shared-types test**

Create `packages/shared-types/src/match-lookup.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { MATCH_LOOKUP_MAX, matchLookupInputSchema } from "./match-lookup";

const hash = "a".repeat(64);
const id = "3f0c1a52-7d0e-4c55-9d73-0d3a4f3b5c11";

describe("matchLookupInputSchema", () => {
  test("accepts hashes, ids, or both", () => {
    expect(matchLookupInputSchema.safeParse({ replayHashes: [hash] }).success).toBe(true);
    expect(matchLookupInputSchema.safeParse({ matchIds: [id] }).success).toBe(true);
    expect(matchLookupInputSchema.safeParse({ replayHashes: [hash], matchIds: [id] }).success).toBe(true);
  });

  test("rejects an empty lookup", () => {
    expect(matchLookupInputSchema.safeParse({}).success).toBe(false);
    expect(matchLookupInputSchema.safeParse({ replayHashes: [], matchIds: [] }).success).toBe(false);
  });

  test("the limit is on hashes and ids combined", () => {
    const ids = Array.from({ length: MATCH_LOOKUP_MAX }, () => id);
    expect(matchLookupInputSchema.safeParse({ matchIds: ids }).success).toBe(true);
    expect(matchLookupInputSchema.safeParse({ matchIds: ids, replayHashes: [hash] }).success).toBe(false);
  });

  test("rejects a malformed match id", () => {
    expect(matchLookupInputSchema.safeParse({ matchIds: ["nope"] }).success).toBe(false);
  });
});
```

Run: `cd packages/shared-types && bun test src/match-lookup.test.ts` → FAIL.

- [ ] **Step 2: Implement the shared schema**

Create `packages/shared-types/src/match-lookup.ts`:

```ts
import { z } from "zod";

export const MATCH_LOOKUP_MAX = 200;

/**
 * `POST /ingest/matches/lookup`: lets the daemon's Sync tab fill in map / hero / mode / date /
 * result for replays it synced before it tracked them locally, without re-parsing anything.
 * Synced rows are looked up by `matchIds` (the id the daemon stored when the upload was
 * confirmed -- when two players upload the same game the server dedups on gameFingerprint, so
 * the daemon's own `replayHash` is not necessarily in `matches`); quarantined replays have no
 * match yet and are looked up by `replayHashes`.
 */
export const matchLookupInputSchema = z
  .object({
    replayHashes: z.array(z.string().min(32).max(128)).default([]),
    matchIds: z.array(z.string().uuid()).default([]),
  })
  .refine((v) => v.replayHashes.length + v.matchIds.length > 0, { message: "Nothing to look up" })
  .refine((v) => v.replayHashes.length + v.matchIds.length <= MATCH_LOOKUP_MAX, {
    message: `At most ${MATCH_LOOKUP_MAX} ids per request`,
  });
export type MatchLookupInput = z.infer<typeof matchLookupInputSchema>;

export interface MatchLookupItem {
  matchId: string;
  replayHash: string;
  parserVersion: string;
  map: string;
  gameMode: string;
  playedAt: string;
  /** The requesting user's own hero in this match; null when none of their accounts played it. */
  hero: string | null;
  won: boolean | null;
}
```

Add `export * from "./match-lookup";` to `packages/shared-types/src/index.ts`. Run the test again → PASS.

- [ ] **Step 3: Failing service test (pure helper)**

Create `apps/api/src/services/match-lookup.service.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { dedupeLookupRows } from "./match-lookup.service";

const row = (matchId: string, hero: string | null) => ({
  matchId,
  replayHash: `${matchId}-hash`,
  parserVersion: "1.19",
  map: "cursed-hollow",
  gameMode: "ARAM",
  playedAt: new Date("2026-09-30T19:14:03Z"),
  hero,
  won: hero === null ? null : true,
});

describe("dedupeLookupRows", () => {
  test("two linked BattleTags in one game yield a single row, preferring the one with a hero", () => {
    const out = dedupeLookupRows([row("m1", null), row("m1", "Xalatath"), row("m2", "Abathur")]);
    expect(out.map((o) => [o.matchId, o.hero])).toEqual([
      ["m1", "Xalatath"],
      ["m2", "Abathur"],
    ]);
  });

  test("serialises playedAt as an ISO string", () => {
    expect(dedupeLookupRows([row("m1", "X")])[0].playedAt).toBe("2026-09-30T19:14:03.000Z");
  });
});
```

Run: `cd apps/api && bun test src/services/match-lookup.service.test.ts` → FAIL.

- [ ] **Step 4: Implement the service and route**

Create `apps/api/src/services/match-lookup.service.ts`:

```ts
import { db, matchPlayers, matches } from "@hots-stats/db";
import type { MatchLookupInput, MatchLookupItem } from "@hots-stats/shared-types";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { linkedBattletags } from "../lib/account-scope";

interface LookupRow {
  matchId: string;
  replayHash: string;
  parserVersion: string;
  map: string;
  gameMode: string;
  playedAt: Date;
  hero: string | null;
  won: boolean | null;
}

/** One row per match: joining on several linked BattleTags can repeat a match; keep the row that has a hero. */
export function dedupeLookupRows(rows: LookupRow[]): MatchLookupItem[] {
  const byMatch = new Map<string, LookupRow>();
  for (const row of rows) {
    const existing = byMatch.get(row.matchId);
    if (!existing || (existing.hero === null && row.hero !== null)) byMatch.set(row.matchId, row);
  }
  return [...byMatch.values()].map((r) => ({ ...r, playedAt: r.playedAt.toISOString() }));
}

/**
 * Matches the daemon asks about, restricted to the authenticated user's own: uploaded by them,
 * or one of their linked BattleTags played in it (same notion of "mine" as account-scope.ts).
 * Unknown / foreign ids are simply absent from the result.
 */
export async function lookupMatches(userId: string, input: MatchLookupInput): Promise<MatchLookupItem[]> {
  const battletags = await linkedBattletags(userId);
  const wanted = or(
    input.matchIds.length > 0 ? inArray(matches.id, input.matchIds) : undefined,
    input.replayHashes.length > 0 ? inArray(matches.replayHash, input.replayHashes) : undefined,
  );
  const rows = await db
    .select({
      matchId: matches.id,
      replayHash: matches.replayHash,
      parserVersion: matches.parserVersion,
      map: matches.mapId,
      gameMode: matches.gameMode,
      playedAt: matches.playedAt,
      hero: matchPlayers.heroId,
      won: matchPlayers.winner,
    })
    .from(matches)
    .leftJoin(
      matchPlayers,
      and(
        eq(matchPlayers.matchId, matches.id),
        battletags.length > 0 ? inArray(matchPlayers.battletag, battletags) : sql`false`,
      ),
    )
    .where(and(wanted, or(eq(matches.uploadedByUserId, userId), isNotNull(matchPlayers.id))));
  return dedupeLookupRows(rows);
}
```

In `apps/api/src/routes/ingest.ts`: import `matchLookupInputSchema` from `@hots-stats/shared-types` (extend the existing import) and `lookupMatches` from `../services/match-lookup.service`; update the file's top doc comment to list `POST /ingest/matches/lookup`; add before `.post("/errors", ...)`:

```ts
  .post("/matches/lookup", async (c) => {
    // Fills the daemon's Sync table for replays synced before it tracked display data locally
    // (see daemon-python/src/history_enricher.py); only ever returns the caller's own matches.
    const parsed = matchLookupInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const user = c.get("user");
    return c.json({ matches: await lookupMatches(user.id, parsed.data) });
  })
```

Run: `cd apps/api && bun test src/services/match-lookup.service.test.ts && cd ../.. && bun run typecheck` → PASS.

- [ ] **Step 5: Failing daemon tests**

Append to `daemon-python/tests/test_api_client.py` (reuse that file's existing `_config`-style helper; if it has none, build `Config` as in `tests/test_ingestion.py`):

```python
def test_lookup_matches_posts_ids_and_returns_the_matches(tmp_path):
    client = api_client.ApiClient(_config(tmp_path))
    response = MagicMock(status_code=200)
    response.json.return_value = {"matches": [{"matchId": "m1"}]}
    with patch.object(client._session, "post", return_value=response) as post:
        result = client.lookup_matches(match_ids=["m1"], replay_hashes=["h" * 64])
    assert result == [{"matchId": "m1"}]
    assert post.call_args.kwargs["json"] == {"replayHashes": ["h" * 64], "matchIds": ["m1"]}
    assert post.call_args.args[0].endswith("/ingest/matches/lookup")


def test_lookup_matches_returns_none_when_unreachable_or_rejected(tmp_path):
    client = api_client.ApiClient(_config(tmp_path))
    with patch.object(client._session, "post", side_effect=requests.ConnectionError("down")):
        assert client.lookup_matches(match_ids=["m1"]) is None
    with patch.object(client._session, "post", return_value=MagicMock(status_code=400)):
        assert client.lookup_matches(match_ids=["m1"]) is None
```

(ensure `from unittest.mock import MagicMock, patch` and `import requests` are imported at the top of that file.)

Create `daemon-python/tests/test_history_enricher.py`:

```python
from pathlib import Path
from unittest.mock import MagicMock

from src.history_enricher import HistoryEnricher
from src.sync_state import SyncState


def _info(match_id: str, replay_hash: str = "srv", **kw) -> dict:
    base = {"matchId": match_id, "replayHash": replay_hash, "parserVersion": "1.19", "map": "cursed-hollow",
            "gameMode": "ARAM", "playedAt": "2026-09-30T19:14:03.000Z", "hero": "Xalatath", "won": True}
    base.update(kw)
    return base


def test_fills_display_data_for_synced_rows_by_match_id(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_synced("h", "1.19", file_path="a", match_id="m1")
    client = MagicMock()
    client.lookup_matches.return_value = [_info("m1")]
    assert HistoryEnricher(client, state, wait=lambda _s: None).run_once() == 1
    client.lookup_matches.assert_called_once_with(match_ids=["m1"])
    row = state.all_rows()[0]
    assert (row.hero, row.game_mode, row.map_slug, row.won) == ("Xalatath", "ARAM", "cursed-hollow", True)


def test_unknown_matches_are_asked_about_once_per_run_not_forever(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_synced("h", "1.19", file_path="a", match_id="deleted-server-side")
    client = MagicMock()
    client.lookup_matches.return_value = []
    assert HistoryEnricher(client, state, wait=lambda _s: None).run_once() == 0
    assert client.lookup_matches.call_count == 1


def test_offline_stops_the_run_without_touching_rows(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_synced("h", "1.19", file_path="a", match_id="m1")
    client = MagicMock()
    client.lookup_matches.return_value = None
    assert HistoryEnricher(client, state, wait=lambda _s: None).run_once() == 0
    assert state.all_rows()[0].hero is None


def test_batches_of_200_with_a_pause_between_batches(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    for i in range(450):
        state.mark_synced(f"h{i}", "1.19", file_path=f"f{i}", match_id=f"m{i}")
    client = MagicMock()
    client.lookup_matches.return_value = []
    waits: list[float] = []
    HistoryEnricher(client, state, pause_seconds=0.5, wait=waits.append).run_once()
    sizes = [len(call.kwargs["match_ids"]) for call in client.lookup_matches.call_args_list]
    assert sizes == [200, 200, 50]
    assert waits == [0.5, 0.5, 0.5]


def test_quarantined_rows_become_synced_once_the_server_has_the_match(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_error("hq", "a", "unknown build", None, error_kind="quarantine", base_build=93943)
    client = MagicMock()
    client.lookup_matches.return_value = [_info("m9", replay_hash="hq", parserVersion="1.18")]
    HistoryEnricher(client, state, wait=lambda _s: None).run_once()
    client.lookup_matches.assert_called_once_with(replay_hashes=["hq"])
    row = state.all_rows()[0]
    assert (row.status, row.match_id, row.parser_version, row.hero) == ("synced", "m9", "1.18", "Xalatath")


def test_a_quarantined_row_the_server_does_not_have_yet_stays_quarantined(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.mark_error("hq", "a", "unknown build", None, error_kind="quarantine")
    client = MagicMock()
    client.lookup_matches.return_value = []
    HistoryEnricher(client, state, wait=lambda _s: None).run_once()
    assert [r.replay_hash for r in state.rows_quarantined()] == ["hq"]
```

Run: `cd daemon-python && pytest tests/test_history_enricher.py tests/test_api_client.py -q` → FAIL.

- [ ] **Step 6: Implement `lookup_matches` and `HistoryEnricher`**

In `api_client.py`, add to `ApiClient` after `post_ingest_error`:

```python
    def lookup_matches(
        self, *, replay_hashes: "Sequence[str]" = (), match_ids: "Sequence[str]" = (), timeout: float = 15.0
    ) -> list[dict] | None:
        """`POST /ingest/matches/lookup`: display data (map, hero, mode, date, result) the server
        already holds for replays this daemon tracks, so the Sync tab can fill its table without
        reparsing. Best-effort like `post_ingest_error`: returns None when the API can't answer,
        and the caller simply tries again on its next pass."""
        try:
            response = self._session.post(
                f"{self._base_url}/ingest/matches/lookup",
                json={"replayHashes": list(replay_hashes), "matchIds": list(match_ids)},
                timeout=timeout,
            )
        except requests.RequestException as err:
            logger.debug("Match lookup failed: %s", err)
            return None
        if response.status_code >= 400:
            logger.debug("Match lookup rejected (%d): %s", response.status_code, _safe_json(response))
            return None
        try:
            return list(response.json()["matches"])
        except (ValueError, KeyError, TypeError):
            logger.debug("Match lookup returned an unexpected body")
            return None
```

(add `from typing import Sequence` to that file's imports and drop the string quotes if preferred.)

Create `daemon-python/src/history_enricher.py`:

```python
"""Fills the Sync tab's display columns (map, hero, mode, date, result) for replays the daemon
synced before it recorded them locally -- from what the *server already stores*, in batches,
without parsing a single replay (re-parsing thousands of files is exactly the CPU cost the
upload scheduler exists to avoid).

Also closes the loop for builds the API didn't recognise: a replay the daemon marked
`quarantined` becomes `synced` as soon as a lookup finds it server-side (i.e. someone ran
`bun run check-build`), with no daemon update and no re-upload.
"""

from __future__ import annotations

import logging
import time
from typing import Callable

from .api_client import ApiClient
from .sync_state import ReplayRow, SyncState

logger = logging.getLogger(__name__)


def _chunks(rows: list[ReplayRow], size: int):
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


class HistoryEnricher:
    def __init__(
        self,
        client: ApiClient,
        sync_state: SyncState,
        *,
        batch_size: int = 200,
        pause_seconds: float = 0.5,
        wait: Callable[[float], object] = time.sleep,
    ) -> None:
        self._client = client
        self._state = sync_state
        self._batch = batch_size
        self._pause = pause_seconds
        self._wait = wait

    def run_once(self) -> int:
        """One pass over everything that needs filling. Each row is asked about at most once
        per pass (a match deleted server-side must not be re-queried forever). Returns how
        many rows were updated; stops quietly if the API can't be reached."""
        updated = 0
        for chunk in _chunks(self._state.rows_needing_enrichment(), self._batch):
            found = self._client.lookup_matches(match_ids=[row.match_id for row in chunk if row.match_id])
            if found is None:
                return updated
            by_id = {item["matchId"]: item for item in found}
            for row in chunk:
                info = by_id.get(row.match_id or "")
                if info is None:
                    continue
                self._state.apply_match_info(
                    row.match_id,
                    map_slug=info.get("map"),
                    game_mode=info.get("gameMode"),
                    played_at=info.get("playedAt"),
                    hero=info.get("hero"),
                    won=info.get("won"),
                )
                updated += 1
            self._wait(self._pause)

        for chunk in _chunks(self._state.rows_quarantined(), self._batch):
            found = self._client.lookup_matches(replay_hashes=[row.replay_hash for row in chunk])
            if found is None:
                return updated
            by_hash = {item["replayHash"]: item for item in found}
            for row in chunk:
                info = by_hash.get(row.replay_hash)
                if info is None:
                    continue
                self._state.reconcile_quarantined(
                    row.replay_hash,
                    info["matchId"],
                    info["parserVersion"],
                    map_slug=info.get("map"),
                    game_mode=info.get("gameMode"),
                    played_at=info.get("playedAt"),
                    hero=info.get("hero"),
                    won=info.get("won"),
                )
                updated += 1
            self._wait(self._pause)
        return updated
```

- [ ] **Step 7: Run to verify**

Run: `cd daemon-python && pytest tests/test_history_enricher.py tests/test_api_client.py -q`
Expected: PASS.

- [ ] **Step 8: Start the maintenance thread in `app.py`**

Add `_MAINTENANCE_INTERVAL_SECONDS = 600` next to the other module constants, import `HistoryEnricher`, add `self._maintenance_thread: threading.Thread | None = None` in `__init__`, and in `start()` after `thread.start()`:

```python
        enricher = HistoryEnricher(client, sync_state)

        def _maintenance() -> None:
            # Runs once shortly after start, then every 10 minutes: fills the Sync table's
            # display data and reconciles replays whose quarantined build the API has since
            # verified. Cheap (one small request per 200 rows) and best-effort.
            while not stop_event.is_set():
                try:
                    enricher.run_once()
                except Exception:  # noqa: BLE001
                    logger.warning("History enrichment failed", exc_info=True)
                if stop_event.wait(_MAINTENANCE_INTERVAL_SECONDS):
                    return

        self._maintenance_thread = threading.Thread(target=_maintenance, name="hots-maintenance", daemon=True)
        self._maintenance_thread.start()
```

In `stop()`, after `self._stop_event.set()`, add `if self._maintenance_thread is not None: self._maintenance_thread.join(timeout=timeout); self._maintenance_thread = None`.

Run: `cd daemon-python && pytest -q` → PASS.

- [ ] **Step 9: Commit**

```bash
git add packages apps daemon-python
git commit -m "feat: match lookup endpoint and daemon history enrichment

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Daemon — the Sync tab's scrollable table

**Files:**
- Create: `daemon-python/src/sync_table.py`
- Create: `daemon-python/tests/test_sync_table.py`
- Modify: `daemon-python/src/gui.py` (`_SettingsWindow.__init__`, `run_settings_window`, `_build_sync_tab`, `_refresh_live_stats`)
- Modify: `daemon-python/src/app.py` (`_on_open_settings`)

**Interfaces:**
- Consumes: `sync_view.*` (Task 3), `UploadScheduler.snapshot/mode/set_mode`, `SYNC_DURING_GAME_META_KEY` (Task 4), `config.open_path`.
- Produces: `sync_table.explorer_select_args(path) -> list[str]`, `reveal_in_explorer(path)`, `visible_page(views, shown, page_size)`, `class SyncTable(ttk.Frame)` with `.refresh(force=False)`; `run_settings_window(..., scheduler=None)`.

- [ ] **Step 1: Failing tests for the pure helpers**

Create `daemon-python/tests/test_sync_table.py`:

```python
from src.sync_table import PAGE_SIZE, explorer_select_args, visible_page


def test_explorer_gets_the_path_as_one_argument_even_with_spaces_and_accents():
    args = explorer_select_args(r"C:\Users\Zoé Dupont\Documents\Heroes of the Storm\a b.StormReplay")
    assert args[0] == "explorer"
    assert len(args) == 2
    assert args[1].startswith("/select,")
    assert args[1].endswith("a b.StormReplay")


def test_pages_are_filled_500_at_a_time_so_opening_the_tab_stays_instant():
    views = list(range(10_000))
    first = visible_page(views, 0, PAGE_SIZE)
    assert len(first) == 500 and first[0] == 0
    second = visible_page(views, 500, PAGE_SIZE)
    assert second[0] == 500 and len(second) == 500
    assert visible_page(views, 9_800, PAGE_SIZE) == views[9_800:]
    assert visible_page(views, 10_000, PAGE_SIZE) == []
```

Run: `cd daemon-python && pytest tests/test_sync_table.py -q` → FAIL.

- [ ] **Step 2: Implement `sync_table.py`**

Create `daemon-python/src/sync_table.py`:

```python
"""The Sync tab's scrollable table: one row per replay, with its game, dates, result and upload
state (derived by sync_view.py), plus pause / "sync during game" controls and a button that
reveals the selected replay in Windows Explorer.

Only the first `PAGE_SIZE` rows are inserted; more are appended as the user scrolls, so a
library of 10 000 replays opens instantly. Refreshes are throttled and skipped while the user has
scrolled away from the top, so the list never jumps under their cursor mid-backlog.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import time
import tkinter as tk
from pathlib import Path
from tkinter import ttk
from typing import Callable, Sequence, TypeVar

from .config import open_path
from .sync_state import SyncState
from .sync_view import (
    STATE_LABELS,
    STATES,
    SyncRowView,
    build_views,
    count_by_state,
    filter_views,
    sort_views,
)
from .upload_scheduler import MODE_AUTO, MODE_PAUSED, SYNC_DURING_GAME_META_KEY, UploadScheduler

logger = logging.getLogger(__name__)

PAGE_SIZE = 500
_REFRESH_MIN_SECONDS = 3.0
_ALL = "Toutes"
_COLUMNS = (
    ("label", "Partie", 230),
    ("played", "Date de la partie", 115),
    ("uploaded", "Date d'envoi", 115),
    ("result", "Résultat", 70),
    ("state", "Statut", 105),
    ("build", "Build", 55),
)
_STATE_COLORS = {
    "synced": "#4ec9a0",
    "uploading": "#6c8cff",
    "error": "#ef5b5b",
    "quarantined": "#e0a84e",
    "outdated": "#e0a84e",
    "pending": "#8b90ad",
    "skipped": "#8b90ad",
    "missing": "#8b90ad",
}

T = TypeVar("T")


def visible_page(views: Sequence[T], shown: int, page_size: int) -> list[T]:
    return list(views[shown : shown + page_size])


def explorer_select_args(path: str) -> list[str]:
    """Explorer needs `/select,<path>` as a *single* argument; passing it as a list (not a
    shell string) keeps spaces and accents in the path intact."""
    return ["explorer", f"/select,{os.path.normpath(path)}"]


def reveal_in_explorer(path: str) -> None:
    if sys.platform == "win32":
        try:
            # Explorer exits non-zero even when it worked, so the exit code is deliberately ignored.
            subprocess.Popen(explorer_select_args(path))
        except OSError:
            logger.warning("Could not open Explorer for %s", path, exc_info=True)
        return
    open_path(Path(path).parent)


class SyncTable(ttk.Frame):
    def __init__(
        self,
        parent: tk.Misc,
        *,
        sync_state: SyncState,
        scheduler: UploadScheduler | None,
        min_parser_version: Callable[[], str | None],
        reveal: Callable[[str], None] = reveal_in_explorer,
        height: int = 8,
    ) -> None:
        super().__init__(parent)
        self._state = sync_state
        self._scheduler = scheduler
        self._min_version = min_parser_version
        self._reveal = reveal
        self._all: list[SyncRowView] = []
        self._visible: list[SyncRowView] = []
        self._by_key: dict[str, SyncRowView] = {}
        self._shown = 0
        self._filter_state: str | None = None
        self._sort: tuple[str, bool] = ("played", True)
        self._last_refresh = 0.0
        self._build(height)
        self.refresh(force=True)

    # -- layout ---------------------------------------------------------

    def _build(self, height: int) -> None:
        top = ttk.Frame(self)
        top.pack(fill="x", pady=(0, 6))
        ttk.Label(top, text="Afficher :").pack(side="left")
        self._filter_var = tk.StringVar(value=_ALL)
        self._filter_box = ttk.Combobox(top, textvariable=self._filter_var, state="readonly", width=24)
        self._filter_box.pack(side="left", padx=(6, 12))
        self._filter_box.bind("<<ComboboxSelected>>", self._on_filter)
        self._pause_button = ttk.Button(top, text="Mettre en pause", command=self._toggle_pause)
        self._pause_button.pack(side="right")
        if self._scheduler is None:
            self._pause_button.state(["disabled"])

        options = ttk.Frame(self)
        options.pack(fill="x")
        self._during_game = tk.BooleanVar(value=self._state.get_meta(SYNC_DURING_GAME_META_KEY) == "1")
        ttk.Checkbutton(
            options,
            text="Synchroniser pendant le jeu",
            variable=self._during_game,
            command=lambda: self._state.set_meta(
                SYNC_DURING_GAME_META_KEY, "1" if self._during_game.get() else "0"
            ),
        ).pack(side="left")
        self._blocked_label = ttk.Label(options, text="", style="Muted.TLabel")
        self._blocked_label.pack(side="right")

        body = ttk.Frame(self)
        body.pack(fill="both", expand=True, pady=(6, 0))
        self._tree = ttk.Treeview(
            body, columns=[c[0] for c in _COLUMNS], show="headings", height=height, selectmode="browse"
        )
        for key, title, width in _COLUMNS:
            self._tree.heading(key, text=title, command=lambda k=key: self._sort_by(k))
            self._tree.column(key, width=width, anchor="w", stretch=key == "label")
        for state, color in _STATE_COLORS.items():
            self._tree.tag_configure(state, foreground=color)
        self._vsb = ttk.Scrollbar(body, orient="vertical", command=self._tree.yview)
        self._tree.configure(yscrollcommand=self._on_yscroll)
        self._tree.pack(side="left", fill="both", expand=True)
        self._vsb.pack(side="right", fill="y")
        self._tree.bind("<Motion>", self._on_hover)
        self._tree.bind("<<TreeviewSelect>>", self._on_select)

        bottom = ttk.Frame(self)
        bottom.pack(fill="x", pady=(6, 0))
        self._detail = ttk.Label(bottom, text="", style="Muted.TLabel", wraplength=520, justify="left")
        self._detail.pack(side="left", fill="x", expand=True)
        self._reveal_button = ttk.Button(
            bottom, text="Afficher dans l'explorateur", command=self._reveal_selected
        )
        self._reveal_button.pack(side="right")
        self._reveal_button.state(["disabled"])

    # -- data -----------------------------------------------------------

    def refresh(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_refresh < _REFRESH_MIN_SECONDS:
            return
        self._last_refresh = now
        snapshot = self._scheduler.snapshot() if self._scheduler is not None else None
        self._all = build_views(self._state.all_rows(), snapshot.live if snapshot else {}, self._min_version())
        self._update_filter_choices()
        self._update_controls(snapshot)
        if force or self._tree.yview()[0] == 0.0:
            self._reload()

    def _update_filter_choices(self) -> None:
        counts = count_by_state(self._all)
        values = [f"{_ALL} ({len(self._all)})"] + [
            f"{STATE_LABELS[s]} ({counts[s]})" for s in STATES if counts.get(s)
        ]
        self._filter_box.configure(values=values)
        current = STATE_LABELS.get(self._filter_state, None) if self._filter_state else None
        if current is None:
            self._filter_var.set(values[0])
        else:
            self._filter_var.set(f"{current} ({counts.get(self._filter_state, 0)})")

    def _update_controls(self, snapshot) -> None:
        if snapshot is None:
            return
        self._pause_button.configure(
            text="Reprendre" if snapshot.mode == MODE_PAUSED else "Mettre en pause"
        )
        reasons = {
            "auth": "Suspendu : jeton refusé",
            "paused": "En pause",
            "game": "En attente de la fin de la partie",
            "dependency": "Mise à jour requise avant de continuer",
        }
        self._blocked_label.configure(text=reasons.get(snapshot.blocked or "", ""))

    def _reload(self) -> None:
        self._visible = sort_views(
            filter_views(self._all, self._filter_state), self._sort[0], descending=self._sort[1]
        )
        self._by_key = {view.key: view for view in self._visible}
        self._tree.delete(*self._tree.get_children())
        self._shown = 0
        self._append_page()

    def _append_page(self) -> None:
        for view in visible_page(self._visible, self._shown, PAGE_SIZE):
            self._tree.insert(
                "",
                "end",
                iid=view.key,
                values=(view.label, view.played, view.uploaded, view.result, STATE_LABELS[view.state], view.build),
                tags=(view.state,),
            )
            self._shown += 1

    # -- events ---------------------------------------------------------

    def _on_yscroll(self, first: str, last: str) -> None:
        self._vsb.set(first, last)
        if float(last) >= 0.98 and self._shown < len(self._visible):
            self.after_idle(self._append_page)

    def _on_filter(self, _event: object) -> None:
        chosen = self._filter_var.get().rsplit(" (", 1)[0]
        self._filter_state = next((s for s, label in STATE_LABELS.items() if label == chosen), None)
        self._reload()

    def _sort_by(self, column: str) -> None:
        descending = not self._sort[1] if self._sort[0] == column else column in ("played", "uploaded")
        self._sort = (column, descending)
        self._reload()

    def _toggle_pause(self) -> None:
        if self._scheduler is None:
            return
        self._scheduler.set_mode(MODE_AUTO if self._scheduler.mode == MODE_PAUSED else MODE_PAUSED)
        self.refresh(force=True)

    def _on_hover(self, event: tk.Event) -> None:
        view = self._by_key.get(self._tree.identify_row(event.y))
        if view is None:
            return
        name = Path(view.file_path).name
        self._detail.configure(text=f"{name} — {view.detail}" if view.detail else name)

    def _on_select(self, _event: object) -> None:
        view = self._selected()
        enabled = view is not None and view.file_exists and bool(view.file_path)
        self._reveal_button.state(["!disabled"] if enabled else ["disabled"])

    def _selected(self) -> SyncRowView | None:
        selection = self._tree.selection()
        return self._by_key.get(selection[0]) if selection else None

    def _reveal_selected(self) -> None:
        view = self._selected()
        if view is not None and view.file_exists:
            self._reveal(view.file_path)
```

- [ ] **Step 3: Run helper tests**

Run: `cd daemon-python && pytest tests/test_sync_table.py -q`
Expected: PASS. (`import src.sync_table` needs `tkinter`, same as `tests/test_gui*` if any; on a headless CI runner without tk the import would fail — if CI's daemon job lacks tkinter, move `visible_page` and `explorer_select_args` above the `import tkinter` line behind a lazy import by splitting them into `sync_table_helpers.py`. Check with `python -c "import tkinter"` in CI's Python first.)

- [ ] **Step 4: Wire the tab in `gui.py`**

1. Import: `from .sync_table import SyncTable` and `from .upload_scheduler import UploadScheduler` (next to the other local imports).
2. `_SettingsWindow.__init__`: add parameter `scheduler: UploadScheduler | None = None` after `on_manual_capture`, store `self._scheduler = scheduler`, and `self._sync_table: SyncTable | None = None` (next to `self._live_stats_job`).
3. `run_settings_window`: add parameter `scheduler: UploadScheduler | None = None` (docstring: "`scheduler`, same condition, backs the Synchronisation tab's pause button and its live pending/uploading rows"), pass `scheduler=scheduler` to `_SettingsWindow(...)`.
4. `_build_sync_tab`: after the `if self._status_tracker is not None:` block (i.e. at function level, indent 8), append:

```python
        if self._sync_state is not None:
            sync_state = self._sync_state
            self._sync_table = SyncTable(
                parent,
                sync_state=sync_state,
                scheduler=self._scheduler,
                min_parser_version=lambda: sync_state.get_meta("min_parser_version"),
            )
            self._sync_table.pack(fill="both", expand=True, pady=(12, 0))
```

5. `_refresh_live_stats`: immediately before `self._live_stats_job = self._root.after(...)` add `if self._sync_table is not None:\n            self._sync_table.refresh()`.

`app.py` `_on_open_settings`: add `scheduler=daemon.scheduler,` to the `run_settings_window(...)` call.

- [ ] **Step 5: Check window sizing (manual)**

The settings window is `resizable(False, False)` and sized by `_measure_worst_case_size`, which sizes to the tallest tab. Run `cd daemon-python && python -m src.main`, open the settings from the tray, go to the Synchronisation tab and verify: the table (about 640 px wide) is not clipped, the tab bar still fits, other tabs are unchanged. If clipped, raise the minimum width/height inside `_measure_worst_case_size` rather than shrinking the table; keep `height=8` rows. Expected look: filter combobox with counts, rows coloured by state, scrollbar, hovering a row shows its file name (and error text) under the table, selecting a row enables "Afficher dans l'explorateur", which opens Explorer on that file.

- [ ] **Step 6: Run the suite and commit**

Run: `cd daemon-python && pytest -q` → PASS.

```bash
git add daemon-python
git commit -m "feat(daemon): scrollable sync table with pause control and show-in-explorer

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `heroprotocol` dependency guard

**Files:**
- Modify: `apps/api/src/constants.ts`, `apps/api/src/routes/ingest.ts`
- Create: `daemon-python/src/dependency_guard.py`, `daemon-python/tests/test_dependency_guard.py`
- Modify: `daemon-python/src/app.py`
- Modify: `daemon-python/src/sync_table.py` (banner)
- Modify: `daemon-python/tests/test_api_client.py` (one passthrough test)

**Interfaces:**
- Consumes: `constants.HEROPROTOCOL_VERSION`, `ErrorReporter.report` (Task 2), `UploadScheduler(backlog_gate=...)` (Task 4), `updater.trigger_manual_update(status)` (existing).
- Produces: `GET /ingest/version` field `minHeroprotocolVersion`; `DependencyGuard(current=HEROPROTOCOL_VERSION)` with `.update(minimum) -> bool` (True only on the transition to blocked), `.blocked`, `.required`; `_DaemonRunner.dependency_guard`, `_DaemonRunner.set_dependency_update_trigger(callable)`.

- [ ] **Step 1: Failing guard tests**

Create `daemon-python/tests/test_dependency_guard.py`:

```python
from src.dependency_guard import DependencyGuard


def test_not_blocked_until_the_api_announces_a_higher_minimum():
    guard = DependencyGuard("2.55.15.96477")
    assert guard.blocked is False
    assert guard.update(None) is False
    assert guard.update("2.55.15.96477") is False
    assert guard.blocked is False


def test_a_higher_minimum_blocks_and_reports_the_transition_once():
    guard = DependencyGuard("2.55.15.96477")
    assert guard.update("2.55.16.100000") is True
    assert guard.blocked is True and guard.required == "2.55.16.100000"
    assert guard.update("2.55.16.100000") is False  # already blocked: no second report


def test_versions_compare_numerically_not_as_strings():
    guard = DependencyGuard("2.55.9.1")
    assert guard.update("2.55.15.1") is True


def test_unblocks_when_the_requirement_drops_or_the_daemon_is_updated():
    guard = DependencyGuard("2.55.15.96477")
    guard.update("2.55.16.100000")
    assert guard.update("2.55.15.96477") is False
    assert guard.blocked is False
```

And append to `daemon-python/tests/test_api_client.py`:

```python
def test_fetch_version_passes_the_min_heroprotocol_version_through():
    body = {"apiVersion": "9", "minParserVersion": "1.16", "minHeroprotocolVersion": "2.55.16.1"}
    response = MagicMock(status_code=200)
    response.json.return_value = body
    with patch("src.api_client.requests.get", return_value=response):
        info = api_client.fetch_version("https://api.example.com", "tok")
    assert info["minHeroprotocolVersion"] == "2.55.16.1"
```

Run: `cd daemon-python && pytest tests/test_dependency_guard.py tests/test_api_client.py -q -k "guard or heroprotocol"` → FAIL. If the `fetch_version` test fails because that function filters keys, change it (`api_client.py`, `fetch_version`) to return the parsed dict unchanged.

- [ ] **Step 2: Implement the guard**

Create `daemon-python/src/dependency_guard.py`:

```python
"""Is this daemon's `heroprotocol` older than what the API now requires?

`heroprotocol` is the one thing a *new replay build* can force a daemon update for (a build whose
protocol file the bundled version doesn't have). A build the existing decoder handles fine needs
no update at all -- the API just marks it compatible (`bun run check-build`). So the API only
announces `minHeroprotocolVersion` when an update is genuinely needed, and until the daemon
catches up the scheduler holds the backlog back instead of failing thousands of files.
"""

from __future__ import annotations

import threading

from . import constants


def _version_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(part) if part.isdigit() else 0 for part in version.split("."))


class DependencyGuard:
    def __init__(self, current: str = constants.HEROPROTOCOL_VERSION) -> None:
        self._current = current
        self._required: str | None = None
        self._lock = threading.Lock()

    @property
    def required(self) -> str | None:
        return self._required

    @property
    def blocked(self) -> bool:
        required = self._required
        return required is not None and _version_tuple(self._current) < _version_tuple(required)

    def update(self, minimum: str | None) -> bool:
        """Records the API's current requirement. True only when this call *turns the guard on*,
        so the caller reports / notifies once rather than on every periodic check."""
        with self._lock:
            was_blocked = self.blocked
            self._required = minimum or None
            return self.blocked and not was_blocked
```

Run: `cd daemon-python && pytest tests/test_dependency_guard.py -q` → PASS.

- [ ] **Step 3: API side**

`apps/api/src/constants.ts`: append

```ts
/**
 * Oldest `heroprotocol` the daemon may run with, announced by `GET /ingest/version`
 * (`minHeroprotocolVersion`). Bump by hand ONLY when a replay build needs a protocol file the
 * currently shipped daemon lacks -- builds the existing decoder reads fine just need
 * `bun run check-build`, never this. A daemon below it holds its backlog and self-updates
 * (daemon-python/src/dependency_guard.py). Same value as `HEROPROTOCOL_VERSION` in
 * daemon-python/src/constants.py until that happens.
 */
export const MIN_HEROPROTOCOL_VERSION = "2.55.15.96477";
```

`apps/api/src/routes/ingest.ts`: import it with the other constants (`import { API_VERSION, MIN_HEROPROTOCOL_VERSION, MIN_PARSER_VERSION } from "../constants";`) and add `minHeroprotocolVersion: MIN_HEROPROTOCOL_VERSION,` to the `/version` response next to `minParserVersion`. Run `bun run typecheck` → clean.

- [ ] **Step 4: Wire the guard into `app.py`**

1. Imports: `from .dependency_guard import DependencyGuard`, `from . import constants`, `from . import updater` (if not already imported as such; `updater` names are currently imported individually — add `import` of the module as `from . import updater` only if absent).
2. `_DaemonRunner.__init__`: `self.dependency_guard = DependencyGuard()` and `self._trigger_dependency_update: Callable[[], None] | None = None`; add

```python
    def set_dependency_update_trigger(self, trigger: Callable[[], None]) -> None:
        """Wired by `run_app()` to `updater.trigger_manual_update(update_status)`: what the
        dependency guard calls to fetch a newer daemon when `heroprotocol` is too old."""
        self._trigger_dependency_update = trigger

    def _refresh_dependency_requirement(self, config: Config, sync_state: SyncState, reporter: ErrorReporter) -> None:
        info = api_client.fetch_version(config.api_base_url, config.access_token)
        if info is None:
            return
        minimum = info.get("minHeroprotocolVersion")
        sync_state.set_meta("min_heroprotocol_version", minimum or "")
        if not self.dependency_guard.update(minimum):
            return
        message = f"heroprotocol {constants.HEROPROTOCOL_VERSION} is older than the required {minimum}"
        logger.info("%s; holding the backlog until the daemon is updated.", message)
        reporter.report("dependency", message)
        if self._tray_notify is not None:
            self._tray_notify(
                "Une mise à jour de HotS Analytics est nécessaire pour lire les nouvelles parties.",
                "HotS Analytics",
            )
        if is_auto_update_enabled() and updater.IS_FROZEN and self._trigger_dependency_update is not None:
            self._trigger_dependency_update()
```

3. In `start()`: pass `backlog_gate=lambda: not self.dependency_guard.blocked` to `UploadScheduler(...)`; in `_maintenance` call `self._refresh_dependency_requirement(config, sync_state, reporter)` at the top of each loop iteration (before `enricher.run_once()`), wrapped by the same try/except that guards enrichment (extend its message to "Maintenance pass failed").
4. In `run_app()`, after `daemon.set_tray_notify(tray.notify)`:

```python
    daemon.set_dependency_update_trigger(lambda: updater.trigger_manual_update(update_status))
```

(`update_status` is created earlier in `run_app`; `trigger_manual_update` already guards against double downloads via `try_begin`.)

- [ ] **Step 5: Banner in the table**

In `sync_table.py`, add a constructor parameter `dependency_required: Callable[[], str | None] = lambda: None`, a label created in `_build` just above the `body` frame:

```python
        self._banner = ttk.Label(self, text="", foreground="#e0a84e", wraplength=560, justify="left")
```

(not packed until needed), and in `_update_controls` (called every refresh) add:

```python
        required = self._dependency_required()
        if required:
            self._banner.configure(
                text=f"⚠ Mise à jour requise (heroprotocol ≥ {required}) : la synchronisation des anciennes "
                "parties est suspendue. Ouvrez l'onglet Mise à jour."
            )
            self._banner.pack(fill="x", before=self._tree.master, pady=(0, 6))
        else:
            self._banner.pack_forget()
```

Store `self._dependency_required = dependency_required` before `_build`. Note `_update_controls` currently returns early when `snapshot is None`; move the banner block above that early return. In `gui.py`'s `SyncTable(...)` call add `dependency_required=lambda: sync_state.get_meta("min_heroprotocol_version") if self._dependency_blocked() else None`, where `_SettingsWindow` gets the guard the same way as the scheduler: add a `dependency_guard: DependencyGuard | None = None` parameter to `_SettingsWindow.__init__` and `run_settings_window` (pass `dependency_guard=daemon.dependency_guard` from `_on_open_settings`), and use `lambda: guard.required if guard is not None and guard.blocked else None` instead of the meta lookup (so there is a single source of truth).

- [ ] **Step 6: Full verification**

Run: `cd daemon-python && pytest -q` → PASS. Run: `bun run typecheck && bun run build` from the repo root → clean.

Manual: point a dev daemon at a local API whose `MIN_HEROPROTOCOL_VERSION` is temporarily `"99.0.0.0"` → the Sync tab shows the banner, the backlog stops, new replays still upload, a `dependency` error appears in `GET /_internal/errors`. Revert the constant afterwards.

- [ ] **Step 7: Update the knowledge graph and commit**

Run: `graphify update .`

```bash
git add apps daemon-python
git commit -m "feat: heroprotocol dependency guard (API-announced minimum, backlog hold, self-update)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review (against the spec)

- **§1 statuses/columns** → Task 3 (derived states + columns; deviation 1–2 explain why not a stored `status`).
- **§2 scheduler** → Task 4 (queues, game detection, pause, `sync_during_game`, backoff, auth stop, restart-safe via `SyncState`). "Forced" mode intentionally dropped (deviation 5).
- **§3 API lookup / enricher / table** → Tasks 5 and 6 (200 cap, own-matches only, multi-account dedupe, 500-row pages, filter + counters, explorer button, hover detail).
- **§4 ErrorReporter** → Tasks 1–2 (new types, dedup, rate limit, offline queue cap 500, reentrancy guard, path scrubbing, server `occurrences`).
- **§5 compatible builds + guard** → Task 5 (quarantine reconciliation), Task 7 (constant, API field, hold backlog, report once, self-update, banner).
- **Tests per spec** → daemon pytest per unit; API/shared-types `bun test` for pure logic; the Postgres upsert and the Tk rendering are verified manually (Tasks 1 step 11, 4 step 12, 6 step 5, 7 step 6) because this repo has no DB/Tk test harness.
- **Type consistency:** `ReplayRow` fields (Task 3) are used verbatim by `sync_view` (Task 3), `HistoryEnricher` (Task 5) and `SyncTable` (Task 6); `IngestOutcome.error_kind` (Task 4) is what `UploadScheduler._handle` reads; `SchedulerSnapshot.blocked` strings (`auth|paused|game|dependency`) match the table's `reasons` map (Task 6); `SYNC_DURING_GAME_META_KEY` is defined once in `upload_scheduler.py` and imported by `app.py` and `sync_table.py`.
