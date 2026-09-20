<script setup lang="ts">
import { isClusterHighlighted, type SpatialEventCluster } from "~/utils/deathClustering";
import { DEATH_MARKER_RGB, KILL_MARKER_RGB } from "~/utils/spatialColors";

/**
 * Discrete kill/death markers for a "Cette partie" Slot -- SVG rather than
 * the Canvas density layers `SpatialCanvasLayer.vue` renders, per
 * tasks/epic-10-analyse-spatiale.md Livrable 2 ("marqueurs kills/morts ->
 * SVG"). Each `SpatialEventCluster` (see `deathClustering.ts`) renders one
 * shape; a cluster with more than one member gets a "+N" badge instead of
 * drawing every member on top of each other.
 */
const props = withDefaults(
  defineProps<{
    clusters: SpatialEventCluster[];
    /** `naturalWidth / naturalHeight` of the map image -- most HotS maps aren't square, so drawing a marker's own geometry directly in the (non-uniformly stretched, see below) viewBox would distort it into an ellipse/rhombus. Each marker's `<g>` counter-scales its local Y axis by this ratio so its shape stays visually undistorted regardless of the map's aspect ratio. */
    aspectRatio?: number;
    /** Timeline scrub position, in seconds; clusters within the clustering window of it are emphasised. Null = nothing highlighted. */
    highlightAtSeconds?: number | null;
    /** The cluster under the cursor or opened in the recap panel -- drawn at
     * full opacity with its ring, so the marker the tooltip describes is never
     * one of the faded ones. */
    focusedCluster?: SpatialEventCluster | null;
  }>(),
  { aspectRatio: 1, highlightAtSeconds: null, focusedCluster: null },
);

const emit = defineEmits<{
  "select-cluster": [cluster: SpatialEventCluster];
  "hover-cluster": [cluster: SpatialEventCluster];
  "leave-cluster": [];
}>();

/** Markers away from the chronology scrubber stay clearly readable: a teamfight
 * used to fade to a quarter opacity, which made the whole map look empty while
 * scrubbing. */
const DIMMED_OPACITY = 0.7;

function opacityFor(cluster: SpatialEventCluster): number {
  if (cluster === props.focusedCluster) return 1;
  if (props.highlightAtSeconds === null || isClusterHighlighted(cluster, props.highlightAtSeconds)) return 1;
  return DIMMED_OPACITY;
}

function toSvgY(y: number): number {
  // Same Y inversion as SpatialCanvasLayer.vue/mapProjection.ts: row 0 = world-Y-min = bottom of the map.
  return 1 - y;
}

function colorFor(kind: SpatialEventCluster["kind"]): string {
  const [r, g, b] = kind === "kill" ? KILL_MARKER_RGB : DEATH_MARKER_RGB;
  return `rgb(${r}, ${g}, ${b})`;
}
</script>

<template>
  <!-- `preserveAspectRatio="none"`: this container always matches the map
       image's own aspect ratio exactly (no independent letterboxing box),
       so a uniform-fit viewBox would misplace every marker -- x/y are
       normalized independently per axis against the map's actual
       width/height (same convention as heatmapRenderer.ts's
       `toCanvasPixel`), not against a square. That non-uniform stretch is
       exactly what each marker's own `scale(1, aspectRatio)` below
       counteracts for its shape geometry. -->
  <svg class="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
    <g
      v-for="(cluster, i) in props.clusters"
      :key="i"
      class="pointer-events-auto cursor-pointer"
      :transform="'translate(' + cluster.x + ' ' + toSvgY(cluster.y) + ') scale(1 ' + aspectRatio + ')'"
      :opacity="opacityFor(cluster)"
      @click.stop="emit('select-cluster', cluster)"
      @pointerenter="emit('hover-cluster', cluster)"
      @pointerleave="emit('leave-cluster')"
    >
      <!-- Ring on the cluster the chronology scrubber is over, and on the one the
           cursor or the recap panel is focused on, so the marker being described
           is always identifiable. -->
      <circle
        v-if="isClusterHighlighted(cluster, highlightAtSeconds) || cluster === focusedCluster"
        cx="0"
        cy="0"
        r="0.021"
        fill="none"
        stroke="white"
        stroke-width="0.004"
        vector-effect="non-scaling-stroke"
      />
      <!-- Kills: triangle. Deaths: diamond. Shape carries the kind so color alone isn't the only signal (accessibility). Coordinates below are local to this marker's own (undistorted) frame. -->
      <polygon
        v-if="cluster.kind === 'kill'"
        points="0,-0.010 -0.009,0.006 0.009,0.006"
        :fill="colorFor(cluster.kind)"
        stroke="rgba(0,0,0,0.6)"
        stroke-width="0.002"
        vector-effect="non-scaling-stroke"
      />
      <rect
        v-else
        x="-0.008"
        y="-0.008"
        width="0.016"
        height="0.016"
        transform="rotate(45)"
        :fill="colorFor(cluster.kind)"
        stroke="rgba(0,0,0,0.6)"
        stroke-width="0.002"
        vector-effect="non-scaling-stroke"
      />
      <g v-if="cluster.points.length > 1" :transform="`translate(0.013 -0.013) scale(1 ${1 / aspectRatio})`">
        <circle cx="0" cy="0" r="0.009" fill="rgba(0,0,0,0.85)" />
        <text x="0" y="0" font-size="0.011" fill="white" text-anchor="middle" dominant-baseline="central">
          +{{ cluster.points.length }}
        </text>
      </g>
    </g>
  </svg>
</template>
