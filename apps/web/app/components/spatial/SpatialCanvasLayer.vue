<script setup lang="ts">
import type { Grid } from "@hots-stats/shared-types";
import { cellRowCol, maxGridValue } from "@hots-stats/shared-types";
import { useResizeObserver } from "@vueuse/core";

const props = defineProps<{
  grid: Grid;
  gridCols: number;
  gridRows: number;
  /** Static (not theme-derived) RGB, since a canvas 2D context can't reliably read this app's OKLCH design tokens -- same tradeoff as CalibrationCanvas.vue. */
  colorRgb: [number, number, number];
  /** Max alpha applied to the single most intense cell; every other cell is scaled relative to it. */
  opacity: number;
  naturalWidth: number;
  naturalHeight: number;
}>();

const canvasEl = ref<HTMLCanvasElement | null>(null);

// Floor for the least-intense occupied cell's alpha (relative to `opacity`),
// so a lightly-visited zone doesn't fade to invisible against the map --
// same precedent as `heatmapRenderer.ts`'s `MIN_CELL_ALPHA` (60/255), kept
// here as a fraction since this component's `opacity` is already 0..1.
const MIN_CELL_ALPHA_FRACTION = 60 / 255;

function redraw() {
  const canvas = canvasEl.value;
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx || !props.naturalWidth || !props.naturalHeight) return;

  if (canvas.width !== props.naturalWidth) canvas.width = props.naturalWidth;
  if (canvas.height !== props.naturalHeight) canvas.height = props.naturalHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const max = maxGridValue(props.grid);
  if (max <= 0) return;

  const cellWidth = canvas.width / props.gridCols;
  const cellHeight = canvas.height / props.gridRows;
  const [r, g, b] = props.colorRgb;

  for (const [key, value] of Object.entries(props.grid)) {
    const { col, row } = cellRowCol(Number(key), props.gridCols);
    const intensity = Math.max(MIN_CELL_ALPHA_FRACTION, value / max);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(intensity * props.opacity).toFixed(3)})`;
    // Row 0 = the calibration's world-Y minimum, which is the *bottom* of
    // the map (game engines have Y increasing upward, screens increasing
    // downward) -- same inversion as utils/mapProjection.ts's
    // `projectRawPoint`, so a grid built server-side and a point projected
    // client-side agree on where "up" is. +1px on each edge to avoid thin
    // seams between adjacent cells from sub-pixel rounding.
    const pixelX = col * cellWidth;
    const pixelY = canvas.height - (row + 1) * cellHeight;
    ctx.fillRect(pixelX, pixelY, cellWidth + 1, cellHeight + 1);
  }
}

watch(
  [() => props.grid, () => props.opacity, () => props.naturalWidth, () => props.naturalHeight, () => props.gridCols, () => props.gridRows],
  redraw,
  { deep: true, immediate: true },
);
useResizeObserver(canvasEl, redraw);
</script>

<template>
  <canvas ref="canvasEl" class="pointer-events-none absolute inset-0 h-full w-full object-contain" />
</template>
