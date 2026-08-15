import { index, integer, pgTable, uuid } from "drizzle-orm/pg-core";
import { matchPlayers } from "./match-players";

export const matchDeaths = pgTable(
  "match_deaths",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchPlayerId: uuid("match_player_id")
      .notNull()
      .references(() => matchPlayers.id, { onDelete: "cascade" }),
    // Seconds since "gates open" (same reference point as matches.durationSeconds).
    atSeconds: integer("at_seconds").notNull(),
  },
  (table) => ({
    matchPlayerIdIdx: index("match_deaths_match_player_id_idx").on(table.matchPlayerId),
  }),
);

export type MatchDeath = typeof matchDeaths.$inferSelect;
export type NewMatchDeath = typeof matchDeaths.$inferInsert;
