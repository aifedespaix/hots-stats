import {
  DEATH_MAP_CLUSTER_LIMIT,
  type DeathMapCell,
  type DeathMapCluster,
  type DeathMapResponse,
  cellIndexForPosition,
} from "@hots-stats/shared-types";
import type { Scope } from "./account-selection";

/**
 * One match_deaths row, already joined to its match_players and matches.
 * layer is the wire value (null for a map's default level; see
 * lib/spatial-layer.ts's fromDbLayer).
 */
export interface DeathMapRow {
  matchId: string;
  battletag: string;
  layer: string | null;
  x: number | null;
  y: number | null;
  killType: "hero" | "other" | null;
}

/**
 * Collapses the DB's "" sentinel, null and undefined onto a single nullable
 * layer so a request without layer matches rows stored under the default
 * sentinel.
 */
export function normalizeLayer(layer: string | null | undefined): string | null {
  return layer ? layer : null;
}

/**
 * Pure, case-insensitive scope check, applied as defence in depth on top of
 * the SQL scopeConditions restriction: even if a where-clause regressed, a
 * row from another player's account could not leak into a personal death
 * map. The global scope accepts everything (a community heatmap).
 */
export function rowInScope(battletag: string, scope: Scope): boolean {
  if (scope.mode === "global") return true;
  const tag = battletag.toLowerCase();
  return scope.battletags.some((owned) => owned.toLowerCase() === tag);
}

function isPositioned(row: DeathMapRow): boolean {
  return typeof row.x === "number" && Number.isFinite(row.x) && typeof row.y === "number" && Number.isFinite(row.y);
}

/**
 * Groups occupied cells into 4-connected components and keeps the densest
 * DEATH_MAP_CLUSTER_LIMIT as hotspots. cellIndex is the component's peak cell
 * (most deaths, lowest index on a tie); share is its deaths over the
 * positioned total. Mirrors the client-side death-clustering util's
 * "teamfight blob" behaviour, one grid step apart.
 */
function clusterCells(cells: DeathMapCell[], cols: number, positionedDeaths: number): DeathMapCluster[] {
  const deathsByCell = new Map(cells.map((cell) => [cell.cellIndex, cell.deaths]));
  const visited = new Set<number>();
  const clusters: DeathMapCluster[] = [];

  for (const cell of cells) {
    if (visited.has(cell.cellIndex)) continue;
    const stack = [cell.cellIndex];
    visited.add(cell.cellIndex);
    let deaths = 0;
    let peakIndex = cell.cellIndex;
    let peakDeaths = -1;
    while (stack.length > 0) {
      const current = stack.pop()!;
      const value = deathsByCell.get(current) ?? 0;
      deaths += value;
      if (value > peakDeaths || (value === peakDeaths && current < peakIndex)) {
        peakDeaths = value;
        peakIndex = current;
      }
      const col = current % cols;
      const row = Math.floor(current / cols);
      const neighbours = [
        col > 0 ? current - 1 : -1,
        col < cols - 1 ? current + 1 : -1,
        row > 0 ? current - cols : -1,
        current + cols,
      ];
      for (const neighbour of neighbours) {
        if (deathsByCell.has(neighbour) && !visited.has(neighbour)) {
          visited.add(neighbour);
          stack.push(neighbour);
        }
      }
    }
    clusters.push({
      cellIndex: peakIndex,
      deaths,
      share: positionedDeaths > 0 ? deaths / positionedDeaths : 0,
    });
  }

  clusters.sort((a, b) => (b.deaths !== a.deaths ? b.deaths - a.deaths : a.cellIndex - b.cellIndex));
  return clusters.slice(0, DEATH_MAP_CLUSTER_LIMIT);
}

/**
 * Builds the C1 response from scope-restricted DB rows. Pure: the service
 * only scopes, filters and assembles rows. Layer filtering, position
 * bucketing, hotspot clustering and the uncalibrated short-circuit all live
 * here so they are unit-testable without a database.
 *
 * When calibrated is false the map has no world bounds, so no stored x/y is
 * usable: cells/clusters stay empty and positionedDeaths is 0 (acceptance
 * criteria 1 and 2), while the positionless counts remain honest.
 */
export function buildDeathMapResponse(input: {
  mapId: string;
  layer: string | null;
  calibrated: boolean;
  scope: Scope;
  rows: DeathMapRow[];
  gridCols: number;
  gridRows: number;
}): DeathMapResponse {
  const requestedLayer = normalizeLayer(input.layer);
  const rows = input.rows.filter(
    (row) => rowInScope(row.battletag, input.scope) && normalizeLayer(row.layer) === requestedLayer,
  );

  const totalDeaths = rows.length;
  const matches = new Set(rows.map((row) => row.matchId)).size;
  const killTypeSplit = {
    hero: rows.filter((row) => row.killType === "hero").length,
    other: rows.filter((row) => row.killType === "other").length,
  };

  const positioned = input.calibrated ? rows.filter(isPositioned) : [];
  const counts = new Map<number, number>();
  for (const row of positioned) {
    const cellIndex = cellIndexForPosition(row.x!, row.y!, input.gridCols, input.gridRows);
    counts.set(cellIndex, (counts.get(cellIndex) ?? 0) + 1);
  }
  const cells: DeathMapCell[] = [...counts.entries()]
    .map(([cellIndex, deaths]) => ({ cellIndex, deaths }))
    .sort((a, b) => a.cellIndex - b.cellIndex);

  return {
    mapId: input.mapId,
    layer: requestedLayer,
    grid: { cols: input.gridCols, rows: input.gridRows },
    totalDeaths,
    matches,
    positionedDeaths: positioned.length,
    cells,
    clusters: clusterCells(cells, input.gridCols, positioned.length),
    killTypeSplit,
    calibrated: input.calibrated,
  };
}
