<script setup lang="ts">
import type { Grid } from "@hots-stats/shared-types";
import { sumGrids } from "@hots-stats/shared-types";
import { useMatchSpatialSlot } from "~/composables/useMatchSpatialSlot";
import { useSpatialHistorySlot } from "~/composables/useSpatialHistorySlot";
import type { MatchTimelineDeath } from "~/types/coach";
import type { MatchSlotHero } from "~/types/spatial";
import { exportSpatialImageElement } from "~/utils/exportSpatialImage";
import { SLOT_A_RGB, SLOT_B_RGB } from "~/utils/spatialColors";
import type { SpatialPresenceLayer } from "./SpatialHeatmapView.vue";

/**
 * Orchestrates 1 or 2 spatial Slots on one map (see
 * tasks/epic-10-analyse-spatiale.md's Slot model). With comparison off, this
 * renders exactly the pre-existing single-Slot experience (per-hero colors
 * for a "Cette partie" Slot, or the plain aggregate view for a "Historique"
 * one). Turning comparison on adds a 2nd Slot and switches both to a fixed
 * per-Slot color (blue/orange), superposed on one map or rendered side by
 * side.
 */
const props = withDefaults(
  defineProps<{
    mapId: string;
    /** Known ahead of time on a page with a specific match in context (e.g. `/matches/:id`, from `spatial.grid`); omit on `/maps/:mapId`, where it's derived from whichever "Historique" Slot has loaded data instead. */
    gridCols?: number;
    gridRows?: number;
    /** This match's heroes/deaths -- omit (or pass `[]`) on a page with no specific match in context (e.g. `/maps/:mapId`), which disables the "Cette partie" scope entirely. */
    matchHeroes?: MatchSlotHero[];
    matchDeaths?: MatchTimelineDeath[];
    heroOptions: { id: string; name: string }[];
    myBattletag?: string | null;
  }>(),
  { matchHeroes: () => [], matchDeaths: () => [] },
);

const allowMatchScope = computed(() => props.matchHeroes.length > 0);
const myBattletagRef = computed(() => props.myBattletag ?? null);

// Every distinct layer this match's heroes have data on -- empty when no
// match is in context (e.g. /maps/:mapId), single-entry [null] for a
// single-level map. Only meaningful when `allowMatchScope` is true; the
// "Historique"-only case (no active match) always uses the default layer
// for now (deriving available layers for a map with no match in context
// would need a dedicated endpoint, out of scope here).
const availableLayers = computed<(string | null)[]>(() => {
  if (!allowMatchScope.value) return [null];
  const seen = new Set<string | null>();
  for (const hero of props.matchHeroes) for (const l of hero.layers) seen.add(l.layer);
  const layers = [...seen];
  return layers.length > 0 ? layers.sort((a, b) => (a ?? "").localeCompare(b ?? "")) : [null];
});
const activeLayer = ref<string | null>(availableLayers.value[0] ?? null);
function layerTabLabel(layer: string | null): string {
  return layer ?? "Surface";
}

const comparisonEnabled = ref(false);
type SlotScope = "match" | "history";
const slotBScope = ref<SlotScope>(allowMatchScope.value ? "match" : "history");
type RenderMode = "overlay" | "sideBySide";
const renderMode = ref<RenderMode>("overlay");

const presenceOpacity = ref(0.7);
const showKills = ref(true);
const showDeaths = ref(true);

const colorA = computed<[number, number, number] | undefined>(() => (comparisonEnabled.value ? SLOT_A_RGB : undefined));
const colorB = ref<[number, number, number] | undefined>(SLOT_B_RGB);

// Slot A: "Cette partie" when a match is in context, "Historique" otherwise
// (e.g. the Hub des Cartes) -- a single long-lived instance so toggling
// comparison on/off never resets the user's hero/config selection.
const matchSlotA = allowMatchScope.value ? useMatchSpatialSlot(props.matchHeroes, props.matchDeaths, activeLayer, colorA) : null;
const historySlotA = !allowMatchScope.value
  ? useSpatialHistorySlot(props.mapId, props.heroOptions[0]?.id, myBattletagRef, activeLayer)
  : null;

