import { createFilterSortStore } from "./filterSortStore";

export type MatchesSortableColumn = "playedAt" | "durationSeconds" | "gameMode" | "mapName" | "heroName" | "result";

/** Runtime allowlist of the sortable columns, used to validate the `sort` URL param.
 * `satisfies` keeps it in lockstep with the union above. */
export const MATCHES_SORTABLE_COLUMNS = [
  "playedAt",
  "durationSeconds",
  "gameMode",
  "mapName",
  "heroName",
  "result",
] as const satisfies readonly MatchesSortableColumn[];

interface MatchesFilters {
  [key: string]: string;
  heroId: string;
  mapId: string;
  dateFrom: string;
  dateTo: string;
  opponentBattletag: string;
}

export const useMatchesFiltersStore = createFilterSortStore<MatchesFilters, MatchesSortableColumn>(
  "matches-filters",
  { heroId: "", mapId: "", dateFrom: "", dateTo: "", opponentBattletag: "" },
  { key: "playedAt", dir: "desc" },
);
