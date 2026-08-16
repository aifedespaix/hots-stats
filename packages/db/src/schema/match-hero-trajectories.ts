import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { matchPlayers } from "./match-players";

/**
 * One hero's downsampled, *timestamped* path for one match, keyed 1:1 by
 * `matchPlayerId` (same PK-as-FK shape as `match-spatial-grids.ts` -- a
 * hero has exactly one trajectory per match). Absent entirely for a match
 * whose map had no calibration at ingestion time, same gating as
 * `matchSpatialGrids`.
 *
 * Deliberately a separate table from `matchSpatialGrids`, not a column on
 * it: `presenceGrid` there is a match-long aggregate with no per-sample
 * timestamp left, which is exactly why the Pro Comparison View (time-sliced
 * / event-anchored heatmaps, literal rotation pathing -- see
 * apps/web/app/composables/useHeatmapSync.ts) needs this parallel,
 * timestamped path instead. Stored as parallel arrays (the wire payload's
 * own structure-of-arrays shape, see `matchHeroTrajectorySchema`) rather
 * than one row per sample -- unlike deaths/structure events, a trajectory
 * is read as a whole path for one hero at a time, never queried or
 * aggregated per-point, so there's no benefit to normalizing it into rows.
 */
export const matchHeroTrajectories = pgTable("match_hero_trajectories", {
  matchPlayerId: uuid("match_player_id")
    .primaryKey()
    .references(() => matchPlayers.id, { onDelete: "cascade" }),
  atSeconds: jsonb("at_seconds").notNull().$type<number[]>(),
  x: jsonb("x").notNull().$type<number[]>(),
  y: jsonb("y").notNull().$type<number[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MatchHeroTrajectory = typeof matchHeroTrajectories.$inferSelect;
export type NewMatchHeroTrajectory = typeof matchHeroTrajectories.$inferInsert;
