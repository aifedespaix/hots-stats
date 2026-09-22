<script setup lang="ts">
import { useResizeObserver } from "@vueuse/core";
import type { MapBoundsInput } from "~/utils/mapProjection";
import { ALLY_TEAM_RGB, ENEMY_TEAM_RGB } from "~/utils/spatialColors";

interface CalibrationPoint {
  x: number;
  y: number;
  team?: 0 | 1 | null;
  kind?: "scatter" | "spawn";
}

const props = defineProps<{
  mapId: string;
  layer?: string | null;
  points: CalibrationPoint[];
  bounds: MapBoundsInput;
}>();

const imageSlug = computed(() => (props.layer ? `${props.mapId}-${props.layer}` : props.mapId));

const wrapperEl = ref<HTMLDivElement | null>(null);
const imgEl = ref<HTMLImageElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);

// Sized to the image's *intrinsic* pixels (its backing store), not its CSS
// box -- both the <img> and <canvas> share that same aspect ratio and the
// same `object-contain`, so the browser letterboxes them identically inside
// the wrapper. Drawing in this 0..naturalWidth x 0..naturalHeight space then
// lands in the right spot with zero extra offset math here, even as the
// wrapper resizes -- unlike a general-purpose overlay, this doesn't need to
// replicate the letterbox math the browser already does for us.
function syncCanvasSize() {
  const img = imgEl.value;
  const canvas = canvasEl.value;
  if (!img || !canvas || !img.naturalWidth || !img.naturalHeight) return;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  redraw();
}

const GRID_DIVISIONS = 10;

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.strokeStyle = "rgba(148, 163, 184, 0.35)"; // static slate, not a theme token -- see below
  ctx.lineWidth = 1;
  for (let i = 1; i < GRID_DIVISIONS; i++) {
    const x = (width * i) / GRID_DIVISIONS;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    const y = (height * i) / GRID_DIVISIONS;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

/** Small "(minX, minY)"/"(maxX, maxY)" corner labels, with a background
 * plate for legibility over arbitrary map art -- anchors which corner is
 * which so the Y-axis inversion (world Y-up vs. screen Y-down, see
 * ~/utils/mapProjection.ts) is visible in the UI, not just implicit in the
 * math. */
function drawCornerLabels(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.font = "12px sans-serif";
  const pad = 6;

  const minLabel = `Min X ${props.bounds.minX} · Min Y ${props.bounds.minY}`;
  const minWidth = ctx.measureText(minLabel).width;
  ctx.fillStyle = "rgba(15, 23, 42, 0.7)";
  ctx.fillRect(0, height - 22, minWidth + pad * 2, 22);
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText(minLabel, pad, height - 7);

  const maxLabel = `Max X ${props.bounds.maxX} · Max Y ${props.bounds.maxY}`;
  const maxWidth = ctx.measureText(maxLabel).width;
  ctx.fillStyle = "rgba(15, 23, 42, 0.7)";
  ctx.fillRect(width - maxWidth - pad * 2, 0, maxWidth + pad * 2, 22);
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText(maxLabel, width - maxWidth - pad, 15);
}

// Fallback for a point with no `team` -- a raw sample uploaded by a daemon
// older than PARSER_VERSION "1.17" has none, and must still render. Same red
// every point used unconditionally before team colors existed.
const NEUTRAL_RGB: [number, number, number] = [239, 68, 68];
// Gold outline that makes a "spawn" point (a hero's earliest recorded
// position -- see rawMapPointSchema in shared-types) visually pop out of
// the much larger "scatter" cloud, regardless of its team fill color.
const SPAWN_RING_RGB = "rgba(234, 179, 8, 0.95)";

function fillColorFor(point: CalibrationPoint): string {
  const rgb = point.team === 0 ? ALLY_TEAM_RGB : point.team === 1 ? ENEMY_TEAM_RGB : NEUTRAL_RGB;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.85)`;
}

function redraw() {
  const canvas = canvasEl.value;
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx, canvas.width, canvas.height);

  // Draw the scatter cloud first, then spawn anchors on top, so a spawn
  // point's gold ring is never occluded by an overlapping scatter point.
  const scatterPoints = props.points.filter((p) => p.kind !== "spawn");
  const spawnPoints = props.points.filter((p) => p.kind === "spawn");

  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(15, 23, 42, 0.6)";
  for (const point of scatterPoints) {
    const { pxX, pxY } = projectRawPoint(point, props.bounds, canvas.width, canvas.height);
    ctx.fillStyle = fillColorFor(point);
    ctx.beginPath();
    ctx.arc(pxX, pxY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = SPAWN_RING_RGB;
  for (const point of spawnPoints) {
    const { pxX, pxY } = projectRawPoint(point, props.bounds, canvas.width, canvas.height);
    ctx.fillStyle = fillColorFor(point);
    ctx.beginPath();
    ctx.arc(pxX, pxY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  drawCornerLabels(ctx, canvas.width, canvas.height);
}

watch([() => props.points, () => props.bounds], redraw, { deep: true });
useResizeObserver(wrapperEl, redraw);
</script>

<template>
  <div ref="wrapperEl" class="relative w-full overflow-hidden rounded-lg border border-border bg-background">
    <img
      ref="imgEl"
      :src="`/images/maps/original/${imageSlug}.jpg`"
      :alt="mapId"
      class="block w-full"
      @load="syncCanvasSize"
    />
    <canvas ref="canvasEl" class="pointer-events-none absolute inset-0 h-full w-full object-contain" />
  </div>
</template>
