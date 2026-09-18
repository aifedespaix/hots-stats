# Daemon Sync Tracking — Design (C3)

## Context

Sync state today lives in two places:

- **`SyncState`** (`daemon-python/src/sync_state.py`), a small SQLite database at
  `%APPDATA%/hots-analytics/sync_state.db`. Per replay it stores the content hash, file path,
  status, the parser/API version last synced against, timestamps, the match id, and — for a
  failure — the error type, message and traceback. It already exposes
  `get_error_records()`, `get_skipped_records()`, `is_up_to_date()`, `mark_synced/skipped/
  error/parse_error()`, `parse_retry_budget_exhausted()`, `invalidate_stale()`,
  `invalidate_stale_for_maps()`, `wipe_all()`, `refresh_file_existence()` and a `meta`
  key/value table (`get_meta`/`set_meta`). It migrates on open through idempotent
  `_ensure_*` helpers (`_ensure_skip_reason_column`, `_ensure_attempt_tracking_columns`,
  `_ensure_map_slug_column`).
- **`StatusTracker`** (`daemon-python/src/status.py`), in-memory and per run: `found`,
  `synced`, `failed`, `skipped_ai_player`, `consecutive_failures`, `currently_syncing`,
  `last_error`.

What consumes them: `app._run_sync_loop` scans every watch folder, calls
`sync_state.refresh_file_existence()`, then ingests the backlog through a
`ThreadPoolExecutor(max_workers=_INITIAL_SYNC_WORKERS)` pool (worker threads lowered to
below-normal priority); `ingestion.ingest_file` never raises and posts failures to
`POST /ingest/errors` via `_report_error`. `gui.py`'s Synchronisation tab polls the tracker
every 500 ms and renders five counters, one progress bar and one "last error" line.

Whatever the pipeline knows, the user sees almost none of it: there is no per-replay view, no
run history, no ETA, no way to act, and no server-side confirmation that the daemon is alive.

## Goal

Make sync observable and actionable: what is pending, what is in flight, what failed and why,
how long it will take, what happened last time — plus the controls to act on that
(retry, sync now, full resync), both in the daemon window and, for the "is my daemon even
running?" question, on the web.

## Non-goals

- No change to parsing, upload semantics, retry/backoff, or worker-pool sizing.
- No remote control of the daemon from the web (no "resync this machine" button): the
  server-side piece is read-only reporting. Revisit only if users ask.
- No analytics or telemetry beyond C4's logs.
- No change to the version gates themselves (`MIN_PARSER_VERSION` /
  `MIN_RELIABLE_STATS_PARSER_VERSION`) — C3 only surfaces their effects.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Run history lives in the existing local SQLite database, not Postgres | It describes one machine's local work; the daemon must answer it offline. |
| 2 | Actions are thin wrappers over existing primitives (`wipe_all`, `invalidate_stale`, the watcher scan) | No second sync engine, no divergent behavior between the CLI `--resync` and the UI. |
| 3 | Local error grouping uses the same key as the server (`errorType`, `message`) | The daemon's view and `/_internal/errors` then agree, so triage chats do not contradict each other. |
| 4 | Quarantine becomes a first-class local status | `QuarantinedError.base_build` already exists client-side; today it is flattened into "retryable error", which hides the fact that nothing is wrong locally and the server simply has not verified the build yet. |
| 5 | ETA is computed from observed throughput, never estimated from file size | Replays vary widely in parse cost; a measured rate converges quickly and is honest. |
| 6 | The web status endpoint is a normal authenticated endpoint, not best-effort | It is user-initiated and cheap; a failure should surface, not be swallowed. |

## Components

### 1. `sync_runs` — persisted run history (daemon)

New table in `sync_state.db`, created by a new `_ensure_sync_runs_table` following the file's
existing migration pattern:

| Column | Type | Notes |
|---|---|---|
| `id` | integer pk autoincrement | |
| `started_at` | text (ISO) | |
| `finished_at` | text (ISO), null while running | |
| `trigger` | text | `startup` / `watch` / `resync` / `retry` / `sync_now` |
| `found` / `synced` / `failed` / `skipped` | integer | end-of-run counts |
| `quarantined` | integer | subset of failures, broken out |
| `parser_version` | text | daemon's `PARSER_VERSION` |
| `api_version` | text, null if unknown | from `GET /ingest/version` |
| `status` | text | `running` / `completed` / `aborted` |
| `error_summary` | text, null | last error message, so a run is self-describing |

`_run_sync_loop` opens a row when the scan starts and closes it in a `finally` (so a stop or a
crash still yields a `finished_at` and `aborted`). New queries: `start_run()`,
`finish_run(id, ...)`, `latest_run()`, `recent_runs(limit=10)`. Pruned to the most recent 50
runs on each start.

### 2. Unified replay view and grouping (`SyncState`)

- New frozen dataclass `ReplayRecord`: hash, path, status, account (toon handle, when known),
  size, last attempt, duration, match id, error type, message, skip reason, quarantined build.
- `list_replays(*, status=None, account=None, search=None, limit=200, offset=0)` over the
  existing tables, so the UI's table is one query rather than three.
- `counts_by_status() -> dict[str, int]`.
- `error_groups() -> list[ErrorGroup]`: `get_error_records()` grouped by `(error_type,
  message)` with `occurrences`, `first_seen`, `last_seen` and the member hashes — the same
  shape as `getDaemonErrorGroups` server-side (Decision 3).
- `quarantined_builds() -> dict[int, int]`: build -> count, from the recorded
  `base_build`.
