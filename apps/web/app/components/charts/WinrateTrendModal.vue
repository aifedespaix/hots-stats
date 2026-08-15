<script setup lang="ts">
const props = defineProps<{
  open: boolean;
  filters: Record<string, unknown>;
}>();
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

const query = computed(() => props.filters);
const isOpen = computed(() => props.open);
const { points, pending, errored } = useWinrateTrend(query, isOpen);

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
