import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { heroes } from "./heroes";
import { matches } from "./matches";
import { users } from "./users";

export const matchPlayers = pgTable(
  "match_players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    // Linked to a registered user when their battletag matches; nullable for players who never signed up.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    battletag: text("battletag").notNull(),
    heroId: text("hero_id")
      .notNull()
      .references(() => heroes.id),
    team: smallint("team").notNull(), // 0 or 1
    winner: boolean("winner").notNull(),
    kills: integer("kills").notNull(),
    deaths: integer("deaths").notNull(),
    assists: integer("assists").notNull(),
    heroDamage: integer("hero_damage").notNull(),
    siegeDamage: integer("siege_damage").notNull(),
    healing: integer("healing").notNull(),
    selfHealing: integer("self_healing").notNull(),
    damageTaken: integer("damage_taken").notNull(),
    experienceContribution: integer("experience_contribution").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    matchBattletagUnique: uniqueIndex("match_players_match_id_battletag_idx").on(
      table.matchId,
      table.battletag,
    ),
    // Kept for the admin uploads-diagnostics page, which still pivots on
    // match_players.userId. Personal stat queries no longer use it -- they
    // filter on the viewer's BattleTag set instead (see battletagIdx below).
    userIdIdx: index("match_players_user_id_idx").on(table.userId),
    // Personal scope is "battletag IN (...)" after multi-account support. The
    // composite (match_id, battletag) unique index can't serve a bare
    // battletag lookup, and the trigram GIN index only serves ILIKE '%term%'.
    battletagIdx: index("match_players_battletag_idx").on(table.battletag),
    // Trigram GIN index so the "joueur croisé" typeahead (`ILIKE '%term%'`
    // on a partial battletag) can use an index scan instead of a seq scan --
    // a plain btree index can't serve a leading-wildcard match. Requires the
    // pg_trgm extension, enabled in this same migration.
    battletagTrgmIdx: index("match_players_battletag_trgm_idx").using(
      "gin",
      sql`${table.battletag} gin_trgm_ops`,
    ),
  }),
);

export type MatchPlayer = typeof matchPlayers.$inferSelect;
export type NewMatchPlayer = typeof matchPlayers.$inferInsert;
