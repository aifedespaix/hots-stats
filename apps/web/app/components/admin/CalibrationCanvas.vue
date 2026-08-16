<script setup lang="ts">
import { useResizeObserver } from "@vueuse/core";
import type { MapBoundsInput } from "~/utils/mapProjection";

const props = defineProps<{
  mapId: string;
  points: { x: number; y: number }[];
  bounds: MapBoundsInput;
}>();

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

function redraw() {
  const canvas = canvasEl.value;
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(239, 68, 68, 0.75)"; // matches the app's --color-danger family, kept literal (canvas can't read CSS custom properties)
  for (const point of props.points) {
    const { pxX, pxY } = projectRawPoint(point, props.bounds, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.arc(pxX, pxY, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

watch([() => props.points, () => props.bounds], redraw, { deep: true });
useResizeObserver(wrapperEl, redraw);
</script>

<template>
  <div ref="wrapperEl" class="relative w-full overflow-hidden rounded-lg border border-border bg-background">
    <img
      ref="imgEl"
      :src="`/images/maps/original/${mapId}.jpg`"
      :alt="mapId"
      class="block w-full"
      @load="syncCanvasSize"
    />
    <canvas ref="canvasEl" class="pointer-events-none absolute inset-0 h-full w-full object-contain" />
  </div>
</template>
