import { createFilterSortStore } from "./filterSortStore";

/** Sortable columns of the heroes list, used to validate the `sort` URL param. */
export const HEROES_SORTABLE_COLUMNS = [
  "heroName",
  "heroRole",
  "gamesPlayed",
  "winrate",
  "avgKillParticipation",
] as const;

export const useHeroesFiltersStore = createFilterSortStore<{ search: string }, string>(
  "heroes-filters",
  { search: "" },
  { key: "gamesPlayed", dir: "desc" },
);
