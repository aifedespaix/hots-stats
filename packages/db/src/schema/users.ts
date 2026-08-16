import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Controls whether hero stats (top heroes, hero breakdown) are computed from
// only the connected user's own matches ("personal") or from every match
// ever recorded by the app, across all players ("global").
export const heroStatsScopeEnum = pgEnum("hero_stats_scope", ["personal", "global"]);

// Gates access to admin-only tooling (currently: the spatial calibration
// tool, see spatial-calibration.ts). Promoted via `bun run promote-admin
// <identifier>` (apps/api/scripts/promote-admin.ts) -- never through
// seed.ts, which runs automatically in every environment.
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Exactly one of googleId/battlenetId is set, depending on which provider
  // the account was created through -- neither is required at the column
  // level since a given user only ever has one of them.
  googleId: text("google_id").unique(),
  battlenetId: text("battlenet_id").unique(),
  // Only Google's OIDC userinfo returns an email; Battle.net's OAuth
  // userinfo only ever returns { sub, id, battletag }, so accounts created
  // through it never have one.
  email: text("email").unique(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  battletag: text("battletag").unique(),
  publicHandle: text("public_handle").unique(),
  heroStatsScope: heroStatsScopeEnum("hero_stats_scope").notNull().default("personal"),
  role: userRoleEnum("role").notNull().default("user"),
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
