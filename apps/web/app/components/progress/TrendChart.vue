<script setup lang="ts">
import type { TrendResponse } from "@hots-stats/shared-types";

const props = withDefaults(
  defineProps<{ trend?: TrendResponse | null; loading?: boolean; error?: boolean }>(),
  { trend: null, loading: false, error: false },
);

const themeColor = useChartThemeColor();

const points = computed(() => props.trend?.points ?? []);
const window = computed(() => props.trend?.window ?? 20);

const chartData = computed(() => ({
  labels: points.value.map((point) => "Partie " + point.index),
  datasets: [
    {
      label: "Winrate glissant",
      data: points.value.map((point) => (point.rollingWinrate === null ? null : point.rollingWinrate * 100)),
      borderColor: themeColor("--raw-primary"),
      backgroundColor: themeColor("--raw-primary"),
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHitRadius: 8,
      borderWidth: 2,
      tension: 0.15,
      spanGaps: false,
      fill: false,
    },
    {
      label: "50 %",
      data: points.value.map(() => 50),
      borderColor: themeColor("--raw-muted"),
      borderDash: [4, 4],
      borderWidth: 1,
      pointRadius: 0,
      pointHitRadius: 0,
      fill: false,
    },
  ],
}));

const chartOptions = computed(() => ({
  interaction: { mode: "index" as const, intersect: false },
  scales: {
    x: {
      grid: { color: themeColor("--raw-border") },
      ticks: { color: themeColor("--raw-muted"), maxTicksLimit: 10, maxRotation: 0 },
    },
    y: {
      min: 0,
      max: 100,
      grid: { color: themeColor("--raw-border") },
      ticks: { color: themeColor("--raw-muted"), callback: (value: number | string) => value + "%" },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: { filter: (item: { datasetIndex?: number }) => item.datasetIndex === 0 },
  },
}));

const lastRolling = computed(() => {
  for (let index = points.value.length - 1; index >= 0; index--) {
    const value = points.value[index]?.rollingWinrate ?? null;
    if (value !== null) return value;
  }
  return null;
});

const summary = computed(() => {
  if (points.value.length === 0) return "";
  if (lastRolling.value === null) {
    return (
      "Tendance sur " +
      points.value.length +
      " partie(s) — pas encore assez de recul pour un winrate glissant (fenêtre de " +
      window.value +
      " parties)."
    );
  }
  return (
    "Tendance sur " +
    points.value.length +
    " partie(s) — winrate glissant sur les " +
    window.value +
    " dernières : " +
    Math.round(lastRolling.value * 100) +
    " %."
  );
});

const versionChanges = computed(() => props.trend?.versionChanges ?? []);
const comparison = computed(() => props.trend?.comparison ?? []);
const isEmpty = computed(() => !props.loading && !props.error && points.value.length === 0);
</script>

<template>
  <UiPanel title="Tendance" :count="points.length">
    <UiStateCard v-if="loading" state="loading" size="sm" />
    <UiStateCard v-else-if="error" state="error" size="sm" message="Impossible de charger la tendance." />
    <UiStateCard
      v-else-if="isEmpty"
      state="empty"
      size="sm"
      message="Aucune partie pour cette période — la tendance apparaîtra après quelques games."
    />
    <div v-else class="space-y-3">
      <div class="h-64">
        <ChartsLineChart :data="chartData" :options="chartOptions" />
      </div>

      <!-- Text summary: accessibility + server-rendered fallback, always beside the chart. -->
      <p class="text-sm text-muted">{{ summary }}</p>

      <div v-if="versionChanges.length > 0">
        <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Changements de patch</p>
        <ul class="flex flex-wrap gap-2">
          <li
            v-for="change in versionChanges"
            :key="change.atIndex"
            class="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted"
          >
            Partie n°{{ change.atIndex }} · {{ change.gameVersion }}
          </li>
        </ul>
      </div>

      <div v-if="comparison.length > 0">
        <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Comparaison de périodes</p>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div
            v-for="period in comparison"
            :key="period.label"
            class="rounded-lg border border-border bg-background p-3 text-sm"
          >
            <p class="font-medium">{{ period.label }}</p>
            <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt class="text-muted">Parties</dt>
              <dd class="text-right font-mono">{{ period.stats.gamesPlayed }}</dd>
              <dt class="text-muted">Winrate</dt>
              <dd class="text-right font-mono">{{ formatPercent(period.stats.winrate) }}</dd>
              <dt class="text-muted">KDA</dt>
              <dd class="text-right font-mono">{{ formatKda(period.stats.kda) }}</dd>
              <dt class="text-muted">Morts / 10 min</dt>
              <dd class="text-right font-mono">{{ period.stats.deathsPer10Min.toFixed(2) }}</dd>
              <dt class="text-muted">XP / min</dt>
              <dd class="text-right font-mono">{{ period.stats.xpPerMinute.toFixed(2) }}</dd>
            </dl>
          </div>
        </div>
      </div>
    </div>
  </UiPanel>
</template>
