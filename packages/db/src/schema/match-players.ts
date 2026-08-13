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
    // Nearly every "personal scope" query in the app (stats, heroes, players,
    // matches, friends, face-a-face) filters on userId; Postgres doesn't
    // auto-index FK columns, so without this every one of them is a seq scan.
    userIdIdx: index("match_players_user_id_idx").on(table.userId),
  }),
);

export type MatchPlayer = typeof matchPlayers.$inferSelect;
export type NewMatchPlayer = typeof matchPlayers.$inferInsert;
