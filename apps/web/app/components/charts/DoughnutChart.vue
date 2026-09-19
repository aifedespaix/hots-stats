<script setup lang="ts">
/** Generic doughnut chart -- see `charts/LineChart.vue` for the wrapper convention. */
import { usePreferredReducedMotion } from "@vueuse/core";
import { ArcElement, Chart as ChartJS, Legend, Tooltip, type ChartData, type ChartOptions } from "chart.js";
import { Doughnut } from "vue-chartjs";

ChartJS.register(ArcElement, Tooltip, Legend);

const props = withDefaults(defineProps<{ data: ChartData<"doughnut">; options?: ChartOptions<"doughnut"> }>(), {
  options: undefined,
});

const reducedMotion = usePreferredReducedMotion();
const chartOptions = computed(() =>
  withReducedMotion(
    { responsive: true, maintainAspectRatio: false, ...props.options },
    reducedMotion.value === "reduce",
  ),
);
</script>

<template>
  <Doughnut :data="data" :options="chartOptions" />
</template>
