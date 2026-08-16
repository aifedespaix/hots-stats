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

/** `GET /matches/:id`'s `spatial` field -- absent entirely when no hero in the match has spatial data. */
export interface MatchSpatialData {
  grid: { cols: number; rows: number };
  heroes: MatchSpatialHero[];
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
