<script setup lang="ts">
import { DRAFT_MIN_RANKED_GAMES_FOR_RANKING, DRAFT_RANKED_MODES } from "@hots-stats/shared-types";
import type { WeaknessesResponse } from "~/types/weaknesses";
import type { WeaknessTrend } from "~/utils/weaknesses";

definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Diagnostic",
  description:
    "Tes points faibles en un coup d'œil : winrate par carte, matchups défavorables et talents sous-performants sur tes parties classées.",
  ogTitle: "Diagnostic - HotS Analytics",
  ogDescription:
    "Tes points faibles en un coup d'œil : winrate par carte, matchups défavorables et talents sous-performants sur tes parties classées.",
  ogImage: "/og/analysis-index.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/analysis-index.png",
  robots: "noindex, follow",
});

interface TrendPoint {
  playedAt: string;
  winner: boolean;
}

// How many of the most recent ranked games count as "recent form", vs the
// all-time ranked win rate as the baseline -- same idea as the trend chart
// on /matches, just condensed into a single before/after comparison.
const RECENT_TREND_WINDOW = 20;

const { data: weaknesses } = await useApiFetch<WeaknessesResponse>("/weaknesses");
const { data: trendData } = await useApiFetch<{ points: TrendPoint[] }>("/matches/trend", {
  query: { mode: DRAFT_RANKED_MODES.join(",") },
});

const trend = computed<WeaknessTrend | undefined>(() => {
  const points = trendData.value?.points ?? [];
  if (points.length === 0) return undefined;

  const recent = points.slice(-RECENT_TREND_WINDOW);
  const wins = points.filter((p) => p.winner).length;
  const recentWins = recent.filter((p) => p.winner).length;

  return {
    allTimeWinrate: wins / points.length,
    recentWinrate: recentWins / recent.length,
    recentGames: recent.length,
  };
});

const totalRankedGames = computed(() => (weaknesses.value?.maps ?? []).reduce((sum, m) => sum + m.gamesPlayed, 0));

const topLeaks = computed(() => (weaknesses.value ? getTopWeaknesses(weaknesses.value, { trend: trend.value }) : []));
const topStrengths = computed(() =>
  weaknesses.value ? getTopStrengths(weaknesses.value, { trend: trend.value }) : [],
);

function sortRows<T, K extends keyof T>(rows: T[], key: K, dir: "asc" | "desc"): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * sign;
    return ((av as number) - (bv as number)) * sign;
  });
}

// --- Winrate par carte: searchable + sortable, worst winrate first by default ---
type MapSortKey = "mapName" | "gamesPlayed" | "winrate";
const mapsSearch = ref("");
const { sortKey: mapsSortKey, sortDir: mapsSortDir, onSort: onMapsSort } = useSortState<MapSortKey>("winrate", "asc");

const filteredMaps = computed(() => {
  const term = mapsSearch.value.trim().toLowerCase();
  const rows = (weaknesses.value?.maps ?? []).filter((m) => (term ? m.mapName.toLowerCase().includes(term) : true));
  return sortRows(rows, mapsSortKey.value, mapsSortDir.value);
});

const mapColumns = [
  { key: "mapName", label: "Carte", sortable: true },
  { key: "gamesPlayed", label: "Parties", numeric: true, sortable: true },
  { key: "winrate", label: "Winrate", numeric: true, sortable: true },
];

// --- Matchups: searchable + sortable, worst winrate first by default ---
type MatchupSortKey = "heroName" | "gamesPlayed" | "winrate";
const matchupsSearch = ref("");
const {
  sortKey: matchupsSortKey,
  sortDir: matchupsSortDir,
  onSort: onMatchupsSort,
} = useSortState<MatchupSortKey>("winrate", "asc");

const filteredMatchups = computed(() => {
  const term = matchupsSearch.value.trim().toLowerCase();
  const rows = (weaknesses.value?.matchups ?? []).filter((m) =>
    term ? m.heroName.toLowerCase().includes(term) : true,
  );
  return sortRows(rows, matchupsSortKey.value, matchupsSortDir.value);
});

const matchupColumns = [
  { key: "heroName", label: "Héros adverse", sortable: true },
  { key: "gamesPlayed", label: "Parties", numeric: true, sortable: true },
  { key: "winrate", label: "Winrate", numeric: true, sortable: true },
];

// --- Talents sous-performants: searchable + sortable, API order (worst habit first) by default ---
type TalentSortKey = "default" | "heroName" | "tier" | "talentName" | "talentWinrate" | "heroWinrate";
const talentsSearch = ref("");
const {
  sortKey: talentsSortKey,
  sortDir: talentsSortDir,
  onSort: onTalentsSort,
} = useSortState<TalentSortKey>("default", "desc");

const filteredTalents = computed(() => {
  const term = talentsSearch.value.trim().toLowerCase();
  const rows = (weaknesses.value?.talents ?? []).filter((t) => {
    if (!term) return true;
    return t.heroName.toLowerCase().includes(term) || formatTalentName(t.talentName, t.heroName).toLowerCase().includes(term);
  });
  const key = talentsSortKey.value;
  return key === "default" ? rows : sortRows(rows, key, talentsSortDir.value);
});

const talentColumns = [
  { key: "heroName", label: "Héros", sortable: true },
  { key: "tier", label: "Palier", numeric: true, sortable: true },
  { key: "talentName", label: "Talent", sortable: true },
  { key: "talentWinrate", label: "Ta winrate", numeric: true, sortable: true },
  { key: "heroWinrate", label: "Moyenne héros", numeric: true, sortable: true },
];
</script>

