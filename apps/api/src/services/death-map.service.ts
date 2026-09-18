import { db, mapCalibrations, matchDeaths, matchPlayers, matches } from "@hots-stats/db";
import { SPATIAL_GRID_COLS, SPATIAL_GRID_ROWS, type DeathMapResponse } from "@hots-stats/shared-types";
import { and, eq } from "drizzle-orm";
import { type Scope, scopeConditions } from "../lib/account-selection";
import { buildDeathMapResponse, type DeathMapRow } from "../lib/death-map-aggregate";
import { fromDbLayer, toDbLayer } from "../lib/spatial-layer";

export interface DeathMapFilters {
  heroId?: string;
  layer?: string | null;
}

/**
 * Reads every death the scope recorded on mapId (optionally one hero) and
 * hands the rows to the pure aggregate. The SQL where-clause already restricts
 * candidate rows to the caller's own battletags via scopeConditions, so
 * another player's death can never be selected; buildDeathMapResponse
 * re-checks scope as defence in depth. All the maths (layer filter, cells,
 * clusters, kill-type split) lives in ../lib/death-map-aggregate.ts.
 */
export async function getDeathMap(
  scope: Scope,
  mapId: string,
  filters: DeathMapFilters = {},
): Promise<DeathMapResponse> {
  const layer = filters.layer ?? null;

  const [calibration] = await db
    .select({ mapId: mapCalibrations.mapId })
    .from(mapCalibrations)
    .where(and(eq(mapCalibrations.mapId, mapId), eq(mapCalibrations.layer, toDbLayer(layer))))
    .limit(1);

  const conditions = scopeConditions([eq(matches.mapId, mapId)], scope, matchPlayers.battletag);
  if (filters.heroId) conditions.push(eq(matchPlayers.heroId, filters.heroId));

  const rows = await db
    .select({
      matchId: matchPlayers.matchId,
      battletag: matchPlayers.battletag,
      layer: matchDeaths.layer,
      x: matchDeaths.x,
      y: matchDeaths.y,
      killType: matchDeaths.killType,
    })
    .from(matchDeaths)
    .innerJoin(matchPlayers, eq(matchPlayers.id, matchDeaths.matchPlayerId))
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(and(...conditions));

  const deathRows: DeathMapRow[] = rows.map((row) => ({
    matchId: row.matchId,
    battletag: row.battletag,
    layer: row.layer === null ? null : fromDbLayer(row.layer),
    x: row.x,
    y: row.y,
    killType: row.killType,
  }));

  return buildDeathMapResponse({
    mapId,
    layer,
    calibrated: calibration !== undefined,
    scope,
    rows: deathRows,
    gridCols: SPATIAL_GRID_COLS,
    gridRows: SPATIAL_GRID_ROWS,
  });
}
