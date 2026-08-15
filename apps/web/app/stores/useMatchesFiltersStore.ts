import { createFilterSortStore } from "./filterSortStore";

export type MatchesSortableColumn = "playedAt" | "durationSeconds" | "gameMode" | "mapName" | "heroName" | "result";

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
