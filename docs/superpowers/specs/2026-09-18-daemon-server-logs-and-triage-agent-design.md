# Daemon Server-Side Logs & Triage Agent — Design (C4)

## Context

Two very different failure streams exist today:

- **Ingestion failures reach the server.** `ingestion._report_error` POSTs to
  `/ingest/errors`; `recordDaemonError` (`services/daemon-errors.service.ts`) collapses repeats
  per (user, replay hash) into `daemon_ingest_errors`, and `/_internal/errors` groups open rows
  by `(errorType, baseBuild, errorMessage)`. This is a well-built triage surface — but it only
  ever sees *replay* failures.
- **Everything else stays on the player's disk.** Startup, the `/ingest/version` handshake,
  version invalidations, `dataResetAt` wipes, watcher behavior, update checks, draft captures,
  and every `WARNING`/`ERROR` from any module go to the console, `live-draft.log` or
  `update.log`. `main.py` configures logging with a bare `logging.basicConfig`; nothing is
  shipped anywhere.

There is no `daemon_logs` table, no log endpoint, and therefore no way to answer "what is
actually happening on the installed fleet?" without asking a player to send a file.

The repo does have the shape needed for the rest: `routes/internal.ts` holds tooling routes
guarded by `internalSecret` (`CLAUDE_INTERNAL_SECRET`), covering quarantine verification,
daemon-error review and ingest diagnostics; `jobs/quarantine-verification.job.ts` is the
existing periodic-job pattern; `daemonIngestErrors` is the existing
"collapse repeats, track occurrence count" table pattern.

## Goal

Ship the daemon's own log records to the API with a bounded, best-effort pipeline; expose them
through read-only triage endpoints that answer "what is the fleet doing and what is broken";
and publish a ready-to-use LLM agent prompt that can query those endpoints, diagnose an
ingestion problem, and propose a code fix through a pull request.

## Non-goals

- No remote control of a player's daemon (no "run this command on that machine").
- No PII beyond what already reaches the server (hostname and logger names are the addition).
- No replacement of `daemon_ingest_errors`: that table stays the curated, grouped failure
  view; `daemon_logs` is the raw timeline behind it.
- No automatic code change by the agent: it opens PRs, a human merges.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Logs are batched and best-effort, like `post_ingest_error` | A logging channel must never be able to slow or break the sync loop, and a dropped log is not a failure of the thing being logged. |
| 2 | The daemon ships `INFO` for its own loggers and `WARNING+` for everything, with a bounded in-memory ring buffer | Enough to reconstruct a session; small enough to be harmless. Third-party libraries are only interesting when they warn. |
| 3 | Retention is 30 days with a per-user row cap, enforced by a periodic job | Bounded storage without operator work; a runaway logger cannot fill the database. |
| 4 | Read routes get a separate, optional read-only internal secret | The triage agent should be able to investigate without holding a key that can mutate state. Writes (`errors/resolve`, `quarantine/:id/verify`) keep `CLAUDE_INTERNAL_SECRET`. |
| 5 | The agent's code changes go through a pull request | Every merge to `main` touching `daemon-python/**` auto-releases (see the roadmap spec); no automated process should be able to ship a daemon build. |
| 6 | The raw token is never logged, and a redaction pass strips known secret shapes before buffering | The most common way a logging feature becomes a security incident. |
| 7 | `context` is a JSON object, not a formatted string | Keeps it queryable and lets the summary endpoints compute on it without parsing prose. |

## Components

### 1. `daemon_logs` table (Postgres / Drizzle)

New `packages/db/src/schema/daemon-logs.ts`, exported from `schema/index.ts`, plus a generated
migration.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk default `gen_random_uuid()` | |
| `userId` | uuid not null -> `users.id`, cascade delete | the token owner |
| `hostname` | text | machine label (same source as the C1 token name) |
| `daemonVersion` | text | `APP_VERSION` |
| `parserVersion` | text | `PARSER_VERSION` |
| `level` | text not null | `DEBUG`/`INFO`/`WARNING`/`ERROR`/`CRITICAL` |
| `logger` | text not null | e.g. `src.ingestion` |
| `message` | text not null | already formatted, truncated to a max length |
| `context` | jsonb | optional structured fields (replay hash, base build, account, phase…) |
| `occurredAt` | timestamptz not null | when it happened on the daemon |
| `receivedAt` | timestamptz not null default now() | when the API stored it |

Indexes: `(userId, occurredAt desc)`, `(level, occurredAt desc)`, `(logger, occurredAt desc)`,
`(hostname, occurredAt desc)`. A retention job deletes `occurredAt < now() - 30 days` and caps
each user's rows (e.g. 50 000, oldest first) — `jobs/daemon-logs-retention.job.ts` following
`quarantine-verification.job.ts`.

### 2. `POST /ingest/logs` (PAT auth)

- Body (zod): `{ hostname?: string, daemonVersion?: string, parserVersion?: string, events:
  LogEvent[] }` with `events` max 200 items and the whole body max ~256 KiB. `LogEvent`:
  `{ level, logger, message (max 2 000 chars), context?: object, occurredAt: ISO string }`.
- `occurredAt` is clamped to `[now - 7 days, now + 5 min]` so a machine with a wrong clock
  cannot poison the timeline.
