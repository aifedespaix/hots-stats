import { defineStore } from "pinia";
import type { PlayerAnnotation, PlayerAnnotationInput, SharedPlayerAnnotation } from "@hots-stats/shared-types";

/**
 * Client-side cache of FDP/Sympa vote counts, star ratings and notes for battletags, aggregated across the
 * connected user and their accepted friends (see apps/api/src/services/player-annotations.service.ts
 * `listSharedPlayerAnnotations`). Shared across the players list, live draft and match detail
 * views so a given battletag is only fetched once per session instead of once per component
 * instance that happens to render it.
 */

/**
 * BattleTags sent per bulk request. The whole list used to be crammed into a
 * single `?battletags=` value; the API (Bun) rejects a request line over ~16 KiB
 * with HTTP 431, so a long players list (roughly 800+ encountered BattleTags)
 * made the one annotation request fail and blanked every "Note"/"Commentaires"
 * cell at once. At ~25 encoded chars per BattleTag, 200 keeps a batch well under
 * that ceiling.
 */
export const ANNOTATIONS_BATCH_SIZE = 200;

/**
 * BattleTags whose fetch is currently in flight. Deliberately module-scoped and
 * NOT part of the Pinia state: @pinia/nuxt's `app:rendered` hook dumps the whole
 * store state into the SSR payload (node_modules/@pinia/nuxt/dist/runtime/plugin.js)
 * and the client restores it verbatim. A battletag still in flight when the server
 * finished rendering would therefore arrive on the client as "pending", make
 * `fetchMany` skip it forever, and leave the "Note"/"Commentaires" columns blank
 * until a later reload happened to win the race. Keeping the in-flight registry out
 * of state also means a hydrated client always believes nothing is in flight and
 * refetches whatever the server did not manage to cache.
 */
const inFlight = new Set<string>();

export const usePlayerAnnotationsStore = defineStore("player-annotations", {
  state: (): { byBattletag: Record<string, SharedPlayerAnnotation> } => ({
    byBattletag: {},
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
        (battletag) => !(battletag in this.byBattletag) && !inFlight.has(battletag),
      );
      if (missing.length === 0) return;

      missing.forEach((battletag) => inFlight.add(battletag));
      try {
        const batches: string[][] = [];
        for (let i = 0; i < missing.length; i += ANNOTATIONS_BATCH_SIZE) {
          batches.push(missing.slice(i, i + ANNOTATIONS_BATCH_SIZE));
        }
        await Promise.all(batches.map((batch) => this.fetchBattletags(batch)));
      } finally {
        missing.forEach((battletag) => inFlight.delete(battletag));
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