- `mark_retryable(hashes: Collection[str])`: clear the error/attempt state for those hashes so
  the next scan re-ingests them (per-row "Réessayer" and the bulk "Réessayer les échecs").

### 3. Actions (`app._DaemonRunner`)

- `request_sync_now()`: sets a new `_rescan_event` that `watch_replays` also waits on (next to
  `_stop_event`), so the scan runs immediately instead of at the 60 s fallback tick.
- `retry_failed()`: `sync_state.mark_retryable(every failed hash)` then `request_sync_now()`.
- `retry_paths(hashes)`: same for a selection.
- `full_resync()`: `sync_state.wipe_all()` then `request_sync_now()`. Destructive; the UI
  confirms first, and the method itself takes no confirmation (so the CLI `--resync` and any
  future automation can use it).
- Each returns a small result and never raises; progress and outcome flow through the existing
  `StatusTracker` and the run row.

### 4. Meaningful progress

`StatusTracker` gains observation fields, all derived where possible:

- `run_started_at`, so ETA/throughput can be computed.
- `per_account`: `dict[str, AccountProgress]` (`found`/`synced`/`failed`), populated from the
  toon each replay was found under (`accounts_discovery.WatchDir` already carries it).
- `quarantined` and `skipped_incomplete` counters alongside the existing
  `skipped_ai_player` (today only the AI skip is broken out).
- `last_success_at` and `last_api_contact_at` timestamps.
- ETA/throughput are computed on read (in `health.py`/`ui_kit`, per C2) from
  `(synced + failed) / elapsed` and the remaining count — not stored, so they cannot go stale.

### 5. Server-side visibility (C3.3)

- New `GET /ingest/status` on `ingestRoute` (PAT auth): `{ token: { createdAt, lastUsedAt },
  minParserVersion, dataResetAt, openErrorCount, gamesRecorded, matchesLast7Days }`.
  `gamesRecorded`/`matchesLast7Days` reuse the existing `getStatsSummary`/scope machinery;
  `openErrorCount` counts the user's open `daemon_ingest_errors` rows. `lastUsedAt` comes from
  the `personalAccessTokens` row — `authToken` already updates it, so it is a true "the daemon
  was seen at" signal.
- Optional (only if the web card needs it) `GET /ingest/errors` (PAT, owner-scoped): the
  user's own open error groups, so a player can see why their replays are missing without
  opening the daemon window. Read-only; resolving stays in the daemon.
- Web: a **Synchronisation** card on `/upload` next to `UploadDaemonOnboarding`, showing
  "daemon vu il y a X", "N parties enregistrées", "N erreurs ouvertes", and a
  "Voir mes tokens" link. This is the browser-side answer to "is my daemon alive?".

### 6. Notifications

Consistent set, all through `tray.notify`: first failure of a run (transient), persistent
failure (already implemented in `_maybe_notify_persistent_failure`), and
"synchronisation terminée — N nouvelles parties" when a run closes with at least one new
match. Each is best-effort, as today.

## Error handling

- A run row is always closed, including on `aborted` (`finally` in `_run_sync_loop`), so the
  history cannot show a permanently running run.
- Actions never raise; a failure to perform an action surfaces through the `StatusTracker` and
  the window's inline error, not a crash.
- `GET /ingest/status` is best-effort on the *web* side (the card shows an error if the call
  fails) but a normal 4xx/5xx on the server side.
- The unified `list_replays` query must stay bounded (`limit` has a hard cap) so a 10 000-replay
  history cannot stall the Tk thread; results are fetched on a worker thread and posted to Tk.

## Testing

- `test_sync_state.py`: `sync_runs` open/finish/abort lifecycle and pruning; `error_groups`
  grouping and ordering; `list_replays` filters (status/account/search) and cap;
  `mark_retryable` makes a hash eligible again; `quarantined_builds` counts.
- `test_status.py`: per-account accumulation, the new counters, and ETA/throughput derivation
  from a synthetic start time.
- `test_app.py`: `request_sync_now` wakes the watcher, `retry_failed` clears state then
  triggers a scan, `full_resync` wipes and triggers, and an aborted run is recorded as
  `aborted` — all with the API and filesystem mocked, following the existing patterns.
- API: `GET /ingest/status` requires a PAT, returns the documented shape, and its
  `openErrorCount` matches inserted rows.
- The sync table, filters and action bar are verified by hand (no `gui.py` tests — see
  `CLAUDE.md`), using a seeded `sync_state.db` with a few hundred rows to confirm the query
  cap and table responsiveness.

## Files touched

Daemon: `daemon-python/src/sync_state.py` (`sync_runs`, `ReplayRecord`, `list_replays`,
`error_groups`, `mark_retryable`, `quarantined_builds`), `daemon-python/src/status.py`,
`daemon-python/src/app.py` (`_rescan_event`, actions, run lifecycle),
`daemon-python/src/watcher.py` (wait on the rescan event), `daemon-python/src/ingestion.py`
(record the quarantined status), `daemon-python/src/gui.py` (the panel from C2),
`daemon-python/tests/test_sync_state.py`, `test_status.py`, `test_app.py`.

API/DB: `apps/api/src/routes/ingest.ts`, `apps/api/src/services/daemon-errors.service.ts`
(a count helper), `apps/api/src/services/stats.service.ts` (reuse only), and the API tests.

Web: `apps/web/app/components/upload/DaemonStatusCard.vue` (new) and its use in
`apps/web/app/pages/upload.vue`.
