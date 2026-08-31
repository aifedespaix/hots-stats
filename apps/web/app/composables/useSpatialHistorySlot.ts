import { gridFromWireArrays } from "@hots-stats/shared-types";
import type { Ref } from "vue";
import { computed, ref, watch } from "vue";
import type { SpatialAggregateResponse } from "~/types/spatial";

export const HISTORY_HERO_ROLES = ["Tank", "Bruiser", "RangedAssassin", "MeleeAssassin", "Healer", "Support"] as const;
export type HistoryHeroRole = (typeof HISTORY_HERO_ROLES)[number];
export const HISTORY_ROLE_LABELS: Record<HistoryHeroRole, string> = {
  Tank: "Tanks",
  Bruiser: "Bruisers",
  RangedAssassin: "Assassins à distance",
  MeleeAssassin: "Assassins de mêlée",
  Healer: "Soigneurs",
  Support: "Supports",
};

export type HistoryPlayerMode = "global" | "me" | "other";
export type HistoryHeroSelector = "hero" | "role";
export type HistoryOutcome = "all" | "win" | "loss";

/**
 * A "Historique" Slot's config + fetched grids (see
 * tasks/epic-10-analyse-spatiale.md's Slot model) -- drives both Slots of
 * `SpatialSlotGroup.vue` whenever either is scoped to "Historique" (always
 * both on `/maps/:mapId`, since there's no specific match in context there).
 */
export function useSpatialHistorySlot(
  mapId: string,
  defaultHeroId: string | undefined,
  myBattletag: Ref<string | null>,
  // Which layer of a multi-layer map to fetch the aggregate for -- a
  // "Historique" Slot always represents exactly one layer per request.
  activeLayer: Ref<string | null>,
  // Skips the fetch until true -- lets `SpatialSlotGroup.vue` create a 2nd
  // Slot's composable instance up front (composables can only be called
  // unconditionally at setup time) without firing its request before the
  // user actually switches that Slot to "Historique" scope.
  enabled: Ref<boolean> = ref(true),
) {
  const config = useRuntimeConfig();

  const playerMode = ref<HistoryPlayerMode>("global");
  const otherBattletag = ref("");
  const heroSelector = ref<HistoryHeroSelector>("hero");
  const selectedHeroId = ref<string | undefined>(defaultHeroId);
  const selectedRole = ref<HistoryHeroRole>("Tank");
  const outcome = ref<HistoryOutcome>("all");

  const battletag = computed(() => {
    if (playerMode.value === "me") return myBattletag.value;
    if (playerMode.value === "other") return otherBattletag.value.trim() || null;
    return null;
  });
  const isGlobal = computed(() => playerMode.value === "global");

  const data = ref<SpatialAggregateResponse | null>(null);
  const loading = ref(false);
  const loadError = ref<string | null>(null);

  async function load() {
    if (!enabled.value) return;
    const heroParam = heroSelector.value === "hero" ? selectedHeroId.value : undefined;
    const roleParam = heroSelector.value === "role" ? selectedRole.value : undefined;
    if (!heroParam && !roleParam) return;
    if (!isGlobal.value && !battletag.value) return;

    loading.value = true;
    loadError.value = null;
    try {
      data.value = await $fetch<SpatialAggregateResponse>("/spatial/aggregate", {
        baseURL: config.public.apiBase,
        credentials: "include",
        query: {
          mapId,
          ...(activeLayer.value ? { layer: activeLayer.value } : {}),
          ...(heroParam ? { heroId: heroParam } : { role: roleParam }),
          ...(isGlobal.value ? { global: "true" } : { battletag: battletag.value }),
          outcome: outcome.value,
        },
      });
    } catch (err) {
      loadError.value = (err as { data?: { error?: unknown } })?.data?.error ? "Requête invalide" : "Impossible de charger l'agrégat";
      data.value = null;
    } finally {
      loading.value = false;
    }
  }

  watch([playerMode, otherBattletag, heroSelector, selectedHeroId, selectedRole, outcome, enabled, activeLayer], load, { immediate: true });

  const presenceGrid = computed(() => (data.value ? gridFromWireArrays(data.value.presence.cellIndex, data.value.presence.values) : {}));
  const killsGrid = computed(() => (data.value ? gridFromWireArrays(data.value.kills.cellIndex, data.value.kills.values) : {}));
  const deathsGrid = computed(() => (data.value ? gridFromWireArrays(data.value.deaths.cellIndex, data.value.deaths.values) : {}));

  return {
    playerMode,
    otherBattletag,
    heroSelector,
    selectedHeroId,
    selectedRole,
    outcome,
    isGlobal,
    data,
    loading,
    loadError,
    presenceGrid,
    killsGrid,
    deathsGrid,
  };
}
