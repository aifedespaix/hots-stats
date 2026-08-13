import { defineStore } from "pinia";
import type { PlayerAnnotation, PlayerAnnotationInput, SharedPlayerAnnotation } from "@hots-stats/shared-types";

/**
 * Client-side cache of FDP/PGM vote counts and notes for battletags, aggregated across the
 * connected user and their accepted friends (see apps/api/src/services/player-annotations.service.ts
 * `listSharedPlayerAnnotations`). Shared across the players list, live draft and match detail
 * views so a given battletag is only fetched once per session instead of once per component
 * instance that happens to render it.
 */
export const usePlayerAnnotationsStore = defineStore("player-annotations", {
  state: (): { byBattletag: Record<string, SharedPlayerAnnotation>; pending: Set<string> } => ({
    byBattletag: {},
    pending: new Set(),
  }),
  getters: {
    annotationFor:
      (state) =>
      (battletag: string): SharedPlayerAnnotation | null =>
        state.byBattletag[battletag] ?? null,
  },
  actions: {
    async fetchBattletags(battletags: string[]) {
      const config = useRuntimeConfig();
      const res = await $fetch<{ annotations: Record<string, SharedPlayerAnnotation> }>("/players/annotations", {
        baseURL: config.public.apiBase,
        credentials: "include",
        query: { battletags: battletags.join(",") },
      });
      this.byBattletag = { ...this.byBattletag, ...res.annotations };
    },
    /** Fetches whichever of `battletags` isn't already cached (or in flight) yet, in one request. */
    async fetchMany(battletags: string[]) {
      const missing = [...new Set(battletags.filter(Boolean))].filter(
        (battletag) => !(battletag in this.byBattletag) && !this.pending.has(battletag),
      );
      if (missing.length === 0) return;

      missing.forEach((battletag) => this.pending.add(battletag));
      try {
        await this.fetchBattletags(missing);
      } finally {
        missing.forEach((battletag) => this.pending.delete(battletag));
      }
    },
    /** Force-refetches a single battletag's shared aggregate, bypassing the cache -- used after
     * saving an annotation and by the player profile page, which always wants the latest state. */
    async refreshOne(battletag: string) {
      await this.fetchBattletags([battletag]);
    },
    /** Fetches the connected user's own (unshared) annotation on a battletag, for pre-filling
     * the edit form -- deliberately not cached in `byBattletag`, which holds the shared aggregate. */
    async fetchMine(battletag: string): Promise<PlayerAnnotation> {
      const config = useRuntimeConfig();
      const res = await $fetch<{ annotation: PlayerAnnotation }>(
        `/players/${encodeURIComponent(battletag)}/annotation`,
        { baseURL: config.public.apiBase, credentials: "include" },
      );
      return res.annotation;
    },
    async save(battletag: string, input: PlayerAnnotationInput): Promise<PlayerAnnotation> {
      const config = useRuntimeConfig();
      const res = await $fetch<{ annotation: PlayerAnnotation }>(
        `/players/${encodeURIComponent(battletag)}/annotation`,
        { method: "PUT", baseURL: config.public.apiBase, credentials: "include", body: input },
      );
      await this.refreshOne(battletag);
      return res.annotation;
    },
  },
});
