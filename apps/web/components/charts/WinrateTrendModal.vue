<script setup lang="ts">
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type TooltipItem,
} from "chart.js";
import { Line } from "vue-chartjs";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, Tooltip, Filler);

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

/** Reads a design token (e.g. "--color-primary") as an `oklch()` color string. */
function themeColor(cssVar: string): string {
  if (import.meta.server) return "transparent";
  return `oklch(${getComputedStyle(document.documentElement).getPropertyValue(cssVar)} / 1)`;
}

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
  responsive: true,
  maintainAspectRatio: false,
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
  <UModal :model-value="open" @update:model-value="(value) => emit('update:open', value)">
    <div class="p-6">
      <h2 class="font-heading text-lg font-semibold">Évolution du winrate</h2>
      <p class="mt-1 text-sm text-muted">Winrate cumulé, partie après partie, pour les filtres actuellement appliqués.</p>

      <div class="mt-4 h-72">
        <p v-if="pending" class="flex h-full items-center justify-center text-sm text-muted">Chargement…</p>
        <p v-else-if="errored" class="flex h-full items-center justify-center text-sm text-danger">
          Impossible de charger le graphique.
        </p>
        <p v-else-if="cumulative.length === 0" class="flex h-full items-center justify-center text-sm text-muted">
          Aucune partie pour ces filtres.
        </p>
        <Line v-else :data="chartData" :options="chartOptions" />
      </div>
    </div>
  </UModal>
</template>
