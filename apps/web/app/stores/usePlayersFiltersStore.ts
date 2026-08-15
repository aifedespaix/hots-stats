import { createFilterSortStore } from "./filterSortStore";

export type PlayersSortableColumn =
  | "battletag"
  | "gamesTogether"
  | "gamesAsAlly"
  | "gamesAsOpponent"
  | "wins"
  | "losses"
  | "winRatioAsAlly"
  | "winRatioAsOpponent"
  | "ratingAverage"
  | "notesCount"
  | "behaviorScore"
  | "globalWinrate"
  | "globalKdRatio";

export const usePlayersFiltersStore = createFilterSortStore<{ search: string }, PlayersSortableColumn>(
  "players-filters",
  { search: "" },
  { key: "gamesTogether", dir: "desc" },
);
