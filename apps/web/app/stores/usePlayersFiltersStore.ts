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

/** Runtime allowlist of the sortable columns, used to validate the `sort` URL param.
 * `satisfies` keeps it in lockstep with the union above. */
export const PLAYERS_SORTABLE_COLUMNS = [
  "battletag",
  "gamesTogether",
  "gamesAsAlly",
  "gamesAsOpponent",
  "wins",
  "losses",
  "winRatioAsAlly",
  "winRatioAsOpponent",
  "ratingAverage",
  "notesCount",
  "behaviorScore",
  "globalWinrate",
  "globalKdRatio",
] as const satisfies readonly PlayersSortableColumn[];

export const usePlayersFiltersStore = createFilterSortStore<{ search: string }, PlayersSortableColumn>(
  "players-filters",
  { search: "" },
  { key: "gamesTogether", dir: "desc" },
);
