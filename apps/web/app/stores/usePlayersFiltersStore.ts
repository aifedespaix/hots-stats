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

export const usePlayersFiltersStore = createFilterSortStore<{ search: string }, PlayersSortableColumn>(
  "players-filters",
  { search: "" },
  { key: "gamesTogether", dir: "desc" },
);
