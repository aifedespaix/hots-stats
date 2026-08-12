import { integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const daemonErrorTypeEnum = pgEnum("daemon_error_type", ["parse", "auth", "validation", "server"]);

export const daemonErrorStatusEnum = pgEnum("daemon_error_status", ["open", "resolved"]);

/**
 * Ingestion failures the daemon hit locally, forwarded here so they're
 * triageable centrally instead of only visible in one player's own Debug
 * window -- see daemon-python/src/ingestion.py's `ingest_file`, which
 * already tracks the exact same failures in its local `sync_state.db` but
 * previously had no way to surface them anywhere else. Populated by
 * `POST /ingest/errors`, guarded by the same personal access token as
 * `POST /ingest`; read via `GET /_internal/errors`.
 *
 * Deliberately doesn't carry the replay file or raw payload (unlike
 * `raw_replays_quarantine`, which exists precisely to capture that for a
 * schema investigation): a parse failure has no payload to begin with, and
 * this table is for triaging *why* replays fail, not reprocessing them --
 * reprocessing already happens automatically once the underlying bug is
 * fixed and `PARSER_VERSION`/`MIN_PARSER_VERSION` bumped (see
 * replay-upsert.service.ts / sync_state.py's `invalidate_stale`).
 */
export const daemonIngestErrors = pgTable(
  "daemon_ingest_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    // Null only when hashing itself failed (very rare, e.g. the file was
    // deleted mid-read) -- see ingestion.py's `ingest_file`.
    replayHash: text("replay_hash"),
    baseBuild: integer("base_build"),
    errorType: daemonErrorTypeEnum("error_type").notNull(),
    errorMessage: text("error_message").notNull(),
    // Truncated Python traceback (see api_client.py's `post_ingest_error`), for manual debugging.
    errorLog: text("error_log"),
    parserVersion: text("parser_version"),
    daemonVersion: text("daemon_version"),
    status: daemonErrorStatusEnum("status").notNull().default("open"),
    // Bumped instead of inserting a new row on every retry -- a failing
    // replay is retried on every daemon restart (see sync_state.py's
    // `is_up_to_date`, which never considers an 'error' row up to date), so
    // without this the table would fill with duplicates of the exact same
    // failure instead of showing how persistent it is.
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    firstOccurredAt: timestamp("first_occurred_at", { withTimezone: true }).notNull().defaultNow(),
    lastOccurredAt: timestamp("last_occurred_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => ({
    // Only dedupes when `replayHash` is known -- Postgres treats each NULL
    // as distinct, so the rare hash-failure case always inserts a fresh row
    // instead of colliding with unrelated ones.
    userReplayUnique: uniqueIndex("daemon_ingest_errors_user_replay_idx").on(table.userId, table.replayHash),
  }),
);

export type DaemonIngestError = typeof daemonIngestErrors.$inferSelect;
export type NewDaemonIngestError = typeof daemonIngestErrors.$inferInsert;
