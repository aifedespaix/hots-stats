import { index, integer, pgTable, smallint, uuid } from "drizzle-orm/pg-core";
import { matchPlayers } from "./match-players";

export const matchLevelSnapshots = pgTable(
  "match_level_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchPlayerId: uuid("match_player_id")
      .notNull()
      .references(() => matchPlayers.id, { onDelete: "cascade" }),
    // Seconds since "gates open" (same reference point as matches.durationSeconds).
    atSeconds: integer("at_seconds").notNull(),
    level: smallint("level").notNull(),
  },
  (table) => ({
    matchPlayerIdIdx: index("match_level_snapshots_match_player_id_idx").on(table.matchPlayerId),
  }),
);

export type MatchLevelSnapshot = typeof matchLevelSnapshots.$inferSelect;
export type NewMatchLevelSnapshot = typeof matchLevelSnapshots.$inferInsert;
