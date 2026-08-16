<script setup lang="ts">
import type { Grid } from "@hots-stats/shared-types";
import type { HeatmapPathPoint, ViewTransform } from "~/composables/useHeatmapSync";
import { HeatmapRenderer, type HeatmapMarker, type RgbColorStop } from "~/utils/heatmapRenderer";

interface HeroOption {
  battletag: string;
  heroId: string;
  heroName: string;
  team: number;
}

const props = defineProps<{
  mapId: string;
  gridCols: number;
  gridRows: number;
  paletteColorStops: RgbColorStop[];
  densityGrid: Grid;
  pathPoints: HeatmapPathPoint[];
  markers: HeatmapMarker[];
  viewTransform: ViewTransform;
  heroOptions: HeroOption[];
  selectedBattletag: string | null;
  accentTextClass: string;
  title: string;
}>();

const emit = defineEmits<{
  "select-hero": [battletag: string];
  pan: [dx: number, dy: number];
  zoom: [factor: number];
}>();

const imgEl = ref<HTMLImageElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
let renderer: HeatmapRenderer | null = null;

function onImageLoad() {
  if (!renderer || !imgEl.value) return;
  renderer.setMapSize(imgEl.value.naturalWidth, imgEl.value.naturalHeight);
}

onMounted(() => {
  if (!canvasEl.value) return;
  renderer = new HeatmapRenderer(canvasEl.value, props.paletteColorStops);
  // Seed with whatever the props already are: the `{ immediate: true }`
  // watchers below fire during setup, *before* this runs, so `renderer` is
  // still null when they do and their initial calls are silent no-ops --
  // without this, the first render stays empty until some later prop
  // change (e.g. moving the slider) fires a watcher for real.
  renderer.setData(props.densityGrid, props.gridCols, props.gridRows);
  renderer.setPath(props.pathPoints);
  renderer.setMarkers(props.markers);
  if (imgEl.value?.complete) onImageLoad();
});

onBeforeUnmount(() => {
  renderer?.destroy();
});

watch(
  () => props.densityGrid,
  (grid) => renderer?.setData(grid, props.gridCols, props.gridRows),
  { immediate: true },
);
watch(
  () => props.pathPoints,
  (points) => renderer?.setPath(points),
  { immediate: true },
);
watch(
  () => props.markers,
  (markers) => renderer?.setMarkers(markers),
  { immediate: true },
);

const paneStyle = computed(() => ({
  transform: `translate(${props.viewTransform.offsetX}px, ${props.viewTransform.offsetY}px) scale(${props.viewTransform.scale})`,
  transformOrigin: "center",
}));

let dragStart: { clientX: number; clientY: number } | null = null;

function onPointerDown(event: PointerEvent) {
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  dragStart = { clientX: event.clientX, clientY: event.clientY };
}

function onPointerMove(event: PointerEvent) {
  if (!dragStart) return;
  const dx = event.clientX - dragStart.clientX;
  const dy = event.clientY - dragStart.clientY;
  dragStart = { clientX: event.clientX, clientY: event.clientY };
  emit("pan", dx, dy);
}

function onPointerUp() {
  dragStart = null;
}

function onWheel(event: WheelEvent) {
  event.preventDefault();
  emit("zoom", event.deltaY < 0 ? 1.15 : 1 / 1.15);
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between gap-2">
      <h3 class="font-heading text-sm font-semibold" :class="accentTextClass">{{ title }}</h3>
    </div>

    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="hero in heroOptions"
        :key="hero.battletag"
        type="button"
        class="rounded-full border px-2 py-0.5 text-[11px] transition-colors"
        :class="
          hero.battletag === selectedBattletag
            ? `border-current bg-current/15 ${accentTextClass}`
            : 'border-border text-muted hover:text-foreground'
        "
        :aria-pressed="hero.battletag === selectedBattletag"
        @click="emit('select-hero', hero.battletag)"
      >
        {{ hero.heroName }}
      </button>
    </div>

    <div
      class="relative w-full touch-none select-none overflow-hidden rounded-lg border border-border bg-background"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div class="pointer-events-none" :style="paneStyle">
        <img ref="imgEl" :src="`/images/maps/original/${mapId}.jpg`" :alt="mapId" class="block w-full" @load="onImageLoad" />
        <canvas ref="canvasEl" class="absolute inset-0 h-full w-full object-contain" />
      </div>
    </div>
  </div>
</template>
