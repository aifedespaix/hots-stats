<script setup lang="ts">
import type { DashboardMapStats } from "~/types/matches";

const props = withDefaults(
  defineProps<{
    open: boolean;
    maps?: DashboardMapStats[];
  }>(),
  { maps: () => [] },
);
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

// Top 6 by sample size -- a full list of every map ever played would cram
// too many bars to stay readable, especially on mobile.
const MAX_MAPS = 6;

const themeColor = useChartThemeColor();

const topMaps = computed(() => [...props.maps].sort((a, b) => b.gamesPlayed - a.gamesPlayed).slice(0, MAX_MAPS));

const chartData = computed(() => ({
  labels: topMaps.value.map((map) => map.mapName),
  datasets: [
    {
      label: "Victoires",
      data: topMaps.value.map((map) => map.wins),
      backgroundColor: themeColor("--color-success", 0.75),
      borderRadius: 4,
    },
    {
      label: "Défaites",
      data: topMaps.value.map((map) => map.gamesPlayed - map.wins),
      backgroundColor: themeColor("--color-danger", 0.75),
      borderRadius: 4,
    },
  ],
}));

/** Long map names ("Tomb of the Spider Queen") don't fit as flat x-axis ticks even at an angle -- truncate rather than let chart.js overlap or hide them. */
function truncateLabel(label: string, maxLength = 14): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
}

const chartOptions = computed(() => ({
  scales: {
    x: {
      stacked: true,
      grid: { display: false },
      ticks: {
        color: themeColor("--color-muted"),
        minRotation: 30,
        maxRotation: 45,
        font: { size: 10 },
        callback(this: unknown, value: number | string) {
          const label = topMaps.value[Number(value)]?.mapName;
          return label ? truncateLabel(label) : value;
        },
      },
    },
    y: {
      stacked: true,
      beginAtZero: true,
      ticks: { color: themeColor("--color-muted"), precision: 0 },
      grid: { color: themeColor("--color-border") },
    },
  },
  plugins: {
    legend: { position: "bottom" as const, labels: { color: themeColor("--color-muted"), boxWidth: 10, padding: 12 } },
  },
}));
</script>

<template>
  <ChartsChartModal
    :model-value="open"
    title="Victoires / défaites par carte"
    description="Répartition des résultats sur tes cartes les plus jouées, pour les filtres actuellement appliqués."
    :empty="topMaps.length === 0"
    @update:model-value="(value) => emit('update:open', value)"
  >
    <ChartsBarChart :data="chartData" :options="chartOptions" />
  </ChartsChartModal>
</template>
