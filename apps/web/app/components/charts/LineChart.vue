<script setup lang="ts">
/**
 * Generic line chart -- a thin, presentation-only wrapper around
 * vue-chartjs. Takes fully-formed chart.js `data`/`options` so it stays
 * reusable for any line chart (theme colors, tooltip callbacks, etc. are the
 * caller's responsibility -- see `charts/WinrateTrendModal.vue`).
 */
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Line } from "vue-chartjs";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, Tooltip, Filler);

withDefaults(defineProps<{ data: ChartData<"line">; options?: ChartOptions<"line"> }>(), { options: undefined });
</script>

<template>
  <Line :data="data" :options="{ responsive: true, maintainAspectRatio: false, ...options }" />
</template>
