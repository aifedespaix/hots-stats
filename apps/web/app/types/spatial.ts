export interface WireGrid {
  cellIndex: number[];
  values: number[];
}

/** One hero's grids for one layer of a specific match. */
export interface MatchSpatialLayerGrids {
  layer: string | null;
  presence: WireGrid;
  kills: WireGrid;
  deaths: WireGrid;
}

/** One hero's per-layer grids for a specific match -- `GET /matches/:id`'s
 * `spatial.heroes[]`. A single-level map's heroes each have exactly one
 * entry in `layers`, with `layer: null`. */
export interface MatchSpatialHero {
  matchPlayerId: string;
  battletag: string | null;
  heroId: string | null;
  team: number | null;
  layers: MatchSpatialLayerGrids[];
}

/** One hero's downsampled, *timestamped* path for a match, for one layer --
 * `GET /matches/:id`'s `spatial.trajectories[]`. Unlike `MatchSpatialHero`'s
 * `layers[].presence` (a match-long aggregate with no timestamp left to
 * slice by), this keeps each sample's own `atSeconds`, which is what the
 * Pro Comparison View needs for time-sliced/event-anchored heatmaps and
 * literal rotation pathing (see `useHeatmapSync.ts`). Present only for a
 * match ingested with PARSER_VERSION >= 1.11 -- absent (not an empty array)
 * for an older, calibrated match that only ever got a presence grid. Kept
 * flat (one entry per hero *and* layer, not grouped like `MatchSpatialHero`)
 * since a timestamped path can't be merged across layers. */
export interface MatchHeroTrajectory {
  matchPlayerId: string;
  battletag: string | null;
  heroId: string | null;
  team: number | null;
  layer: string | null;
  atSeconds: number[];
  x: number[];
  y: number[];
}

/** `GET /matches/:id`'s `spatial` field -- absent entirely when no hero in the match has spatial data. */
export interface MatchSpatialData {
  grid: { cols: number; rows: number };
  heroes: MatchSpatialHero[];
  trajectories?: MatchHeroTrajectory[];
}

/** One hero's per-layer grids for a "Cette partie" Slot (`useMatchSpatialSlot.ts`), cross-referencing `MatchSpatialHero` with scoreboard display info (name, ally/enemy). */
export interface MatchSlotHero {
  matchPlayerId: string;
  battletag: string;
  heroId: string;
  heroName: string;
  team: number;
  isAlly: boolean;
  layers: MatchSpatialLayerGrids[];
}

export type SpatialOutcomeFilter = "win" | "loss" | "all";

/** `GET /spatial/aggregate` response -- one combined grid, for one layer, for a "Historique" Slot (see tasks/epic-10-analyse-spatiale.md). */
export interface SpatialAggregateResponse {
  matchCount: number;
  grid: { cols: number; rows: number } | null;
  presence: WireGrid;
  kills: WireGrid;
  deaths: WireGrid;
}
