<script setup lang="ts">
/** Generic bar chart -- see `charts/LineChart.vue` for the wrapper convention. */
import { usePreferredReducedMotion } from "@vueuse/core";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Bar } from "vue-chartjs";

ChartJS.register(CategoryScale, LinearScale, BarElement, BarController, Tooltip, Legend);

const props = withDefaults(defineProps<{ data: ChartData<"bar">; options?: ChartOptions<"bar"> }>(), { options: undefined });

const reducedMotion = usePreferredReducedMotion();
const chartOptions = computed(() =>
  withReducedMotion(
    { responsive: true, maintainAspectRatio: false, ...props.options },
    reducedMotion.value === "reduce",
  ),
);
</script>

<template>
  <Bar :data="data" :options="chartOptions" />
</template>
