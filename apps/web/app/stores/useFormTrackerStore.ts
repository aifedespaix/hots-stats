import { defineStore } from "pinia";

export const DEFAULT_FORM_TRACKER_LAST_N = 50;

/**
 * The "form tracker" widget's "Volume" setting ("les X dernières parties")
 * is shared and persisted across every page that embeds the widget (heroes,
 * maps, matches) so changing it once applies everywhere on the next visit,
 * instead of resetting to 50 per page.
 */
export const useFormTrackerStore = defineStore("form-tracker", {
  state: (): { lastN: number } => ({ lastN: DEFAULT_FORM_TRACKER_LAST_N }),
  actions: {
    setLastN(value: number) {
      if (!Number.isFinite(value) || value < 1) return;
      this.lastN = Math.round(Math.min(500, value));
    },
  },
  persist: {
    key: "hots-stats:form-tracker",
    pick: ["lastN"],
  },
});
