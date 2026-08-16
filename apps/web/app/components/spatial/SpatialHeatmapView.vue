<script setup lang="ts">
import type { Grid } from "@hots-stats/shared-types";

// Static approximations of this app's --raw-info/--raw-success/--raw-danger
// design tokens (see assets/css/globals.css) -- not theme-reactive, see
// SpatialCanvasLayer.vue's own doc comment for why.
const PRESENCE_RGB: [number, number, number] = [59, 130, 246]; // blue, ~ --raw-info
const KILLS_RGB: [number, number, number] = [34, 197, 94]; // green, ~ --raw-success
const DEATHS_RGB: [number, number, number] = [239, 68, 68]; // red, ~ --raw-danger

const props = withDefaults(
  defineProps<{
    mapId: string;
    gridCols: number;
    gridRows: number;
    presenceGrid: Grid;
    killsGrid: Grid;
    deathsGrid: Grid;
    showPresence?: boolean;
    showKills?: boolean;
    showDeaths?: boolean;
    presenceOpacity?: number;
  }>(),
  {
    showPresence: true,
    showKills: true,
    showDeaths: true,
    presenceOpacity: 0.75,
  },
);

const imgEl = ref<HTMLImageElement | null>(null);
const naturalWidth = ref(0);
const naturalHeight = ref(0);

function onImageLoad() {
  naturalWidth.value = imgEl.value?.naturalWidth ?? 0;
  naturalHeight.value = imgEl.value?.naturalHeight ?? 0;
}

const totalPresenceSeconds = computed(() => Object.values(props.presenceGrid).reduce((sum, v) => sum + v, 0));
const totalKills = computed(() => Object.values(props.killsGrid).reduce((sum, v) => sum + v, 0));
const totalDeaths = computed(() => Object.values(props.deathsGrid).reduce((sum, v) => sum + v, 0));
</script>

<template>
  <div class="space-y-2">
    <div class="relative w-full overflow-hidden rounded-lg border border-border bg-background">
      <img
        ref="imgEl"
        :src="`/images/maps/original/${mapId}.jpg`"
        :alt="mapId"
        class="block w-full"
        @load="onImageLoad"
      />
      <SpatialCanvasLayer
        v-if="showPresence"
        :grid="presenceGrid"
        :grid-cols="gridCols"
        :grid-rows="gridRows"
        :color-rgb="PRESENCE_RGB"
        :opacity="presenceOpacity"
        :natural-width="naturalWidth"
        :natural-height="naturalHeight"
      />
      <SpatialCanvasLayer
        v-if="showDeaths"
        :grid="deathsGrid"
        :grid-cols="gridCols"
        :grid-rows="gridRows"
        :color-rgb="DEATHS_RGB"
        :opacity="0.9"
        :natural-width="naturalWidth"
        :natural-height="naturalHeight"
      />
      <SpatialCanvasLayer
        v-if="showKills"
        :grid="killsGrid"
        :grid-cols="gridCols"
        :grid-rows="gridRows"
        :color-rgb="KILLS_RGB"
        :opacity="0.9"
        :natural-width="naturalWidth"
        :natural-height="naturalHeight"
      />
    </div>

    <div class="flex flex-wrap gap-3 text-[11px] text-muted">
      <span class="flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-full" style="background: rgb(59, 130, 246)" />
        Présence · {{ Math.round(totalPresenceSeconds) }}s
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-full" style="background: rgb(34, 197, 94)" />
        Kills · {{ totalKills }}
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-full" style="background: rgb(239, 68, 68)" />
        Morts · {{ totalDeaths }}
      </span>
    </div>
  </div>
</template>
