# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

HotS Analytics: a Heroes of the Storm stats-tracking app. A Windows daemon (Python) parses local
`.StormReplay` files and POSTs the extracted stats to an API (Hono/Bun); a Nuxt frontend renders
them. Monorepo managed with Bun workspaces.

- **`apps/web`** — Nuxt 3 (SSR) + Nuxt UI, Pinia, Chart.js.
- **`apps/api`** — Hono on Bun; session-cookie auth for the web app, Personal Access Token
  (Bearer) auth for the daemon.
- **`packages/db`** — Drizzle ORM schema/client for PostgreSQL (`packages/db/src/schema/`).
- **`packages/shared-types`** — Contracts shared between daemon, API, and web (notably
  `ReplayPayload`, the daemon→API ingestion shape).
- **`daemon-python`** — Windows tray app (`watchdog` + `heroprotocol`) that watches the replays
  folder, parses new files, and syncs stats to the API. Ships as a Nuitka-built `.exe`
  (`.github/workflows/build-daemon.yml`).

## Commands

```bash
bun install

bun run docker:dev:up                              # Postgres for local dev
bun run --filter './packages/db' generate           # generate a Drizzle migration from the schema
bun run --filter './packages/db' migrate            # apply migrations
bun run db:studio                                   # Drizzle Studio

bun run dev:api                                     # http://localhost:3001
bun run dev:web                                     # http://localhost:3000
bun run dev                                         # both, in parallel

bun run typecheck                                   # every workspace (tsc / nuxt typecheck)
bun run build                                       # every workspace
```

Per-workspace:

```bash
bun run --filter './apps/web' test                  # vitest run (apps/web only has JS tests)
bun run --filter './apps/web' test <path/to.test.ts> # single file

bun run --filter './apps/api' check-build <buildId>  # see "Replay ingestion" below
bun run --filter './apps/api' promote-admin <email>
```

Daemon (Python, separate venv, run from `daemon-python/`):

```bash
pip install -e ".[dev]"
pytest -q                                           # full suite
pytest tests/test_parser.py -q                      # single file
pytest tests/test_parser.py::test_name -q           # single test

python -m src.main                                  # tray app: settings window, then background sync
python -m src.main --resync [path]                  # headless: upload every replay on disk, then exit
```

CI (`.github/workflows/ci.yml`) runs `bun run typecheck`, `bun run build`, and the daemon's
`pytest` as separate jobs — there is no repo-wide lint/format command (no ESLint/Biome/Prettier
config at the root).

## Architecture: replay ingestion, adapters, and versioning

This is the part that spans the most files and is easy to get wrong; read this before touching
ingestion, adapters, or either version constant below.

**Flow:** daemon parses a replay (`daemon-python/src/parser.py`) → `POST /ingest`
(`apps/api/src/routes/ingest.ts`, PAT auth) → `ingestReplayPayload`
(`services/replay-ingest.service.ts`) resolves an adapter for the replay's `m_baseBuild` via
`adapters/registry.ts` → the adapter normalizes the raw JSON into `ParsedReplayData`
(`adapters/types.ts`, currently identical to `ReplayPayload`) → `replay-upsert.service.ts` writes
it.

**Unknown builds are quarantined, not rejected.** If `registry.ts` has no custom adapter for a
`baseBuild` and it isn't yet marked verified-compatible with `DefaultAdapter`, the raw payload is
stored in `raw_replays_quarantine` (`quarantine.service.ts`) instead of being parsed. A human runs
`bun run check-build <baseBuild>` (`apps/api/scripts/check-build.ts` →
`build-verification.service.ts`) to test the quarantined payloads against `DefaultAdapter`: if
compatible, the build is marked verified and the queued replays are inserted; if not, a
build-specific adapter must be hand-written and registered in `CUSTOM_ADAPTERS`
(`adapters/registry.ts`) before those replays can be processed.

**Two independent version gates, both bumped only when actually needed:**
- `MIN_PARSER_VERSION` (`apps/api/src/constants.ts`) vs. the daemon's `PARSER_VERSION`
  (`daemon-python/src/constants.py`, changelog in comments above it) — `GET /ingest/version`
  reports the API's current minimum; the daemon's `SyncState.invalidate_stale()` drops its
  "already synced" record for anything below it so those replays get reparsed and re-uploaded.
  Bump `MIN_PARSER_VERSION` when a parsing/schema change means previously-synced replays should be
  reprocessed.
- `MIN_RELIABLE_STATS_PARSER_VERSION` (stricter, separate) marks whether a *stored* match's
  combat stats are trustworthy at all — `GET /matches/:id` uses it to flag `statsReliable: false`
  so the web app can warn instead of presenting corrupted numbers as fact. A flagged match only
  self-heals if its owning player's daemon resyncs it (needs the replay file still present
  locally).

When a stats-correctness bug is reported, use the `replay-stats-triage` skill rather than
debugging from scratch — it encodes this whole flow plus the guardrail/fix convention.

## Auth

Two separate schemes on the same API: session cookie (`middleware/auth-session.ts`) for the web
dashboard, Personal Access Token / Bearer (`middleware/auth-token.ts`) for the daemon. Don't mix
them up when adding a route — pick based on which caller will hit it.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
