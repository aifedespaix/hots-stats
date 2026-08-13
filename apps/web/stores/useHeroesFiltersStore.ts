import { createFilterSortStore } from "./filterSortStore";

export const useHeroesFiltersStore = createFilterSortStore<{ mode: string; search: string }, string>(
  "heroes-filters",
  { mode: "", search: "" },
  { key: "gamesPlayed", dir: "desc" },
);
