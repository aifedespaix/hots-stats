<script setup lang="ts">
import type { FaceAFaceRoleDistributionEntry } from "@hots-stats/shared-types";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type TooltipItem,
} from "chart.js";
import { Bar } from "vue-chartjs";

ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const props = defineProps<{
  me: FaceAFaceRoleDistributionEntry[];
  friend: FaceAFaceRoleDistributionEntry[];
  meName: string;
  friendName: string;
}>();

const { themeColor } = useThemeColor();

interface MergedRole {
  role: string | null;
  label: string;
  myPct: number;
  friendPct: number;
}

// The two role-distribution arrays are independently grouped by the backend
// -- different lengths/order, a role either side never played simply isn't a
// row -- so this must merge by role key (union), not zip by index.
const merged = computed<MergedRole[]>(() => {
  const roles = new Set<string | null>([...props.me.map((r) => r.role), ...props.friend.map((r) => r.role)]);
  return [...roles]
    .map((role) => ({
      role,
      label: formatHeroRole(role),
      myPct: (props.me.find((r) => r.role === role)?.percentage ?? 0) * 100,
      friendPct: (props.friend.find((r) => r.role === role)?.percentage ?? 0) * 100,
    }))
    .sort((a, b) => Math.max(b.myPct, b.friendPct) - Math.max(a.myPct, a.friendPct));
});

const hasData = computed(() => merged.value.length > 0);

// Forced symmetric so equal bar length always means equal % on both sides --
// letting Chart.js auto-scale each side independently would break that.
const axisMax = computed(() => {
  const max = Math.max(1, ...merged.value.flatMap((r) => [r.myPct, r.friendPct]));
  return Math.ceil(max / 10) * 10;
});

const chartData = computed(() => ({
  labels: merged.value.map((r) => r.label),
  datasets: [
    {
      label: props.meName,
      data: merged.value.map((r) => -r.myPct),
      backgroundColor: themeColor("--color-primary"),
      borderRadius: 4,
    },
    {
      label: props.friendName,
      data: merged.value.map((r) => r.friendPct),
      backgroundColor: themeColor("--color-accent"),
      borderRadius: 4,
    },
  ],
}));

const chartOptions = computed(() => ({
  indexAxis: "y" as const,
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      min: -axisMax.value,
      max: axisMax.value,
      grid: { color: themeColor("--color-border") },
      ticks: {
        color: themeColor("--color-muted"),
        callback: (value: number | string) => `${Math.abs(Number(value))}%`,
      },
    },
    y: {
      grid: { display: false },
      ticks: { color: themeColor("--color-foreground") },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: TooltipItem<"bar">) => `${ctx.dataset.label} : ${Math.abs(ctx.parsed.x ?? 0).toFixed(0)}%`,
      },
    },
  },
}));
</script>

<template>
  <div class="rounded-lg border border-border bg-surface p-4">
    <div class="mb-3 flex items-center justify-between text-xs font-medium">
      <span class="text-brand">{{ meName }}</span>
      <span class="text-accent">{{ friendName }}</span>
    </div>
    <div class="relative" :style="{ height: `${Math.max(200, merged.length * 48)}px` }">
      <p v-if="!hasData" class="flex h-full items-center justify-center text-sm text-muted">
        Aucune partie à comparer.
      </p>
      <Bar v-else :data="chartData" :options="chartOptions" />
    </div>
  </div>
</template>
