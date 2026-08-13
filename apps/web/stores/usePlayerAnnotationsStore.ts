import { defineStore } from "pinia";
import type { PlayerAnnotation, PlayerAnnotationInput } from "@hots-stats/shared-types";

/**
 * Client-side cache of the connected user's private FDP/PGM flags and notes
 * on other battletags (see apps/api/src/services/player-annotations.service.ts).
 * Shared across the players list, live draft and match detail views so a
 * given battletag is only fetched once per session instead of once per
 * component instance that happens to render it.
 */
export const usePlayerAnnotationsStore = defineStore("player-annotations", {
  state: (): { byBattletag: Record<string, PlayerAnnotation>; pending: Set<string> } => ({
    byBattletag: {},
    pending: new Set(),
  }),
  getters: {
    annotationFor:
      (state) =>
      (battletag: string): PlayerAnnotation | null =>
        state.byBattletag[battletag] ?? null,
  },
  actions: {
    /** Fetches whichever of `battletags` isn't already cached (or in flight) yet, in one request. */
    async fetchMany(battletags: string[]) {
      const missing = [...new Set(battletags.filter(Boolean))].filter(
        (battletag) => !(battletag in this.byBattletag) && !this.pending.has(battletag),
      );
      if (missing.length === 0) return;

      missing.forEach((battletag) => this.pending.add(battletag));
      try {
        const config = useRuntimeConfig();
        const res = await $fetch<{ annotations: Record<string, PlayerAnnotation> }>("/players/annotations", {
          baseURL: config.public.apiBase,
          credentials: "include",
          query: { battletags: missing.join(",") },
        });
        this.byBattletag = { ...this.byBattletag, ...res.annotations };
      } finally {
        missing.forEach((battletag) => this.pending.delete(battletag));
      }
    },
    /** Force-refetches a single battletag, bypassing the cache -- used by the player profile page, which always wants the latest state. */
    async fetchOne(battletag: string): Promise<PlayerAnnotation> {
      const config = useRuntimeConfig();
      const res = await $fetch<{ annotation: PlayerAnnotation }>(
        `/players/${encodeURIComponent(battletag)}/annotation`,
        { baseURL: config.public.apiBase, credentials: "include" },
      );
      this.byBattletag = { ...this.byBattletag, [battletag]: res.annotation };
      return res.annotation;
    },
    async save(battletag: string, input: PlayerAnnotationInput): Promise<PlayerAnnotation> {
      const config = useRuntimeConfig();
      const res = await $fetch<{ annotation: PlayerAnnotation }>(
        `/players/${encodeURIComponent(battletag)}/annotation`,
        { method: "PUT", baseURL: config.public.apiBase, credentials: "include", body: input },
      );
      this.byBattletag = { ...this.byBattletag, [battletag]: res.annotation };
      return res.annotation;
    },
  },
});
