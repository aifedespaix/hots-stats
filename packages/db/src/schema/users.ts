import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Controls whether hero stats (top heroes, hero breakdown) are computed from
// only the connected user's own matches ("personal") or from every match
// ever recorded by the app, across all players ("global").
export const heroStatsScopeEnum = pgEnum("hero_stats_scope", ["personal", "global"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleId: text("google_id").notNull().unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  battletag: text("battletag").unique(),
  publicHandle: text("public_handle").unique(),
  heroStatsScope: heroStatsScopeEnum("hero_stats_scope").notNull().default("personal"),
  // Bumped by POST /auth/me/reset-data whenever the user wipes their own
  // matches (see services/data-reset.service.ts). Surfaced to the daemon via
  // GET /ingest/version's `dataResetAt` so it knows to forget its local
  // "already synced" state and re-parse/re-upload every replay still on
  // disk -- the same API-driven-resync mechanism as `MIN_PARSER_VERSION`,
  // just scoped to one account instead of every daemon (see app.py's
  // `_sync_api_version`).
  dataResetAt: timestamp("data_reset_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
