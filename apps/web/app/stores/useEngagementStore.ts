import { defineStore } from "pinia";

/**
 * Tracks what the user has already seen for the three engagement signals
 * surfaced as nav chips + toasts: new synced games, pending friend
 * requests, and live draft detection. Split into a "visited" watermark
 * (drives the Historique chip, reset by actually visiting the page) and a
 * separate "notified" watermark (drives the sync toast, so a toast never
 * fires twice for the same games). Only the watermarks persist -- the live
 * counts themselves are refreshed by the watcher composables on every poll.
 */
export const useEngagementStore = defineStore("engagement", {
  state: (): {
    matchesTotal: number;
    matchesBaselineSet: boolean;
    lastVisitedMatchesTotal: number;
    lastNotifiedMatchesTotal: number;
    pendingFriendRequestCount: number;
    notifiedFriendRequestIds: string[];
    lastToastedDraftId: string | null;
  } => ({
    matchesTotal: 0,
    matchesBaselineSet: false,
    lastVisitedMatchesTotal: 0,
    lastNotifiedMatchesTotal: 0,
    pendingFriendRequestCount: 0,
    notifiedFriendRequestIds: [],
    lastToastedDraftId: null,
  }),
  getters: {
    /** Drives the Historique nav chip -- clears the moment the user visits /matches. */
    newMatchesSinceVisit(state): number {
      return Math.max(0, state.matchesTotal - state.lastVisitedMatchesTotal);
    },
    /** Drives the sync toast -- only clears once that toast has actually fired. */
    unnotifiedNewMatches(state): number {
      return Math.max(0, state.matchesTotal - state.lastNotifiedMatchesTotal);
    },
  },
  actions: {
    /** Records the latest known total from a poll. The very first call just sets a baseline -- a fresh session shouldn't toast/badge the user's entire existing history as "new". */
    reportMatchesTotal(total: number) {
      if (!this.matchesBaselineSet) {
        this.lastVisitedMatchesTotal = total;
        this.lastNotifiedMatchesTotal = total;
        this.matchesBaselineSet = true;
      }
      this.matchesTotal = total;
    },
    markMatchesVisited() {
      this.lastVisitedMatchesTotal = this.matchesTotal;
    },
    markMatchesNotified() {
      this.lastNotifiedMatchesTotal = this.matchesTotal;
    },
    reportFriendRequestIds(ids: string[]): string[] {
      this.pendingFriendRequestCount = ids.length;
      const newIds = ids.filter((id) => !this.notifiedFriendRequestIds.includes(id));
      return newIds;
    },
    markFriendRequestsNotified(ids: string[]) {
      // Cap the dedup list so it doesn't grow forever for very active accounts.
      this.notifiedFriendRequestIds = [...this.notifiedFriendRequestIds, ...ids].slice(-200);
    },
  },
  persist: {
    key: "hots-stats:engagement",
    pick: ["matchesBaselineSet", "lastVisitedMatchesTotal", "lastNotifiedMatchesTotal", "notifiedFriendRequestIds"],
  },
});
