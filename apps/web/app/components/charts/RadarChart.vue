<script setup lang="ts">
/** Generic radar chart -- see `charts/LineChart.vue` for the wrapper convention. */
import { usePreferredReducedMotion } from "@vueuse/core";
import {
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  PointElement,
  RadarController,
  RadialLinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Radar } from "vue-chartjs";

ChartJS.register(RadialLinearScale, PointElement, LineElement, RadarController, Filler, Tooltip, Legend);

const props = withDefaults(defineProps<{ data: ChartData<"radar">; options?: ChartOptions<"radar"> }>(), { options: undefined });

const reducedMotion = usePreferredReducedMotion();
const chartOptions = computed(() =>
  withReducedMotion(
    { responsive: true, maintainAspectRatio: false, ...props.options },
    reducedMotion.value === "reduce",
  ),
);
</script>

<template>
  <Radar :data="data" :options="chartOptions" />
</template>
