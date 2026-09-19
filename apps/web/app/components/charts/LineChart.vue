<script setup lang="ts">
/**
 * Generic line chart -- a thin, presentation-only wrapper around
 * vue-chartjs. Takes fully-formed chart.js `data`/`options` so it stays
 * reusable for any line chart (theme colors, tooltip callbacks, etc. are the
 * caller's responsibility -- see `charts/WinrateTrendModal.vue`).
 */
import { usePreferredReducedMotion } from "@vueuse/core";
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

const props = withDefaults(defineProps<{ data: ChartData<"line">; options?: ChartOptions<"line"> }>(), { options: undefined });

const reducedMotion = usePreferredReducedMotion();
const chartOptions = computed(() =>
  withReducedMotion(
    { responsive: true, maintainAspectRatio: false, ...props.options },
    reducedMotion.value === "reduce",
  ),
);
</script>

<template>
  <Line :data="data" :options="chartOptions" />
</template>