<template>
  <div class="flex flex-col gap-4">
    <div>
      <h1 class="font-heading text-2xl font-semibold">Diagnostic</h1>
      <p class="mt-1 text-sm text-muted">
        Basé uniquement sur tes parties classées ({{ totalRankedGames }} au total) -- au moins
        {{ DRAFT_MIN_RANKED_GAMES_FOR_RANKING }} parties sont nécessaires avant qu'une carte ou un matchup soit
        retenu comme point faible ou fort.
      </p>
    </div>

    <!-- Points faibles / points forts: kept compact and side by side on wide screens so the
    synthesis doesn't push the browsable tables below the fold. -->
    <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div v-if="topLeaks.length > 0" class="rounded-lg border border-danger/30 bg-danger/5 p-3 sm:p-4">
        <h2 class="mb-2 flex items-center gap-1.5 font-heading text-sm font-semibold">
          <UIcon name="i-heroicons-exclamation-triangle" class="h-4 w-4 text-danger" />
          Points faibles
        </h2>
        <ol class="space-y-2">
          <li v-for="(leak, index) in topLeaks" :key="leak.key" class="flex items-start gap-2">
            <span
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger/15 text-[11px] font-semibold text-danger"
            >
              {{ index + 1 }}
            </span>
            <div class="min-w-0">
              <p class="text-sm font-medium leading-tight">{{ leak.label }}</p>
              <p class="text-xs leading-tight text-muted">{{ leak.detail }}</p>
            </div>
          </li>
        </ol>
      </div>
      <div
        v-else
        class="flex items-center justify-center rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted"
      >
        <p v-if="totalRankedGames === 0">
          Pas encore de parties classées enregistrées -- reviens ici après quelques games.
        </p>
        <p v-else>Aucun point faible marquant sur tes {{ totalRankedGames }} parties classées.</p>
      </div>

      <div v-if="topStrengths.length > 0" class="rounded-lg border border-success/30 bg-success/5 p-3 sm:p-4">
        <h2 class="mb-2 flex items-center gap-1.5 font-heading text-sm font-semibold">
          <UIcon name="i-heroicons-trophy" class="h-4 w-4 text-success" />
          Points forts
        </h2>
        <ol class="space-y-2">
          <li v-for="(strength, index) in topStrengths" :key="strength.key" class="flex items-start gap-2">
            <span
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-[11px] font-semibold text-success"
            >
              {{ index + 1 }}
            </span>
            <div class="min-w-0">
              <p class="text-sm font-medium leading-tight">{{ strength.label }}</p>
              <p class="text-xs leading-tight text-muted">{{ strength.detail }}</p>
            </div>
          </li>
        </ol>
      </div>
      <div
        v-else
        class="flex items-center justify-center rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted"
      >
        <p v-if="totalRankedGames === 0">
          Pas encore de parties classées enregistrées -- reviens ici après quelques games.
        </p>
        <p v-else>Aucun point fort marquant sur tes {{ totalRankedGames }} parties classées.</p>
      </div>
    </div>

    <!-- Browsable tables: never collapsed, each panel scrolls its own content (header pinned)
    from lg up so the grid fills the width instead of stacking long accordions. -->
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <UiPanel
        v-model:search="mapsSearch"
        title="Winrate par carte"
        :count="filteredMaps.length"
        search-placeholder="Rechercher une carte"
      >
        <UiDataTable
          :columns="mapColumns"
          :rows="filteredMaps"
          row-key="mapId"
          sticky-header
          :sort-key="mapsSortKey"
          :sort-dir="mapsSortDir"
          @sort="onMapsSort"
        >
          <template #cell-winrate="{ row }">
            <span :class="(row.winrate as number) >= 0.5 ? 'text-success' : 'text-danger'">
              {{ formatPercent(row.winrate as number) }}
            </span>
          </template>
        </UiDataTable>
      </UiPanel>

      <UiPanel
        v-model:search="matchupsSearch"
        title="Matchups"
        :count="filteredMatchups.length"
        search-placeholder="Rechercher un héros"
      >
        <UiDataTable
          :columns="matchupColumns"
          :rows="filteredMatchups"
          row-key="heroId"
          sticky-header
          :sort-key="matchupsSortKey"
          :sort-dir="matchupsSortDir"
          @sort="onMatchupsSort"
        >
          <template #cell-winrate="{ row }">
            <span :class="(row.winrate as number) >= 0.5 ? 'text-success' : 'text-danger'">
              {{ formatPercent(row.winrate as number) }}
            </span>
          </template>
        </UiDataTable>
      </UiPanel>
    </div>

    <UiPanel
      v-model:search="talentsSearch"
      title="Talents sous-performants"
      :count="filteredTalents.length"
      search-placeholder="Héros ou talent"
    >
      <UiDataTable
        :columns="talentColumns"
        :rows="filteredTalents"
        row-key="talentId"
        mobile-primary-key="talentName"
        mobile-secondary-key="heroName"
        sticky-header
        :sort-key="talentsSortKey"
        :sort-dir="talentsSortDir"
        @sort="onTalentsSort"
      >
        <template #cell-talentName="{ row }">
          {{ formatTalentName(row.talentName as string, row.heroName as string) }}
        </template>
        <template #cell-talentWinrate="{ row }">
          <span class="text-danger">{{ formatPercent(row.talentWinrate as number) }}</span>
        </template>
        <template #cell-heroWinrate="{ row }">{{ formatPercent(row.heroWinrate as number) }}</template>
      </UiDataTable>
    </UiPanel>
  </div>
</template>
