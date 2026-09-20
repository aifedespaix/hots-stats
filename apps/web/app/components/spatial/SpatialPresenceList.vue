<script setup lang="ts">
import type { CellPresenceLine } from "~/utils/heatmapCellDetails";
import { formatCellSeconds } from "~/utils/heatmapCellDetails";

/**
 * One line per tracked hero's time in a spot: color swatch, decorated name,
 * seconds and share of that layer's whole-map total. Extracted from
 * `HeatmapCellTooltip.vue` because the side panel shows the exact same list at
 * full length -- two copies would drift apart the moment one gains a field.
 */
defineProps<{
  presence: CellPresenceLine[];
  /** Sum of the listed lines' seconds, i.e. what the header reports. */
  totalSeconds: number;
  /** Lines dropped by the caller's cap ("+N autres"). */
  hidden: number;
}>();

function rgbCss(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
</script>

<template>
  <div class="space-y-0.5">
    <p class="font-medium text-foreground">Présence ici · {{ formatCellSeconds(totalSeconds) }}</p>
    <ul>
      <li v-for="line in presence" :key="line.label" class="flex items-center gap-1.5">
        <span class="h-2 w-2 shrink-0 rounded-full" :style="{ background: rgbCss(line.colorRgb) }" />
        <span class="truncate" :class="line.isMe ? 'font-semibold text-foreground' : 'text-muted'">{{ line.label }}</span>
        <span class="ml-auto shrink-0 font-mono text-muted">
          {{ formatCellSeconds(line.seconds) }} · {{ formatPercent(line.share) }}
        </span>
      </li>
      <li v-if="hidden > 0" class="text-muted">
        +{{ hidden }} autre{{ hidden > 1 ? "s" : "" }}
      </li>
    </ul>
  </div>
</template>
