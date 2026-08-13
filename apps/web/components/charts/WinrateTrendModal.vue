<script setup lang="ts">
import type { TooltipItem } from "chart.js";

const props = defineProps<{
  open: boolean;
  filters: Record<string, unknown>;
}>();
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

interface TrendPoint {
  playedAt: string;
  winner: boolean;
}

interface CumulativePoint {
  playedAt: string;
  gameNumber: number;
  winrate: number;
}

const points = ref<TrendPoint[]>([]);
const pending = ref(false);
const errored = ref(false);

async function loadTrend() {
  pending.value = true;
  errored.value = false;
  try {
    const config = useRuntimeConfig();
    const res = await $fetch<{ points: TrendPoint[] }>("/matches/trend", {
      baseURL: config.public.apiBase,
      credentials: "include",
      query: props.filters,
    });
    points.value = res.points;
  } catch {
    errored.value = true;
  } finally {
    pending.value = false;
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) loadTrend();
  },
);

// Filters can change while the modal stays open (the matches page's own
// filter bar sits above it) -- keep the chart in sync with them.
watch(
  () => props.filters,
  () => {
    if (props.open) loadTrend();
  },
  { deep: true },
);

const cumulative = computed<CumulativePoint[]>(() => {
  let wins = 0;
  return points.value.map((p, i) => {
    if (p.winner) wins++;
    return { playedAt: p.playedAt, gameNumber: i + 1, winrate: (wins / (i + 1)) * 100 };
  });
});

const themeColor = useChartThemeColor();

const chartData = computed(() => ({
  labels: cumulative.value.map((p) => formatDate(p.playedAt)),
  datasets: [
    {
      label: "Winrate cumulé",
      data: cumulative.value.map((p) => p.winrate),
      borderColor: themeColor("--color-primary"),
      backgroundColor: themeColor("--color-primary"),
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHitRadius: 8,
      borderWidth: 2,
      tension: 0.15,
      fill: false,
    },
    {
      // Flat 50% reference line, so a reader can tell "above/below even" at
      // a glance without reading axis ticks -- excluded from the tooltip
      // via `plugins.tooltip.filter` below.
      label: "50%",
      data: cumulative.value.map(() => 50),
      borderColor: themeColor("--color-muted"),
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
      grid: { color: themeColor("--color-border") },
      ticks: { color: themeColor("--color-muted"), maxTicksLimit: 8, maxRotation: 0 },
    },
    y: {
      min: 0,
      max: 100,
      grid: { color: themeColor("--color-border") },
      ticks: { color: themeColor("--color-muted"), callback: (value: number | string) => `${value}%` },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      filter: (item: TooltipItem<"line">) => item.datasetIndex === 0,
      callbacks: {
        label: (ctx: TooltipItem<"line">) => {
          const point = cumulative.value[ctx.dataIndex];
          if (!point) return "";
          return `Partie ${point.gameNumber} · ${point.winrate.toFixed(1)}% de victoires cumulées`;
        },
      },
    },
  },
}));
</script>

<template>
  <ChartsChartModal
    :model-value="open"
    title="Évolution du winrate"
    description="Winrate cumulé, partie après partie, pour les filtres actuellement appliqués."
    :pending="pending"
    :errored="errored"
    :empty="!pending && !errored && cumulative.length === 0"
    empty-text="Aucune partie pour ces filtres."
    @update:model-value="(value) => emit('update:open', value)"
  >
    <ChartsLineChart :data="chartData" :options="chartOptions" />
  </ChartsChartModal>
</template>
