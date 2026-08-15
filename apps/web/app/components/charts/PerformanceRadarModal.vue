<script setup lang="ts">
import type { TooltipItem } from "chart.js";
import type { DashboardPerformanceProfile } from "~/types/matches";

const props = defineProps<{
  open: boolean;
  performance?: DashboardPerformanceProfile;
}>();
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

const AXES = [
  { key: "damage", label: "Dégâts", unit: "dégâts/min" },
  { key: "healing", label: "Soins", unit: "soins/min" },
  { key: "xp", label: "XP", unit: "XP/min" },
  { key: "survival", label: "Survie", unit: "min de vie/mort" },
] as const;

const themeColor = useChartThemeColor();

const isEmpty = computed(() => !props.performance || props.performance.gamesPlayed === 0);

const chartData = computed(() => {
  const perf = props.performance;
  return {
    labels: AXES.map((axis) => axis.label),
    datasets: [
      {
        label: "Profil de performance",
        data: AXES.map((axis) => perf?.[axis.key].normalized ?? 0),
        borderColor: themeColor("--raw-primary"),
        backgroundColor: themeColor("--raw-primary", 0.25),
        pointBackgroundColor: themeColor("--raw-primary"),
        pointRadius: 3,
        borderWidth: 2,
      },
    ],
  };
});

const chartOptions = computed(() => ({
  scales: {
    r: {
      min: 0,
      max: 100,
      ticks: { display: false, stepSize: 25 },
      grid: { color: themeColor("--raw-border") },
      angleLines: { color: themeColor("--raw-border") },
      pointLabels: { color: themeColor("--raw-foreground"), font: { size: 12 } },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: TooltipItem<"radar">) => {
          const axis = AXES[ctx.dataIndex];
          const value = axis ? props.performance?.[axis.key].value : undefined;
          if (!axis || value === undefined) return "";
          return `${value.toFixed(0)} ${axis.unit}`;
        },
      },
    },
  },
}));
</script>

<template>
  <ChartsChartModal
    :model-value="open"
    title="Profil de performance"
    description="Dégâts, soins, contribution XP et survie par partie, comparés à ta propre fourchette historique."
    :empty="isEmpty"
    empty-text="Pas encore assez de parties pour ces filtres."
    @update:model-value="(value) => emit('update:open', value)"
  >
    <ChartsRadarChart :data="chartData" :options="chartOptions" />
  </ChartsChartModal>
</template>
