<script setup lang="ts">
/** Generic doughnut chart -- see `charts/LineChart.vue` for the wrapper convention. */
import { ArcElement, Chart as ChartJS, Legend, Tooltip, type ChartData, type ChartOptions } from "chart.js";
import { Doughnut } from "vue-chartjs";

ChartJS.register(ArcElement, Tooltip, Legend);

withDefaults(defineProps<{ data: ChartData<"doughnut">; options?: ChartOptions<"doughnut"> }>(), {
  options: undefined,
});
</script>

<template>
  <Doughnut :data="data" :options="{ responsive: true, maintainAspectRatio: false, ...options }" />
</template>
