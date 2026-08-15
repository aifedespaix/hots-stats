<script setup lang="ts">
/** Generic bar chart -- see `charts/LineChart.vue` for the wrapper convention. */
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

withDefaults(defineProps<{ data: ChartData<"bar">; options?: ChartOptions<"bar"> }>(), { options: undefined });
</script>

<template>
  <Bar :data="data" :options="{ responsive: true, maintainAspectRatio: false, ...options }" />
</template>
