import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { matchPlayers } from "./match-players";

/**
 * One hero's derived spatial grids for one match **on one layer**, keyed by
 * `(matchPlayerId, layer)` -- a hero has exactly one presence grid per
 * layer they were tracked on in a match (one row for a single-level map,
 * up to as many rows as calibrated levels exist for a multi-level one).
 * Absent entirely for a match whose map had no calibration for a given
 * layer at ingestion time.
 *
 * Stored as `Record<cellIndex, value>` (a JSON object keyed by cell index),
 * not the wire payload's structure-of-arrays -- an object is trivial to
 * merge-add when rolling up multiple matches (see
 * `hero-map-spatial-rollup.ts` and `spatial-aggregate.service.ts`), which
 * matters far more for this table than shaving a few bytes off storage the
 * way the wire format's arrays do for network transfer.
 */
export const matchSpatialGrids = pgTable(
  "match_spatial_grids",
  {
    matchPlayerId: uuid("match_player_id")
      .notNull()
      .references(() => matchPlayers.id, { onDelete: "cascade" }),
    // See spatial-calibration.ts's mapCalibrations.layer for the "" sentinel convention.
    layer: text("layer").notNull().default(""),
    gridCols: integer("grid_cols").notNull(),
    gridRows: integer("grid_rows").notNull(),
    // cellIndex (as a string key) -> seconds present in that cell.
    presenceGrid: jsonb("presence_grid").notNull().$type<Record<string, number>>(),
    // cellIndex -> number of kills credited to this hero whose death location fell in that cell.
    killsGrid: jsonb("kills_grid").notNull().$type<Record<string, number>>(),
    // cellIndex -> number of times this hero died in that cell.
    deathsGrid: jsonb("deaths_grid").notNull().$type<Record<string, number>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.matchPlayerId, table.layer] }),
  }),
);

export type MatchSpatialGrid = typeof matchSpatialGrids.$inferSelect;
export type NewMatchSpatialGrid = typeof matchSpatialGrids.$inferInsert;
