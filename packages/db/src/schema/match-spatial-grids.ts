import { integer, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { matchPlayers } from "./match-players";

/**
 * One hero's derived spatial grids for one match, keyed 1:1 by
 * `matchPlayerId` (the same PK-as-FK shape as, say, `talent_picks` isn't --
 * this one really is 1:1, since a hero has exactly one presence grid per
 * match). Absent entirely for a match whose map had no calibration at
 * ingestion time.
 *
 * Stored as `Record<cellIndex, value>` (a JSON object keyed by cell index),
 * not the wire payload's structure-of-arrays -- an object is trivial to
 * merge-add when rolling up multiple matches (see
 * `hero-map-spatial-rollup.ts` and `spatial-aggregate.service.ts`), which
 * matters far more for this table than shaving a few bytes off storage the
 * way the wire format's arrays do for network transfer.
 */
export const matchSpatialGrids = pgTable("match_spatial_grids", {
  matchPlayerId: uuid("match_player_id")
    .primaryKey()
    .references(() => matchPlayers.id, { onDelete: "cascade" }),
  gridCols: integer("grid_cols").notNull(),
  gridRows: integer("grid_rows").notNull(),
  // cellIndex (as a string key) -> seconds present in that cell.
  presenceGrid: jsonb("presence_grid").notNull().$type<Record<string, number>>(),
  // cellIndex -> number of kills credited to this hero whose death location fell in that cell.
  killsGrid: jsonb("kills_grid").notNull().$type<Record<string, number>>(),
  // cellIndex -> number of times this hero died in that cell.
  deathsGrid: jsonb("deaths_grid").notNull().$type<Record<string, number>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MatchSpatialGrid = typeof matchSpatialGrids.$inferSelect;
export type NewMatchSpatialGrid = typeof matchSpatialGrids.$inferInsert;
