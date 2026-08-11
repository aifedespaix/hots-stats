import { pgTable, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { matchPlayers } from "./match-players";

export const talentPicks = pgTable(
  "talent_picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchPlayerId: uuid("match_player_id")
      .notNull()
      .references(() => matchPlayers.id, { onDelete: "cascade" }),
    tier: smallint("tier").notNull(), // 1, 4, 7, 10, 13, 16, 20
    talentId: text("talent_id").notNull(),
    talentName: text("talent_name").notNull(),
  },
  (table) => ({
    matchPlayerTierUnique: uniqueIndex("talent_picks_match_player_id_tier_idx").on(
      table.matchPlayerId,
      table.tier,
    ),
  }),
);

export type TalentPick = typeof talentPicks.$inferSelect;
export type NewTalentPick = typeof talentPicks.$inferInsert;
