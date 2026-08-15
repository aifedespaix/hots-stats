import { createFilterSortStore } from "./filterSortStore";

export type MatchesSortableColumn = "playedAt" | "durationSeconds" | "gameMode" | "mapName" | "heroName" | "result";

interface MatchesFilters {
  [key: string]: string;
  mode: string;
  heroId: string;
  mapId: string;
  dateFrom: string;
  dateTo: string;
  opponentBattletag: string;
}

export const useMatchesFiltersStore = createFilterSortStore<MatchesFilters, MatchesSortableColumn>(
  "matches-filters",
  { mode: "", heroId: "", mapId: "", dateFrom: "", dateTo: "", opponentBattletag: "" },
  { key: "playedAt", dir: "desc" },
);
