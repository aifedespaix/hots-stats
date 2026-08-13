<script setup lang="ts">
/** Generic radar chart -- see `charts/LineChart.vue` for the wrapper convention. */
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

withDefaults(defineProps<{ data: ChartData<"radar">; options?: ChartOptions<"radar"> }>(), { options: undefined });
</script>

<template>
  <Radar :data="data" :options="{ responsive: true, maintainAspectRatio: false, ...options }" />
</template>
