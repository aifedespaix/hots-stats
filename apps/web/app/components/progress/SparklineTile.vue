<script setup lang="ts">
import { DEFAULT_TREND_WINDOW, type TrendResponse } from "@hots-stats/shared-types";

const props = withDefaults(
  defineProps<{ trend?: TrendResponse | null; loading?: boolean; error?: boolean }>(),
  { trend: null, loading: false, error: false },
);

const WIDTH = 104;
const HEIGHT = 36;

const window = computed(() => props.trend?.window ?? DEFAULT_TREND_WINDOW);
const values = computed(() => (props.trend?.points ?? []).map((point) => point.rollingWinrate));
const sparkline = computed(() => buildWinrateSparkline(values.value, WIDTH, HEIGHT));

const last = computed(() => {
  for (let index = values.value.length - 1; index >= 0; index--) {
    const value = values.value[index] ?? null;
    if (value !== null) return value;
  }
  return null;
});

const hasLine = computed(() => sparkline.value.segments.length > 0);
const showEmpty = computed(() => !props.loading && !props.error && !hasLine.value);
</script>

<template>
  <div class="rounded-lg border p-3 sm:p-4" :class="TONE_TILE_CLASS.default">
    <p class="text-xs uppercase tracking-wide text-muted">Winrate glissant</p>

    <UiSkeletonBlock v-if="loading && !hasLine" class="mt-2 h-9 rounded" />
    <UiStateCard v-else-if="error" state="error" size="sm" message="Tendance indisponible." />
    <p v-else-if="showEmpty" class="mt-2 text-sm text-muted">
      Fenêtre de {{ window }} parties non atteinte.
    </p>

    <div v-else class="mt-1 flex items-end justify-between gap-2">
      <span class="font-mono text-lg font-semibold sm:text-2xl" :class="TONE_TEXT_CLASS[winrateTone(last)]">
        {{ last === null ? "—" : formatPercent(last) }}
      </span>
      <svg
        :viewBox="'0 0 ' + WIDTH + ' ' + HEIGHT"
        class="h-9 w-24 shrink-0"
        role="img"
        :aria-label="'Winrate glissant sur les ' + window + ' dernières parties'"
      >
        <line
          x1="2"
          :y1="HEIGHT / 2"
          :x2="WIDTH - 2"
          :y2="HEIGHT / 2"
          class="text-border"
          stroke="currentColor"
          stroke-width="1"
          stroke-dasharray="2 2"
        />
        <polyline
          v-for="(segment, index) in sparkline.segments"
          :key="index"
          :points="segment"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          :class="TONE_TEXT_CLASS[winrateTone(last)]"
        />
        <circle
          v-if="sparkline.last"
          :cx="sparkline.last.x"
          :cy="sparkline.last.y"
          r="2.5"
          fill="currentColor"
          :class="TONE_TEXT_CLASS[winrateTone(last)]"
        />
      </svg>
    </div>

    <p v-if="!showEmpty && !error" class="mt-1 text-xs text-muted">
      Sur les {{ window }} dernières parties
    </p>
  </div>
</template>
