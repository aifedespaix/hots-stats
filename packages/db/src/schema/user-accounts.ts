import { sql } from "drizzle-orm";
import { boolean, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * How a BattleTag ended up linked to a site account.
 * - legacy:    backfilled from users.battletag by the 0020 migration.
 * - battlenet: auto-filled from the Battle.net OAuth profile.
 * - daemon:    declared by the daemon from a local replay file (trusted).
 * - manual:    typed by the player in Settings (unverified).
 */
export const userAccountSourceEnum = pgEnum("user_account_source", [
  "legacy",
  "battlenet",
  "daemon",
  "manual",
]);

/**
 * A player can own several BattleTags (main + smurfs), and a BattleTag can be
 * linked to several site accounts (shared/family account -- see the design
 * doc). Personal stats are scoped by the BattleTag set, which is why
 * match_players.userId is informational only after this table exists.
 *
 * users.battletag stays the UNIQUE mirror of the *primary* row here, so every
 * single-owner reverse lookup (friends, /u/ profile, draft audience, admin)
 * keeps working unchanged.
 */
export const userAccounts = pgTable(
  "user_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    battletag: text("battletag").notNull(),
    // Stable across a BattleTag rename: e.g. "2-Hero-1-4929240". Lets the
    // daemon update the tag in place instead of accumulating a second row.
    toonHandle: text("toon_handle"),
    label: text("label"),
    isPrimary: boolean("is_primary").notNull().default(false),
    source: userAccountSourceEnum("source").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userBattletagUnique: uniqueIndex("user_accounts_user_id_battletag_idx").on(
      table.userId,
      table.battletag,
    ),
    // Resolves "which accounts does this battletag belong to" when a tag is
    // shared between several site accounts.
    battletagIdx: index("user_accounts_battletag_idx").on(table.battletag),
    // At most one primary per user. Partial so the many is_primary = false
    // rows don't collide.
    primaryUnique: uniqueIndex("user_accounts_primary_idx")
      .on(table.userId)
      .where(sql`${table.isPrimary}`),
  }),
);

export type UserAccount = typeof userAccounts.$inferSelect;
export type NewUserAccount = typeof userAccounts.$inferInsert;
