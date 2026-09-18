/**
 * Pure grid math shared by the API (ingestion: folding one match's grids
 * into the incremental rollup, see apps/api/src/services/spatial-rollup.service.ts;
 * reads: apps/api/src/services/spatial-aggregate.service.ts) and the web
 * app (apps/web/app/components/spatial/, combining several toggled heroes'
 * "Cette partie" grids client-side). Centralized here rather than
 * duplicated in both apps: `cellIndexForPosition` in particular must
 * bucket a normalized position into *exactly* the same cell index
 * server-side and client-side, or a client-side merge of match data would
 * silently disagree with what the server already computed for the rollup.
 *
 * Grids are represented as `Record<string, number>` (cellIndex -> value)
 * in this merge layer -- trivial to merge-add, unlike the wire payload's
 * structure-of-arrays -- and only converted to/from that array shape at the
 * two edges (`gridFromWireArrays`/`gridToWireArrays`). See
 * tasks/epic-10-analyse-spatiale.md Livrable 1/section 5.
 */
export type Grid = Record<string, number>;

/** `spatial.presence[]`'s `{cellIndex[], secondsInCell[]}` (or any other parallel-arrays pair) -> `Record<cellIndex, value>`. */
export function gridFromWireArrays(cellIndex: number[], values: number[]): Grid {
  const grid: Grid = {};
  for (let i = 0; i < cellIndex.length; i++) {
    const index = cellIndex[i];
    const value = values[i];
    if (index === undefined || value === undefined) continue;
    grid[index] = (grid[index] ?? 0) + value;
  }
  return grid;
}

/** `Record<cellIndex, value>` -> the wire structure-of-arrays shape, sorted by cell index. */
export function gridToWireArrays(grid: Grid): { cellIndex: number[]; values: number[] } {
  const cellIndex = Object.keys(grid)
    .map(Number)
    .sort((a, b) => a - b);
  return { cellIndex, values: cellIndex.map((i) => grid[i]!) };
}

// Values at or below this are pruned after a merge -- keeps a rollup row's
// JSONB from accumulating zero/near-zero entries left behind by a subtract
// (see `mergeGrid`'s `sign: -1` use when a match is re-ingested).
const PRUNE_THRESHOLD = 1e-6;

/**
 * Adds (`sign: 1`) or subtracts (`sign: -1`) `delta` into `base`, returning
 * a new grid. Never mutates `base`. Entries that end up at or below
 * `PRUNE_THRESHOLD` are dropped rather than kept at ~0 -- these are always
 * non-negative counts/seconds, so a subtract should only ever bring a cell
 * back toward exactly zero (floating-point noise aside), not negative.
 */
export function mergeGrid(base: Grid, delta: Grid, sign: 1 | -1 = 1): Grid {
  const merged: Grid = { ...base };
  for (const [cellIndex, value] of Object.entries(delta)) {
    const next = (merged[cellIndex] ?? 0) + sign * value;
    if (next <= PRUNE_THRESHOLD) {
      delete merged[cellIndex];
    } else {
      merged[cellIndex] = next;
    }
  }
  return merged;
}

/** Sum of every cell's value across `grids` -- combining several already-aggregated rollup rows (an "outcome=all" or "role" view), or several toggled heroes' per-match grids client-side. */
export function sumGrids(grids: Grid[]): Grid {
  return grids.reduce((acc, grid) => mergeGrid(acc, grid, 1), {} as Grid);
}

/** Largest single cell value in `grid`, or 0 for an empty grid -- used to normalize a heatmap's color intensity. */
export function maxGridValue(grid: Grid): number {
  let max = 0;
  for (const value of Object.values(grid)) {
    if (value > max) max = value;
  }
  return max;
}

/**
 * Buckets a normalized `[0,1]` position into a grid cell index: `col =
 * floor(xn*cols)` / `cellIndex = row*cols+col`, the same convention the
 * daemon uses for `spatial.presence[]` (see
 * `daemon-python/src/parser.py`'s `_distribute_segment_across_cells`) --
 * used by the API to bucket `timeline.deaths[].x/y` into the same grid for
 * `killsGrid`/`deathsGrid`, since the daemon only pre-grids presence, not
 * individual deaths.
 */
export function cellIndexForPosition(xn: number, yn: number, cols: number, rows: number): number {
  const col = Math.min(cols - 1, Math.max(0, Math.floor(xn * cols)));
  const row = Math.min(rows - 1, Math.max(0, Math.floor(yn * rows)));
  return row * cols + col;
}

/** Increments `grid[cellIndex]` by 1 (mutates and returns `grid` for convenient chaining in a reduce/loop). */
export function incrementCell(grid: Grid, cellIndex: number): Grid {
  grid[cellIndex] = (grid[cellIndex] ?? 0) + 1;
  return grid;
}

/** Cell `(col, row)` for a given `cellIndex`, the inverse of the `row*cols+col` packing above -- used by the frontend to project a cell back into normalized `[0,1]` space for rendering. */
export function cellRowCol(cellIndex: number, cols: number): { col: number; row: number } {
  return { col: cellIndex % cols, row: Math.floor(cellIndex / cols) };
}

/**
 * Canonical grid resolution for C1's aggregated death map. Matches the
 * daemon's SPATIAL_GRID_COLS/SPATIAL_GRID_ROWS (daemon-python/src/constants.py)
 * and the per-payload spatial.grid every replay carries today, so a death
 * bucketed here lands in the same cell as the rollup's deathsGrid. Named so
 * the API reads it from one place instead of hardcoding 128.
 */
export const SPATIAL_GRID_COLS = 128;
export const SPATIAL_GRID_ROWS = 128;

/** How many hotspots DeathMapResponse.clusters keeps (densest first). */
export const DEATH_MAP_CLUSTER_LIMIT = 8;

/** One grid cell and how many positioned deaths fell in it. */
export interface DeathMapCell {
  cellIndex: number;
  deaths: number;
}

/**
 * One contiguous death hotspot. cellIndex is the cluster's peak cell (most
 * deaths; lowest index on a tie) -- the weighted centroid is not a cell
 * index, so the peak stands in as the labelled centre. share is
 * deaths / positionedDeaths (0 when nothing is positioned).
 */
export interface DeathMapCluster {
  cellIndex: number;
  deaths: number;
  share: number;
}

/**
 * Deaths split by kill_type. A death whose killType is null (unknown) counts
 * in neither bucket: hero + other may be below totalDeaths, and the UI shows
 * the remainder as unknown rather than inventing an "other" label.
 */
export interface DeathMapKillTypeSplit {
  hero: number;
  other: number;
}

/** GET /spatial/death-map response (spec section C1). */
export interface DeathMapResponse {
  mapId: string;
  layer: string | null;
  grid: { cols: number; rows: number };
  totalDeaths: number;
  matches: number;
  /** Deaths with a usable x/y only -- the honest denominator. */
  positionedDeaths: number;
  cells: DeathMapCell[];
  /** Cluster centroids, from the existing death-clustering util. */
  clusters: DeathMapCluster[];
  killTypeSplit: DeathMapKillTypeSplit;
  calibrated: boolean;
}

/** Wire cells array -> the Grid shape the heatmap components consume. */
export function deathCellsToGrid(cells: DeathMapCell[]): Grid {
  const grid: Grid = {};
  for (const cell of cells) {
    grid[cell.cellIndex] = (grid[cell.cellIndex] ?? 0) + cell.deaths;
  }
  return grid;
}
