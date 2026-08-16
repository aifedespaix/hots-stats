export interface WireGrid {
  cellIndex: number[];
  values: number[];
}

/** One hero's grids for a specific match -- `GET /matches/:id`'s `spatial.heroes[]`. */
export interface MatchSpatialHero {
  matchPlayerId: string;
  battletag: string | null;
  heroId: string | null;
  team: number | null;
  presence: WireGrid;
  kills: WireGrid;
  deaths: WireGrid;
}

/** One hero's downsampled, *timestamped* path for a match --
 * `GET /matches/:id`'s `spatial.trajectories[]`. Unlike `MatchSpatialHero`'s
 * `presence` grid (a match-long aggregate with no timestamp left to slice
 * by), this keeps each sample's own `atSeconds`, which is what the Pro
 * Comparison View needs for time-sliced/event-anchored heatmaps and literal
 * rotation pathing (see `useHeatmapSync.ts`). Present only for a match
 * ingested with PARSER_VERSION >= 1.11 -- absent (not an empty array) for
 * an older, calibrated match that only ever got a presence grid. */
export interface MatchHeroTrajectory {
  matchPlayerId: string;
  battletag: string | null;
  heroId: string | null;
  team: number | null;
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

/** One hero's grids for `SpatialMatchSlot.vue`, cross-referencing `MatchSpatialHero` with scoreboard display info (name, ally/enemy). */
export interface MatchSlotHero {
  matchPlayerId: string;
  battletag: string;
  heroId: string;
  heroName: string;
  team: number;
  isAlly: boolean;
  presence: WireGrid;
  kills: WireGrid;
  deaths: WireGrid;
}

export type SpatialOutcomeFilter = "win" | "loss" | "all";

/** `GET /spatial/aggregate` response -- one combined grid for a "Historique" Slot (see tasks/epic-10-analyse-spatiale.md). */
export interface SpatialAggregateResponse {
  matchCount: number;
  grid: { cols: number; rows: number } | null;
  presence: WireGrid;
  kills: WireGrid;
  deaths: WireGrid;
}
