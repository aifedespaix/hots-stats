import { defineStore } from "pinia";

/**
 * "Version" filter on the matches history page: which of the connected
 * user's known `gameVersion` values (see `GET /matches/filters`) are
 * included. Stores the EXCLUDED set, not the included one, so a version
 * that's never been explicitly unchecked -- including a brand new patch
 * that ships after this was last touched -- defaults to checked, per the
 * page's requirement that new versions show up active by default.
 * Persisted to localStorage (via the pinia-plugin-persistedstate client
 * plugin), scoped to just this page's filter (unlike the global, always-on
 * useGameModeStore).
 */
export const useGameVersionFilterStore = defineStore("matches-game-version-filter", {
  state: (): { excluded: string[] } => ({ excluded: [] }),
  getters: {
    isDefault(state): boolean {
      return state.excluded.length === 0;
    },
  },
  actions: {
    isExcluded(version: string): boolean {
      return this.excluded.includes(version);
    },
    toggle(version: string) {
      this.excluded = this.isExcluded(version)
        ? this.excluded.filter((v) => v !== version)
        : [...this.excluded, version];
    },
    /** Called with the full set of currently-known versions and whichever
     * subset of them should now be checked -- every other known version
     * becomes excluded. Used by the multi-select's `update:model-value`. */
    setIncluded(allVersions: string[], included: string[]) {
      this.excluded = allVersions.filter((v) => !included.includes(v));
    },
    /** "Décocher tout": excludes every version known at click time. A
     * version that ships later (not part of `allVersions` here) still
     * defaults to checked, same as any other never-explicitly-unchecked
     * version -- this is a snapshot action, not a standing "exclude
     * everything, forever" rule. */
    excludeAll(allVersions: string[]) {
      this.excluded = [...allVersions];
    },
    /** "Cocher tout": clearing the excluded set is equivalent to including
     * everything, current and future. */
    includeAll() {
      this.excluded = [];
    },
  },
  persist: {
    key: "hots-stats:matches-game-version-filter",
    pick: ["excluded"],
  },
});
