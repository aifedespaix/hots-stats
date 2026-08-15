import { createFilterSortStore } from "./filterSortStore";

export type PlayersSortableColumn =
  | "battletag"
  | "gamesTogether"
  | "gamesAsAlly"
  | "gamesAsOpponent"
  | "wins"
  | "losses"
  | "winRatioAsAlly"
  | "winRatioAsOpponent";

export const usePlayersFiltersStore = createFilterSortStore<{ mode: string; search: string }, PlayersSortableColumn>(
  "players-filters",
  { mode: "", search: "" },
  { key: "gamesTogether", dir: "desc" },
);
