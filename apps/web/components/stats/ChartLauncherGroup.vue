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
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <span class="text-xs font-medium uppercase tracking-wide text-muted">Graphiques</span>
    <div class="flex items-center gap-1 rounded-full border border-border bg-surface p-1 shadow-sm">
      <UTooltip v-for="btn in buttons" :key="btn.key" :text="btn.label" :popper="{ placement: 'top' }">
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-all duration-150 hover:scale-110 hover:bg-brand/15 hover:text-brand active:scale-95"
          :aria-label="btn.label"
          @click="openChart = btn.key"
        >
          <UIcon :name="btn.icon" class="h-4 w-4" />
        </button>
      </UTooltip>
    </div>

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
