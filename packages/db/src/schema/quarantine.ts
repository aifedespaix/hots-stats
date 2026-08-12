import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const quarantineStatusEnum = pgEnum("quarantine_status", ["pending", "processed", "failed"]);

/**
 * Raw ingestion payloads for an `m_baseBuild` we have no adapter for yet
 * (see `apps/api/src/adapters`) -- held here instead of `matches`/
 * `match_players` until `bun run check-build` (or a hand-written adapter)
 * confirms how to parse them. `rawPayload` is the exact JSON body the
 * daemon posted to `POST /ingest`, unmodified.
 */
export const rawReplaysQuarantine = pgTable("raw_replays_quarantine", {
  id: uuid("id").primaryKey().defaultRandom(),
  baseBuild: integer("base_build").notNull(),
  rawPayload: jsonb("raw_payload").notNull(),
  // Always set: quarantine only ever happens inside the authenticated
  // POST /ingest route, so the uploading user is always known at insert
  // time. `set null` (rather than a hard FK failure) so deleting a user
  // account doesn't block deleting/reprocessing their quarantined rows.
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  status: quarantineStatusEnum("status").notNull().default("pending"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  // Zod validation errors (`.flatten()`) from the last failed parse attempt, for `check-build`'s output / manual debugging.
  errorDetails: jsonb("error_details"),
});

export type RawReplayQuarantine = typeof rawReplaysQuarantine.$inferSelect;
export type NewRawReplayQuarantine = typeof rawReplaysQuarantine.$inferInsert;

/**
 * Builds confirmed to parse cleanly through `DefaultAdapter`, recorded by
 * `bun run check-build` (see `apps/api/scripts/check-build.ts`). Presence
 * of a row is what lets `POST /ingest` process a build's replays directly
 * instead of quarantining them -- a build with a hand-written adapter in
 * `apps/api/src/adapters/registry.ts` never needs a row here.
 */
export const knownBuilds = pgTable("known_builds", {
  baseBuild: integer("base_build").primaryKey(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  // e.g. "check-build-cli" -- free text, not an enum, since this is only ever displayed, never branched on.
  verifiedBy: text("verified_by").notNull().default("check-build-cli"),
});

export type KnownBuild = typeof knownBuilds.$inferSelect;
export type NewKnownBuild = typeof knownBuilds.$inferInsert;
