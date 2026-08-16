import {
  type Hero,
  db,
  heroMapGlobalSpatialRollup,
  heroMapPlayerSpatialRollup,
  heroes,
} from "@hots-stats/db";
import { type Grid, gridToWireArrays, sumGrids } from "@hots-stats/shared-types";
import { and, eq, inArray } from "drizzle-orm";

export type SpatialOutcomeFilter = "win" | "loss" | "all";
export type HeroRole = NonNullable<Hero["role"]>;

export interface SpatialAggregateParams {
  mapId: string;
  // Exactly one of these two selects which hero(es) to include.
  heroId?: string;
  role?: HeroRole;
  // Exactly one of these two selects which player(s) to aggregate.
  battletag?: string;
  global?: boolean;
  outcome: SpatialOutcomeFilter;
}

export interface SpatialAggregateResponse {
  matchCount: number;
  // null when nothing matched the filters at all (e.g. a hero/map/player
  // combination with zero recorded games) -- distinct from an empty grid.
  grid: { cols: number; rows: number } | null;
  presence: { cellIndex: number[]; values: number[] };
  kills: { cellIndex: number[]; values: number[] };
  deaths: { cellIndex: number[]; values: number[] };
}

const EMPTY_RESPONSE: SpatialAggregateResponse = {
  matchCount: 0,
  grid: null,
  presence: { cellIndex: [], values: [] },
  kills: { cellIndex: [], values: [] },
  deaths: { cellIndex: [], values: [] },
};

async function resolveHeroIds(params: SpatialAggregateParams): Promise<string[]> {
  if (params.heroId) return [params.heroId];
  if (params.role) {
    const rows = await db.select({ id: heroes.id }).from(heroes).where(eq(heroes.role, params.role));
    return rows.map((r) => r.id);
  }
  return [];
}

/**
 * Reads a "Historique" Slot's combined grid (see
 * tasks/epic-10-analyse-spatiale.md's Slot model) from the incremental
 * rollup tables -- a handful of row reads regardless of how many matches
 * fed into them, never a scan of `match_spatial_grids` (see section 5,
 * "éviter le goulot d'étranglement Postgres").
 *
 * `role` expands to every hero of that role, each summed in from its own
 * rollup row(s) -- still O(heroes-in-role), not O(matches). `outcome:
 * "all"` sums the pre-aggregated win + loss rows rather than a third
 * stored "all" row (see hero-map-spatial-rollup.ts).
 */
export async function getSpatialAggregate(params: SpatialAggregateParams): Promise<SpatialAggregateResponse> {
  const heroIds = await resolveHeroIds(params);
  if (heroIds.length === 0) return EMPTY_RESPONSE;

  const outcomes = params.outcome === "all" ? (["win", "loss"] as const) : ([params.outcome] as const);

  const rows = params.global
    ? await db
        .select()
        .from(heroMapGlobalSpatialRollup)
        .where(
          and(
            eq(heroMapGlobalSpatialRollup.mapId, params.mapId),
            inArray(heroMapGlobalSpatialRollup.heroId, heroIds),
            inArray(heroMapGlobalSpatialRollup.outcome, outcomes),
          ),
        )
    : params.battletag
      ? await db
          .select()
          .from(heroMapPlayerSpatialRollup)
          .where(
            and(
              eq(heroMapPlayerSpatialRollup.mapId, params.mapId),
              inArray(heroMapPlayerSpatialRollup.heroId, heroIds),
              eq(heroMapPlayerSpatialRollup.battletag, params.battletag),
              inArray(heroMapPlayerSpatialRollup.outcome, outcomes),
            ),
          )
      : [];

  if (rows.length === 0) return EMPTY_RESPONSE;

  // Only sum rows sharing the first row's grid resolution -- a
  // spatial.schemaVersion bump could in principle leave rollup rows at two
  // different resolutions until a backfill reconciles them (see
  // spatial-rollup.service.ts's own guard on write).
  const { gridCols, gridRows } = rows[0]!;
  const matching = rows.filter((r) => r.gridCols === gridCols && r.gridRows === gridRows);

  const matchCount = matching.reduce((sum, r) => sum + r.matchCount, 0);
  const presence = sumGrids(matching.map((r) => r.presenceGrid as Grid));
  const kills = sumGrids(matching.map((r) => r.killsGrid as Grid));
  const deaths = sumGrids(matching.map((r) => r.deathsGrid as Grid));

  return {
    matchCount,
    grid: { cols: gridCols, rows: gridRows },
    presence: gridToWireArrays(presence),
    kills: gridToWireArrays(kills),
    deaths: gridToWireArrays(deaths),
  };
}
