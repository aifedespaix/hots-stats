<script setup lang="ts">
import type { Grid } from "@hots-stats/shared-types";
import type { MatchTimelineDeath } from "~/types/coach";
import type { SpatialEventCluster } from "~/utils/deathClustering";
import type { HeatmapCellDetail, HeatmapPlayerLabels, PlayerSide } from "~/utils/heatmapCellDetails";
import {
  buildCellDetail,
  buildDeathCellIndex,
  cellIndexFromRect,
  computeCellTotals,
  isCellDetailEmpty,
} from "~/utils/heatmapCellDetails";
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
  /** Set only when this layer is one known player ("me"/"ally"/"enemy") -- drives
   * the hover panel's "Toi (Jaina)" / "(ennemi)" decoration. Omitted for a merged
   * ("Mon équipe") or aggregate layer, which keeps its plain label. */
  side?: PlayerSide;
}

const props = withDefaults(
  defineProps<{
    mapId: string;
    /** Which layer of `mapId` is being displayed -- selects the background image (`${mapId}-${layer}.jpg`) via `imageSlug`. `null`/omitted for a single-level map, which keeps the plain `${mapId}.jpg` image. */
    layer?: string | null;
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
    /** Deaths of the match in context, already filtered by the caller to the active
     * heroes and layer -- lets a hovered cell spell out who killed whom. Omit for
     * an aggregate ("Historique") view, which only has counts. */
    deaths?: MatchTimelineDeath[];
    /** BattleTag -> hero name + side, so a hover line reads "Toi (Jaina)" /
     * "Raynor (allié)" instead of a raw BattleTag. */
    playerLabels?: HeatmapPlayerLabels;
    /** The selected heroes' BattleTags: only their kills/deaths count toward a
     * cell's totals (everyone else is still listed for context). Omit to count
     * every participant. */
    activeBattletags?: string[];
    /** Matches behind an aggregate view, shown as context ("Sur 12 parties"). */
    matchCount?: number;
    /** Timeline scrub position, in seconds -- forwarded to SpatialMarkerLayer so the match page's chronology can highlight the deaths around it. */
    highlightAtSeconds?: number | null;
  }>(),
  {
    layer: null,
    killsGrid: undefined,
    deathsGrid: undefined,
    markerClusters: undefined,
    showPresence: true,
    showKills: true,
    showDeaths: true,
    presenceOpacity: 0.75,
    highlightAtSeconds: null,
  },
);

const imageSlug = computed(() => (props.layer ? `${props.mapId}-${props.layer}` : props.mapId));

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

// --- Per-cell hover panel -------------------------------------------------

const hoverCellIndex = ref<number | null>(null);
const hoverPoint = ref({ x: 0, y: 0 });
const hoverContainerSize = ref({ width: 0, height: 0 });

const activeBattletagSet = computed(() =>
  props.activeBattletags ? new Set(props.activeBattletags) : undefined,
);

// The death->cell index and the whole-view totals are both derived once per
// data change, never per pointer move: a hover only ever reads one map entry.
const deathCellIndex = computed(() => buildDeathCellIndex(props.deaths ?? [], props.gridCols, props.gridRows));
const cellTotals = computed(() =>
  computeCellTotals({
    layers: props.layers,
    killsGrid: props.killsGrid,
    deathsGrid: props.deathsGrid,
    deaths: props.deaths,
    activeBattletags: activeBattletagSet.value,
  }),
);

/** Null while nothing is hovered *and* for an empty cell -- most of the map is
 * empty, and a card following the cursor everywhere would be noise. */
const cellDetail = computed<HeatmapCellDetail | null>(() => {
  const cellIndex = hoverCellIndex.value;
  if (cellIndex === null) return null;
  const detail = buildCellDetail({
    cellIndex,
    layers: props.layers,
    totals: cellTotals.value,
    killsGrid: props.killsGrid,
    deathsGrid: props.deathsGrid,
    cellDeaths: props.deaths ? deathCellIndex.value.get(cellIndex) : undefined,
    playerLabels: props.playerLabels,
    activeBattletags: activeBattletagSet.value,
  });
  return isCellDetailEmpty(detail) ? null : detail;
});

/** The hovered cell comes from the map image's own rect -- the very box the grid
 * was bucketed against -- so the cell under the pointer is the cell described. */
function onPointerMove(event: PointerEvent) {
  const img = imgEl.value;
  const container = mapContainerEl.value;
  if (!img || !container) return;
  const cellIndex = cellIndexFromRect(
    event.clientX,
    event.clientY,
    img.getBoundingClientRect(),
    props.gridCols,
    props.gridRows,
  );
  if (cellIndex === null) {
    hoverCellIndex.value = null;
    return;
  }
  const containerRect = container.getBoundingClientRect();
  hoverCellIndex.value = cellIndex;
  hoverPoint.value = { x: event.clientX - containerRect.left, y: event.clientY - containerRect.top };
  hoverContainerSize.value = { width: containerRect.width, height: containerRect.height };
}

function onPointerLeave(event: PointerEvent) {
  // A touch pointer leaves right after the tap that placed it; keeping the panel
  // up is what makes "tap a cell" work on a phone.
  if (event.pointerType === "touch") return;
  hoverCellIndex.value = null;
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
    <div
      ref="mapContainerEl"
      class="relative w-full overflow-hidden rounded-lg border border-border bg-background"
      @pointermove="onPointerMove"
      @pointerdown="onPointerMove"
      @pointerleave="onPointerLeave"
    >
      <img
        ref="imgEl"
        :src="`/images/maps/original/${imageSlug}.jpg`"
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
        :highlight-at-seconds="highlightAtSeconds"
        @select-cluster="(c) => emit('select-cluster', c)"
      />
      <SpatialHeatmapCellTooltip
        v-if="cellDetail"
        :detail="cellDetail"
        :x="hoverPoint.x"
        :y="hoverPoint.y"
        :container-width="hoverContainerSize.width"
        :container-height="hoverContainerSize.height"
        :match-count="matchCount"
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
