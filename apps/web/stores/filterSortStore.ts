import { defineStore } from "pinia";
import type { UnwrapRef } from "vue";

/**
 * Factory for a small Pinia store holding one page's filter values and sort
 * state (key + direction), persisted to localStorage so both survive
 * reloads/navigation. One store per page (players/heroes/matches), each
 * built by calling this factory with that page's own filter shape - keeps
 * the persistence wiring in one place instead of duplicating it per page.
 */
export function createFilterSortStore<F extends Record<string, unknown>, K extends string>(
  id: string,
  defaultFilters: F,
  defaultSort: { key: K; dir: "asc" | "desc" },
) {
  return defineStore(id, {
    state: (): { filters: F; sortKey: K; sortDir: "asc" | "desc" } => ({
      filters: { ...defaultFilters },
      sortKey: defaultSort.key,
      sortDir: defaultSort.dir,
    }),
    getters: {
      isFiltersDefault(state): boolean {
        return (Object.keys(defaultFilters) as (keyof F)[]).every((key) => (state.filters as F)[key] === defaultFilters[key]);
      },
      isSortDefault(state): boolean {
        return state.sortKey === defaultSort.key && state.sortDir === defaultSort.dir;
      },
    },
    actions: {
      onSort(key: K) {
        if (this.sortKey === key) {
          this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
        } else {
          this.sortKey = key as UnwrapRef<K>;
          this.sortDir = "desc";
        }
      },
      resetFilters() {
        this.filters = { ...defaultFilters } as UnwrapRef<F>;
      },
      resetSort() {
        this.sortKey = defaultSort.key as UnwrapRef<K>;
        this.sortDir = defaultSort.dir;
      },
    },
    persist: {
      key: `hots-stats:${id}`,
      pick: ["filters", "sortKey", "sortDir"],
    },
  });
}
