<script setup lang="ts">
import type { DashboardMapStats, DashboardPerformanceProfile, DashboardRoleStats } from "~/types/matches";

/**
 * Discreet, icon-only row that opens one of the 4 "Dashboard" chart
 * modals -- kept as its own component (rather than inlined in
 * `StatsDashboard`) so a page can drop in just the chart launchers without
 * the 4 KPI cards, if it ever needs to.
 */
defineProps<{
  filters: Record<string, unknown>;
  roles: DashboardRoleStats[];
  maps: DashboardMapStats[];
  performance?: DashboardPerformanceProfile;
}>();

type ChartKey = "trend" | "radar" | "roles" | "maps";
const openChart = ref<ChartKey | null>(null);

const buttons: { key: ChartKey; icon: string; label: string }[] = [
  { key: "trend", icon: "i-lucide-line-chart", label: "Évolution du winrate" },
  { key: "radar", icon: "i-lucide-radar", label: "Profil de performance" },
  { key: "roles", icon: "i-heroicons-chart-pie", label: "Temps de jeu par rôle" },
  { key: "maps", icon: "i-heroicons-chart-bar", label: "Victoires / défaites par carte" },
];

function setOpen(key: ChartKey, value: boolean) {
  openChart.value = value ? key : null;
}

const tabOptions = buttons.map((btn) => ({ value: btn.key, label: btn.label, icon: btn.icon }));
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <span class="text-xs font-medium uppercase tracking-wide text-muted">Graphiques</span>
    <UiPillTabs
      :model-value="openChart ?? ''"
      :options="tabOptions"
      icon-only
      @update:model-value="(value) => (openChart = (value || null) as ChartKey | null)"
    />

    <ChartsWinrateTrendModal
      :open="openChart === 'trend'"
      :filters="filters"
      @update:open="(value) => setOpen('trend', value)"
    />
    <ChartsPerformanceRadarModal
      :open="openChart === 'radar'"
      :performance="performance"
      @update:open="(value) => setOpen('radar', value)"
    />
    <ChartsRolePlaytimeModal :open="openChart === 'roles'" :roles="roles" @update:open="(value) => setOpen('roles', value)" />
    <ChartsMapResultsModal :open="openChart === 'maps'" :maps="maps" @update:open="(value) => setOpen('maps', value)" />
  </div>
</template>
