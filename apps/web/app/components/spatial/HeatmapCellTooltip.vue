<script setup lang="ts">
import type { HeatmapCellDetail } from "~/utils/heatmapCellDetails";
import { formatCellSeconds, formatClock } from "~/utils/heatmapCellDetails";

/**
 * The per-cell panel every spatial heatmap shows on hover -- "written" stats
 * for one grid cell: how long each tracked hero stood there, and (for a match
 * view) who killed whom, with the viewer's own hero always spelled out as
 * "Toi (Héros)" so it can never be mistaken for a teammate.
 *
 * Purely presentational and `pointer-events-none`: the parent owns the hover
 * state and cell lookup (see `SpatialHeatmapView.vue`), so this stays free of
 * DOM events and reusable by any canvas.
 */
const props = defineProps<{
  detail: HeatmapCellDetail;
  /** Cursor position in px, relative to the map container this panel is rendered in. */
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
  /** Matches behind an aggregate ("Historique") view, shown as context. */
  matchCount?: number;
}>();

/**
 * Flips to the other side of the cursor once it passes the container's middle,
 * instead of measuring the panel: a fixed-size flip can't jitter, and every
 * panel is small relative to its map, so "place it on the emptier half" is
 * enough to keep it inside a container that is `overflow-hidden` (the map's
 * rounded corners need that clip).
 */
const panelStyle = computed(() => {
  const placeLeft = props.x > props.containerWidth / 2;
  const placeAbove = props.y > props.containerHeight / 2;
  return {
    left: `${props.x}px`,
    top: `${props.y}px`,
    transform: `translate(${placeLeft ? "calc(-100% - 12px)" : "12px"}, ${placeAbove ? "calc(-100% - 12px)" : "12px"})`,
  };
});

const killsShareLabel = computed(() => shareLabel(props.detail.killsShare));
const deathsShareLabel = computed(() => shareLabel(props.detail.deathsShare));

function shareLabel(share: number | null): string | null {
  if (share === null) return null;
  if (share > 0 && share < 0.01) return "<1%";
  return formatPercent(share);
}

function rgbCss(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count > 1 ? "s" : ""}`;
}
</script>

<template>
  <div
    class="pointer-events-none absolute z-30 w-60 rounded-md border border-border bg-surface/95 p-2 text-[11px] leading-snug shadow-lg backdrop-blur-sm"
    :style="panelStyle"
  >
    <div v-if="detail.presence.length > 0" class="space-y-0.5">
      <p class="font-medium text-foreground">Présence ici · {{ formatCellSeconds(detail.totalSeconds) }}</p>
      <ul>
        <li v-for="line in detail.presence" :key="line.label" class="flex items-center gap-1.5">
          <span class="h-2 w-2 shrink-0 rounded-full" :style="{ background: rgbCss(line.colorRgb) }" />
          <span class="truncate" :class="line.isMe ? 'font-semibold text-foreground' : 'text-muted'">{{ line.label }}</span>
          <span class="ml-auto shrink-0 font-mono text-muted">
            {{ formatCellSeconds(line.seconds) }} · {{ formatPercent(line.share) }}
          </span>
        </li>
        <li v-if="detail.presenceHidden > 0" class="text-muted">
          +{{ detail.presenceHidden }} autre{{ detail.presenceHidden > 1 ? "s" : "" }}
        </li>
      </ul>
    </div>

    <div
      v-if="detail.events.length > 0 || detail.kills > 0 || detail.deaths > 0"
      class="space-y-0.5 border-t border-border pt-1.5"
      :class="detail.presence.length > 0 ? 'mt-1.5' : ''"
    >
      <p class="text-muted">
        <!-- A side is dropped only when it is *both* zero here and absent from
             the whole view (a death map has no kills at all) -- otherwise "0
             kill (0%)" is a real answer about this cell. -->
        <template v-if="detail.kills > 0 || killsShareLabel">
          <span :class="detail.kills > 0 ? 'font-medium text-foreground' : ''">{{ plural(detail.kills, "kill") }}</span>
          <span v-if="killsShareLabel"> ({{ killsShareLabel }})</span>
        </template>
        <span v-if="(detail.kills > 0 || killsShareLabel) && (detail.deaths > 0 || deathsShareLabel)"> · </span>
        <template v-if="detail.deaths > 0 || deathsShareLabel">
          <span :class="detail.deaths > 0 ? 'font-medium text-foreground' : ''">{{ plural(detail.deaths, "mort") }}</span>
          <span v-if="deathsShareLabel"> ({{ deathsShareLabel }})</span>
        </template>
      </p>
      <ul>
        <li
          v-for="(event, i) in detail.events"
          :key="i"
          :class="event.isMe ? 'font-semibold text-foreground' : 'text-muted'"
        >
          <span class="font-mono">{{ formatClock(event.atSeconds) }}</span> {{ event.text }}
        </li>
        <li v-if="detail.eventsHidden > 0" class="text-muted">
          +{{ detail.eventsHidden }} autre{{ detail.eventsHidden > 1 ? "s" : "" }}
        </li>
      </ul>
    </div>

    <p v-if="matchCount && matchCount > 0" class="mt-1 text-muted">
      Sur {{ plural(matchCount, "partie") }}
    </p>
  </div>
</template>
