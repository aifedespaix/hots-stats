<script setup lang="ts">
import type { Grid } from "@hots-stats/shared-types";
import type { SpatialEventCluster } from "~/utils/deathClustering";
import { DEATH_MARKER_RGB, KILL_MARKER_RGB } from "~/utils/spatialColors";

// Static approximations of this app's --raw-info/--raw-success/--raw-danger
// design tokens (see assets/css/globals.css) -- not theme-reactive, see
// SpatialCanvasLayer.vue's own doc comment for why.
const KILLS_RGB = KILL_MARKER_RGB;
const DEATHS_RGB = DEATH_MARKER_RGB;

/** One colored density layer -- one per hero (categorical palette) in a
 * single-Slot multi-hero overlay, or one per Slot (fixed blue/orange) in
 * 2-Slot comparison mode. See `spatialColors.ts`. */
export interface SpatialPresenceLayer {
  grid: Grid;
  colorRgb: [number, number, number];
  /** Overrides `presenceOpacity` for this one layer; omit to use the shared slider value. */
  opacity?: number;
  label?: string;
}

const props = withDefaults(
  defineProps<{
    mapId: string;
    gridCols: number;
    gridRows: number;
    /** One or more colored presence layers, stacked on the same canvas -- see `SpatialPresenceLayer`. */
    layers: SpatialPresenceLayer[];
    /** Density kills/deaths, for a "Historique" (multi-match) Slot -- omit and pass `markerClusters` instead for a "Cette partie" Slot, which renders discrete markers instead (see `SpatialMarkerLayer.vue`). */
    killsGrid?: Grid;
    deathsGrid?: Grid;
    /** Discrete kill/death markers for a "Cette partie" Slot -- mutually exclusive with `killsGrid`/`deathsGrid` in practice, both are optional so a caller with neither just gets a bare presence heatmap. */
    markerClusters?: SpatialEventCluster[];
    showPresence?: boolean;
    showKills?: boolean;
    showDeaths?: boolean;
    presenceOpacity?: number;
  }>(),
  {
    killsGrid: undefined,
    deathsGrid: undefined,
    markerClusters: undefined,
    showPresence: true,
    showKills: true,
    showDeaths: true,
    presenceOpacity: 0.75,
  },
);

const emit = defineEmits<{ "select-cluster": [cluster: SpatialEventCluster] }>();

const imgEl = ref<HTMLImageElement | null>(null);
const mapContainerEl = ref<HTMLElement | null>(null);
const naturalWidth = ref(0);
const naturalHeight = ref(0);

/** Exposes the map+layers container (not the legend below it) for `exportSpatialImage.ts` to rasterize. */
defineExpose({ mapContainerEl });

function onImageLoad() {
  naturalWidth.value = imgEl.value?.naturalWidth ?? 0;
  naturalHeight.value = imgEl.value?.naturalHeight ?? 0;
}

function sumGridValues(grid: Grid): number {
  return Object.values(grid).reduce((sum, v) => sum + v, 0);
}

const totalKills = computed(() => (props.killsGrid ? sumGridValues(props.killsGrid) : props.markerClusters?.filter((c) => c.kind === "kill").reduce((sum, c) => sum + c.points.length, 0)));
const totalDeaths = computed(() => (props.deathsGrid ? sumGridValues(props.deathsGrid) : props.markerClusters?.filter((c) => c.kind === "death").reduce((sum, c) => sum + c.points.length, 0)));

function rgbCss(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
</script>

<template>
  <div class="space-y-2">
    <div ref="mapContainerEl" class="relative w-full overflow-hidden rounded-lg border border-border bg-background">
      <img
        ref="imgEl"
        :src="`/images/maps/original/${mapId}.jpg`"
        :alt="mapId"
        class="block w-full"
        @load="onImageLoad"
      />
      <SpatialCanvasLayer
        v-for="(layer, i) in showPresence ? layers : []"
        :key="i"
        :grid="layer.grid"
        :grid-cols="gridCols"
        :grid-rows="gridRows"
        :color-rgb="layer.colorRgb"
        :opacity="layer.opacity ?? presenceOpacity"
        :natural-width="naturalWidth"
        :natural-height="naturalHeight"
      />
      <SpatialCanvasLayer
        v-if="showDeaths && deathsGrid"
        :grid="deathsGrid"
        :grid-cols="gridCols"
        :grid-rows="gridRows"
        :color-rgb="DEATHS_RGB"
        :opacity="0.9"
        :natural-width="naturalWidth"
        :natural-height="naturalHeight"
      />
      <SpatialCanvasLayer
        v-if="showKills && killsGrid"
        :grid="killsGrid"
        :grid-cols="gridCols"
        :grid-rows="gridRows"
        :color-rgb="KILLS_RGB"
        :opacity="0.9"
        :natural-width="naturalWidth"
        :natural-height="naturalHeight"
      />
      <SpatialMarkerLayer
        v-if="markerClusters && (showKills || showDeaths) && naturalHeight > 0"
        :clusters="markerClusters.filter((c) => (c.kind === 'kill' ? showKills : showDeaths))"
        :aspect-ratio="naturalWidth / naturalHeight"
        @select-cluster="(c) => emit('select-cluster', c)"
      />
    </div>

    <div class="flex flex-wrap gap-3 text-[11px] text-muted">
      <span v-for="(layer, i) in layers" :key="i" class="flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-full" :style="{ background: rgbCss(layer.colorRgb) }" />
        {{ layer.label ?? "Présence" }} · {{ Math.round(sumGridValues(layer.grid)) }}s
      </span>
      <span v-if="totalKills !== undefined" class="flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-full" :style="{ background: rgbCss(KILLS_RGB) }" />
        Kills · {{ totalKills }}
      </span>
      <span v-if="totalDeaths !== undefined" class="flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-full" :style="{ background: rgbCss(DEATHS_RGB) }" />
        Morts · {{ totalDeaths }}
      </span>
    </div>
  </div>
</template>