// Slot B only exists once comparison mode is on -- both composables are
// still created eagerly (composables can only be called unconditionally at
// setup time), but `historySlotB`'s fetch is gated by `enabled` so it never
// fires while Slot B is on "Cette partie" scope or comparison is off.
const matchSlotB = allowMatchScope.value ? useMatchSpatialSlot(props.matchHeroes, props.matchDeaths, activeLayer, colorB) : null;
const historySlotBEnabled = computed(() => comparisonEnabled.value && slotBScope.value === "history");
const historySlotB = useSpatialHistorySlot(props.mapId, props.heroOptions[0]?.id, myBattletagRef, activeLayer, historySlotBEnabled);

// Both "Historique" grids share the app-wide grid resolution in practice
// (see spatial-grid.ts), but when no `gridCols`/`gridRows` prop is given
// (no specific match in context), fall back to whichever Slot's aggregate
// response has actually loaded one rather than hard-coding a resolution
// here that could drift from `spatial.schemaVersion`.
const effectiveGridCols = computed(() => props.gridCols ?? historySlotA?.data.value?.grid?.cols ?? historySlotB.data.value?.grid?.cols ?? 128);
const effectiveGridRows = computed(() => props.gridRows ?? historySlotA?.data.value?.grid?.rows ?? historySlotB.data.value?.grid?.rows ?? 128);

const slotALayers = computed<SpatialPresenceLayer[]>(() =>
  matchSlotA ? matchSlotA.presenceLayers.value : [{ grid: historySlotA!.presenceGrid.value, colorRgb: SLOT_A_RGB }],
);
const slotBLayers = computed<SpatialPresenceLayer[]>(() =>
  slotBScope.value === "match" && matchSlotB
    ? matchSlotB.presenceLayers.value
    : [{ grid: historySlotB.presenceGrid.value, colorRgb: colorB.value! }],
);

const slotAMarkers = computed(() => (matchSlotA ? matchSlotA.markerClusters.value : undefined));
const slotBMarkers = computed(() => (slotBScope.value === "match" && matchSlotB ? matchSlotB.markerClusters.value : undefined));

// History-scope kills/deaths are density grids (no per-event coordinates),
// so unlike "Cette partie" markers they can't carry a per-Slot color or
// shape -- when both Slots contribute a density grid, they're summed into
// one shared kills/deaths layer, same green/red as the single-Slot view.
const overlayKillsGrid = computed(() => {
  const grids: Grid[] = [];
  if (!matchSlotA && historySlotA) grids.push(historySlotA.killsGrid.value);
  if (slotBScope.value === "history") grids.push(historySlotB.killsGrid.value);
  return grids.length > 0 ? sumGrids(grids) : undefined;
});
const overlayDeathsGrid = computed(() => {
  const grids: Grid[] = [];
  if (!matchSlotA && historySlotA) grids.push(historySlotA.deathsGrid.value);
  if (slotBScope.value === "history") grids.push(historySlotB.deathsGrid.value);
  return grids.length > 0 ? sumGrids(grids) : undefined;
});
const overlayMarkerClusters = computed(() => {
  const clusters = [...(slotAMarkers.value ?? []), ...(slotBMarkers.value ?? [])];
  return clusters.length > 0 ? clusters : undefined;
});

const heatmapRef = ref<{ mapContainerEl: HTMLElement | null } | null>(null);
const heatmapRefA = ref<{ mapContainerEl: HTMLElement | null } | null>(null);
const heatmapRefB = ref<{ mapContainerEl: HTMLElement | null } | null>(null);

function exportView(heatmapViewRef: { mapContainerEl: HTMLElement | null } | null, suffix: string) {
  if (!heatmapViewRef?.mapContainerEl) return;
  void exportSpatialImageElement(heatmapViewRef.mapContainerEl, `heatmap-${props.mapId}-${suffix}.png`);
}
</script>

