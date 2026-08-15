<script setup lang="ts">
import type { TooltipItem } from "chart.js";
import type { DashboardRoleStats } from "~/types/matches";

const props = withDefaults(
  defineProps<{
    open: boolean;
    roles?: DashboardRoleStats[];
  }>(),
  { roles: () => [] },
);
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

const themeColor = useChartThemeColor();

const sortedRoles = computed(() =>
  [...props.roles].filter((role) => role.totalDurationSeconds > 0).sort((a, b) => b.totalDurationSeconds - a.totalDurationSeconds),
);

const chartData = computed(() => ({
  labels: sortedRoles.value.map((role) => formatHeroRole(role.role)),
  datasets: [
    {
      data: sortedRoles.value.map((role) => role.totalDurationSeconds),
      backgroundColor: sortedRoles.value.map((role) => heroRoleColor(role.role)),
      borderColor: themeColor("--raw-surface"),
      borderWidth: 2,
      hoverOffset: 6,
    },
  ],
}));

const chartOptions = computed(() => ({
  plugins: {
    legend: { position: "bottom" as const, labels: { color: themeColor("--raw-muted"), boxWidth: 10, padding: 12 } },
    tooltip: {
      callbacks: {
        label: (ctx: TooltipItem<"doughnut">) => {
          const role = sortedRoles.value[ctx.dataIndex];
          if (!role) return "";
          return `${formatHeroRole(role.role)} · ${formatTotalDuration(role.totalDurationSeconds)} (${role.gamesPlayed} partie${role.gamesPlayed > 1 ? "s" : ""})`;
        },
      },
    },
  },
}));
</script>

<template>
  <ChartsChartModal
    :model-value="open"
    title="Temps de jeu par rôle"
    description="Répartition de ton temps de jeu entre les rôles, pour les filtres actuellement appliqués."
    :empty="sortedRoles.length === 0"
    @update:model-value="(value) => emit('update:open', value)"
  >
    <ChartsDoughnutChart :data="chartData" :options="chartOptions" />
  </ChartsChartModal>
</template>
