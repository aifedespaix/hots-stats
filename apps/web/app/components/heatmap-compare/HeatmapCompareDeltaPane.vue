<script setup lang="ts">
import type { Grid } from "@hots-stats/shared-types";
import type { ViewTransform } from "~/composables/useHeatmapSync";
import { GAME_A_PALETTE, HeatmapRenderer } from "~/utils/heatmapRenderer";

const props = defineProps<{
  mapId: string;
  gridCols: number;
  gridRows: number;
  positiveGrid: Grid;
  negativeGrid: Grid;
  viewTransform: ViewTransform;
}>();

const emit = defineEmits<{
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
  // Primary palette here is only used as the positive-side single-hue LUT
  // (DELTA_POSITIVE_RGB, HeatmapRenderer's default secondary) -- passing
  // GAME_A_PALETTE is harmless since `setDeltaData` never touches the
  // ramp's dark/light stops, only its brightest stop's hue via the LUT.
  renderer = new HeatmapRenderer(canvasEl.value, GAME_A_PALETTE);
  // See HeatmapComparePane.vue's identical comment: the `{ immediate: true }`
  // watch below fires during setup, before `renderer` exists, so its first
  // call is a silent no-op without this.
  renderer.setDeltaData(props.positiveGrid, props.negativeGrid, props.gridCols, props.gridRows);
  if (imgEl.value?.complete) onImageLoad();
});

onBeforeUnmount(() => {
  renderer?.destroy();
});

watch(
  [() => props.positiveGrid, () => props.negativeGrid],
  ([positive, negative]) => renderer?.setDeltaData(positive, negative, props.gridCols, props.gridRows),
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
    <div class="flex flex-wrap items-center gap-3 text-[11px] text-muted">
      <span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-[#0891b2]" /> A seulement</span>
      <span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-[#d97706]" /> B seulement</span>
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
