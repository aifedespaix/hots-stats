import { defineStore } from "pinia";
import type { GameMode } from "@hots-stats/shared-types";
import { DEFAULT_GAME_MODE_TAG_KEYS, GAME_MODE_TAGS, type GameModeTagKey } from "~/utils/gameModeTags";

/**
 * Global header filter: which game-mode tags are active, driving every
 * page's data (dashboard, heroes, matches, players, ...). One source of
 * truth instead of a per-page "mode" filter. Persisted to localStorage only
 * (via the pinia-plugin-persistedstate client plugin) - deliberately never
 * synced to the URL, so it stays a pure client preference.
 */
export const useGameModeStore = defineStore("game-mode", {
  state: (): { activeTags: GameModeTagKey[] } => ({
    activeTags: [...DEFAULT_GAME_MODE_TAG_KEYS],
  }),
  getters: {
    /** Raw `GameMode` DB values covered by the active tags, ready for the `mode` API query param. */
    activeModes(state): GameMode[] {
      return GAME_MODE_TAGS.filter((tag) => state.activeTags.includes(tag.key)).flatMap((tag) => tag.modes);
    },
    modeQueryParam(): string {
      return this.activeModes.join(",");
    },
  },
  actions: {
    toggleTag(key: GameModeTagKey) {
      if (this.activeTags.includes(key)) {
        // At least one tag must stay active - the app always needs a mode to filter by.
        if (this.activeTags.length === 1) return;
        this.activeTags = this.activeTags.filter((tag) => tag !== key);
      } else {
        this.activeTags = [...this.activeTags, key];
      }
    },
    setTags(keys: GameModeTagKey[]) {
      this.activeTags = keys.length > 0 ? keys : [...DEFAULT_GAME_MODE_TAG_KEYS];
    },
  },
  persist: {
    key: "hots-stats:game-mode",
    pick: ["activeTags"],
  },
});