<template>
  <div class="space-y-4">
    <div v-if="availableLayers.length > 1" class="flex items-center gap-1.5 text-xs">
      <span class="text-muted">Niveau :</span>
      <UButton
        v-for="l in availableLayers"
        :key="l ?? '__default__'"
        size="xs"
        :variant="activeLayer === l ? 'solid' : 'soft'"
        color="neutral"
        @click="activeLayer = l"
      >
        {{ layerTabLabel(l) }}
      </UButton>
    </div>

    <div v-if="!comparisonEnabled">
      <SpatialMatchSlotFields v-if="matchSlotA" :heroes="matchHeroes" :slot="matchSlotA" />
      <SpatialHistorySlotConfig
        v-else-if="historySlotA"
        v-model:player-mode="historySlotA.playerMode.value"
        v-model:other-battletag="historySlotA.otherBattletag.value"
        v-model:hero-selector="historySlotA.heroSelector.value"
        v-model:selected-hero-id="historySlotA.selectedHeroId.value"
        v-model:selected-role="historySlotA.selectedRole.value"
        v-model:outcome="historySlotA.outcome.value"
        :hero-options="heroOptions"
        :my-battletag="myBattletag"
      />

      <div class="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted">
        <label class="flex items-center gap-1.5"><input v-model="showKills" type="checkbox" /> Kills</label>
        <label class="flex items-center gap-1.5"><input v-model="showDeaths" type="checkbox" /> Morts</label>
        <label class="flex items-center gap-2">
          Opacité présence
          <input v-model.number="presenceOpacity" type="range" min="0.1" max="1" step="0.05" />
        </label>
        <UButton size="xs" variant="ghost" color="neutral" icon="i-heroicons-arrow-down-tray" @click="exportView(heatmapRef, 'slot')">
          Exporter en image
        </UButton>
      </div>

      <p v-if="historySlotA?.loadError.value" class="mt-2 text-sm text-danger">{{ historySlotA.loadError.value }}</p>
      <p v-else-if="historySlotA?.loading.value" class="mt-2 text-sm text-muted">Chargement…</p>
      <p v-else-if="historySlotA && historySlotA.data.value?.matchCount === 0" class="mt-2 text-sm text-muted">
        Aucune partie enregistrée pour cette sélection.
      </p>

      <SpatialHeatmapView
        v-if="matchSlotA || (historySlotA && historySlotA.data.value && historySlotA.data.value.matchCount > 0)"
        ref="heatmapRef"
        class="mt-3"
        :map-id="mapId"
        :layer="activeLayer"
        :grid-cols="effectiveGridCols"
        :grid-rows="effectiveGridRows"
        :layers="slotALayers"
        :marker-clusters="slotAMarkers"
        :kills-grid="matchSlotA ? undefined : historySlotA?.killsGrid.value"
        :deaths-grid="matchSlotA ? undefined : historySlotA?.deathsGrid.value"
        :show-kills="showKills"
        :show-deaths="showDeaths"
        :presence-opacity="presenceOpacity"
      />

      <UButton class="mt-4" size="xs" variant="soft" color="neutral" icon="i-heroicons-plus" @click="comparisonEnabled = true">
        Comparer avec un 2e Slot
      </UButton>
    </div>

    <div v-else class="space-y-4">
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="space-y-2 rounded-lg border border-border p-3">
          <p class="text-xs font-medium" :style="{ color: `rgb(${SLOT_A_RGB.join(',')})` }">Slot A</p>
          <SpatialMatchSlotFields v-if="matchSlotA" :heroes="matchHeroes" :slot="matchSlotA" compact />
          <SpatialHistorySlotConfig
            v-else-if="historySlotA"
            v-model:player-mode="historySlotA.playerMode.value"
            v-model:other-battletag="historySlotA.otherBattletag.value"
            v-model:hero-selector="historySlotA.heroSelector.value"
            v-model:selected-hero-id="historySlotA.selectedHeroId.value"
            v-model:selected-role="historySlotA.selectedRole.value"
            v-model:outcome="historySlotA.outcome.value"
            :hero-options="heroOptions"
            :my-battletag="myBattletag"
          />
        </div>

        <div class="space-y-2 rounded-lg border border-border p-3">
          <div class="flex items-center justify-between">
            <p class="text-xs font-medium" :style="{ color: `rgb(${SLOT_B_RGB.join(',')})` }">Slot B</p>
            <div v-if="allowMatchScope" class="flex gap-1">
              <UButton size="xs" :variant="slotBScope === 'match' ? 'solid' : 'soft'" color="neutral" @click="slotBScope = 'match'">Cette partie</UButton>
              <UButton size="xs" :variant="slotBScope === 'history' ? 'solid' : 'soft'" color="neutral" @click="slotBScope = 'history'">Historique</UButton>
            </div>
          </div>
          <SpatialMatchSlotFields v-if="slotBScope === 'match' && matchSlotB" :heroes="matchHeroes" :slot="matchSlotB" compact />
          <SpatialHistorySlotConfig
            v-else
            v-model:player-mode="historySlotB.playerMode.value"
            v-model:other-battletag="historySlotB.otherBattletag.value"
            v-model:hero-selector="historySlotB.heroSelector.value"
            v-model:selected-hero-id="historySlotB.selectedHeroId.value"
            v-model:selected-role="historySlotB.selectedRole.value"
            v-model:outcome="historySlotB.outcome.value"
            :hero-options="heroOptions"
            :my-battletag="myBattletag"
          />
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-3 text-xs">
        <div class="flex items-center gap-1.5">
          <span class="text-muted">Rendu :</span>
          <UButton size="xs" :variant="renderMode === 'overlay' ? 'solid' : 'soft'" color="neutral" @click="renderMode = 'overlay'">Superposition</UButton>
          <UButton size="xs" :variant="renderMode === 'sideBySide' ? 'solid' : 'soft'" color="neutral" @click="renderMode = 'sideBySide'">Côte à côte</UButton>
        </div>
        <label class="flex items-center gap-1.5 text-muted"><input v-model="showKills" type="checkbox" /> Kills</label>
        <label class="flex items-center gap-1.5 text-muted"><input v-model="showDeaths" type="checkbox" /> Morts</label>
        <label class="flex items-center gap-2 text-muted">
          Opacité
          <input v-model.number="presenceOpacity" type="range" min="0.1" max="1" step="0.05" />
        </label>
        <UButton size="xs" variant="ghost" color="neutral" @click="comparisonEnabled = false">Fermer la comparaison</UButton>
      </div>

      <template v-if="renderMode === 'overlay'">
        <div class="flex justify-end">
          <UButton size="xs" variant="ghost" color="neutral" icon="i-heroicons-arrow-down-tray" @click="exportView(heatmapRef, 'compare')">
            Exporter en image
          </UButton>
        </div>
        <SpatialHeatmapView
          ref="heatmapRef"
          :map-id="mapId"
          :layer="activeLayer"
          :grid-cols="effectiveGridCols"
          :grid-rows="effectiveGridRows"
          :layers="[...slotALayers, ...slotBLayers]"
          :marker-clusters="overlayMarkerClusters"
          :kills-grid="overlayKillsGrid"
          :deaths-grid="overlayDeathsGrid"
          :show-kills="showKills"
          :show-deaths="showDeaths"
          :presence-opacity="presenceOpacity"
        />
      </template>
      <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div class="mb-1 flex justify-end">
            <UButton size="xs" variant="ghost" color="neutral" icon="i-heroicons-arrow-down-tray" @click="exportView(heatmapRefA, 'A')">Exporter</UButton>
          </div>
          <SpatialHeatmapView
            ref="heatmapRefA"
            :map-id="mapId"
            :layer="activeLayer"
            :grid-cols="effectiveGridCols"
            :grid-rows="effectiveGridRows"
            :layers="slotALayers"
            :marker-clusters="slotAMarkers"
            :kills-grid="matchSlotA ? undefined : historySlotA?.killsGrid.value"
            :deaths-grid="matchSlotA ? undefined : historySlotA?.deathsGrid.value"
            :show-kills="showKills"
            :show-deaths="showDeaths"
            :presence-opacity="presenceOpacity"
          />
        </div>
        <div>
          <div class="mb-1 flex justify-end">
            <UButton size="xs" variant="ghost" color="neutral" icon="i-heroicons-arrow-down-tray" @click="exportView(heatmapRefB, 'B')">Exporter</UButton>
          </div>
          <SpatialHeatmapView
            ref="heatmapRefB"
            :map-id="mapId"
            :layer="activeLayer"
            :grid-cols="effectiveGridCols"
            :grid-rows="effectiveGridRows"
            :layers="slotBLayers"
            :marker-clusters="slotBMarkers"
            :kills-grid="slotBScope === 'match' ? undefined : historySlotB.killsGrid.value"
            :deaths-grid="slotBScope === 'match' ? undefined : historySlotB.deathsGrid.value"
            :show-kills="showKills"
            :show-deaths="showDeaths"
            :presence-opacity="presenceOpacity"
          />
        </div>
      </div>
    </div>
  </div>
</template>