- Insert is a single multi-row insert; a per-token fixed-window rate limit (e.g. 12 requests /
  min, matching the daemon's flush interval) keeps a hot loop from hammering the API.
- Responds `202 { accepted: n }`. A validation failure is a 400 (it is a client bug worth
  surfacing in the daemon's debug view); a storage failure is a 5xx and is retried by the
  daemon's next flush.

### 3. Daemon: `src/remote_logging.py` (new)

- `RemoteLogHandler(logging.Handler)` attached to the root logger:
  - level filter: `INFO` for records whose `name` starts with `src.` (the daemon's own
    modules), `WARNING` for everything else;
  - a `collections.deque(maxlen=1000)` ring buffer behind a lock, plus a background flusher
    thread (daemon, named `hots-log-flush`) that drains and posts every ~20 s or when the
    buffer crosses a high-water mark;
  - on overflow the oldest records are dropped (never blocks the emitting thread);
  - `ApiClient.post_logs(batch)` is best-effort exactly like `post_ingest_error`;
  - redaction before buffering: never a `Bearer`/`hots_pat_`/`hots_session` value, never the
    access token, and `context` values are truncated per key;
  - `start()`/`stop()`; `stop()` performs a final flush with a short timeout so a clean
    shutdown does not lose the tail.
- Wired in `app.run_app()` / `main.main()` after the config is loaded (so it only ever runs
  with a valid token), disabled when `HOTS_DISABLE_REMOTE_LOGS` is set (dev/CI).
- It must never raise into `logging`: any internal error logs once locally and then drops.

### 4. Read-only triage endpoints (`/_internal/*`)

- `internalReadSecret` middleware (new, in `middleware/`): accepts
  `CLAUDE_INTERNAL_READ_SECRET` when set, otherwise falls back to `CLAUDE_INTERNAL_SECRET`.
  README documents generating a distinct read key for the agent.
- `GET /_internal/logs` — filters `since`, `until`, `level` (min), `logger`, `userId`,
  `hostname`, `q` (substring on message) and `limit` (default 200, max 1 000) with an
  `occurredAt`-based cursor; returns rows oldest-first so a session reads chronologically.
- `GET /_internal/logs/summary?window=24h` — the agent's first call: counts by level, top
  loggers, top error signatures (grouped message with counts), and a per-daemon-version /
  per-hostname breakdown, plus the count of open `daemon_ingest_errors`.
- `GET /_internal/daemons` — fleet overview: one row per (userId, hostname) with daemonVersion,
  parserVersion, `lastSeenAt` (max `occurredAt`, and the token's `lastUsedAt`), event count and
  open error count. Directly answers "who is running an old build?".

### 5. Web (optional, small)

A **Journal du daemon** panel for the owner (Settings or `/upload`): the recent
`WARNING`/`ERROR` records of their own daemon, read through a new owner-scoped
`GET /ingest/logs` (PAT) or a session-scoped equivalent. Purely informational; it is what makes
C4 useful to the *player*, not only to the maintainer.

### 6. The triage agent prompt

New `docs/agents/daemon-triage-prompt.md`: a self-contained prompt to hand to an LLM that has
(a) the repo checked out and (b) a read-only internal secret. It contains the pipeline mental
model, the two version gates, the quarantine flow, the exact endpoints and their parameters,
a numbered triage procedure, a decision table for choosing the fix, hard guardrails, and a
report template. The full text is the deliverable; this spec only fixes that it ships in that
file, is versioned with the code it describes, and is updated whenever an endpoint it
references changes.

Critical guardrails encoded in the prompt (Decision 5): the agent may read freely; it may
call `POST /_internal/errors/resolve` and `POST /_internal/quarantine/:buildId/verify` only
after stating what it expects and why; it must never push to `main` and must open a pull
request instead; and it must never bump a version constant to silence an error.

## Error handling

- Daemon logging is fire-and-forget by construction: bounded buffer, dropped on overflow,
  never raising into `logging`, and disabled via env for dev/CI.
- The API rejects oversized batches with 413/400 rather than truncating silently, so the
  daemon's flush can be tuned from the visible error.
- Retention job failures are logged and retried on the next tick; they never block requests.
- The read endpoints validate and cap every query parameter (no unbounded `limit`).

## Testing

- Daemon `tests/test_remote_logging.py`: level filtering (own loggers `INFO`, others
  `WARNING`); redaction strips a token-looking string; the ring buffer drops oldest on
  overflow and never blocks the emitting thread; the flusher posts batches and a failed post
  keeps records for the next attempt; `stop()` flushes.
- `tests/test_api_client.py`: `post_logs` is best-effort and never raises.
- API: `POST /ingest/logs` requires a PAT, rejects >200 events and oversized messages, clamps
  `occurredAt`, and inserts the expected rows; `/_internal/logs` filtering and pagination;
  `/_internal/logs/summary` shape; `/_internal/daemons` aggregation; the read-secret middleware
  accepts the read key on GET routes and rejects it on mutating routes.
- The retention job: rows older than 30 days are deleted and the per-user cap is enforced.

## Files touched

DB: `packages/db/src/schema/daemon-logs.ts` (new), `schema/index.ts`, a generated migration.

API: `apps/api/src/routes/ingest.ts` (`POST /logs`), `apps/api/src/routes/internal.ts`
(read endpoints), `apps/api/src/middleware/internal-secret.ts` (read variant),
`apps/api/src/services/daemon-logs.service.ts` (new: insert, query, summary, fleet),
`apps/api/src/jobs/daemon-logs-retention.job.ts` (new), `apps/api/src/lib/env.ts`
(`CLAUDE_INTERNAL_READ_SECRET` optional), `apps/api/src/index.ts`.

Daemon: `daemon-python/src/remote_logging.py` (new), `daemon-python/src/api_client.py`
(`post_logs`), `daemon-python/src/app.py`, `daemon-python/src/main.py`,
`daemon-python/tests/test_remote_logging.py` (new), `test_api_client.py`.

Docs: `docs/agents/daemon-triage-prompt.md` (new), `apps/api/README.md` or
`DEPLOYMENT.md` (the new env var and key generation), `daemon-python/README.md` (the logging
section).
