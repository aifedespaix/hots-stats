import { createFilterSortStore } from "./filterSortStore";

export const useHeroesFiltersStore = createFilterSortStore<{ search: string }, string>(
  "heroes-filters",
  { search: "" },
  { key: "gamesPlayed", dir: "desc" },
);
