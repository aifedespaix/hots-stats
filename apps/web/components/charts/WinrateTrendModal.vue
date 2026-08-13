<script setup lang="ts">
import type { WinrateTrendPoint } from "~/composables/useWinrateTrend";

const props = defineProps<{
  open: boolean;
  filters: Record<string, unknown>;
}>();
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

const points = ref<WinrateTrendPoint[]>([]);
const pending = ref(false);
const errored = ref(false);

async function loadTrend() {
  pending.value = true;
  errored.value = false;
  try {
    const config = useRuntimeConfig();
    const res = await $fetch<{ points: WinrateTrendPoint[] }>("/matches/trend", {
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

const { cumulative, chartData, chartOptions } = useWinrateTrendChart(points);
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
