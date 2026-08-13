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

const mapColumns = [
  { key: "mapName", label: "Carte" },
  { key: "gamesPlayed", label: "Parties", numeric: true },
  { key: "winrate", label: "Winrate", numeric: true },
];

const matchupColumns = [
  { key: "heroName", label: "Héros adverse" },
  { key: "gamesPlayed", label: "Parties", numeric: true },
  { key: "winrate", label: "Winrate", numeric: true },
];

const talentColumns = [
  { key: "heroName", label: "Héros" },
  { key: "tier", label: "Palier", numeric: true },
  { key: "talentName", label: "Talent" },
  { key: "talentWinrate", label: "Ta winrate", numeric: true },
  { key: "heroWinrate", label: "Moyenne héros", numeric: true },
];
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="font-heading text-2xl font-semibold">Diagnostic</h1>
      <p class="mt-1 text-sm text-muted">
        Basé uniquement sur tes parties classées ({{ totalRankedGames }} au total) -- au moins
        {{ DRAFT_MIN_RANKED_GAMES_FOR_RANKING }} parties sont nécessaires avant qu'une carte ou un matchup soit
        retenu comme point faible.
      </p>
    </div>

    <div v-if="topLeaks.length > 0" class="rounded-lg border border-danger/30 bg-danger/5 p-4 sm:p-5">
      <h2 class="mb-3 flex items-center gap-2 font-heading text-base font-semibold">
        <UIcon name="i-heroicons-exclamation-triangle" class="h-5 w-5 text-danger" />
        Tes plus grosses fuites
      </h2>
      <ol class="space-y-3">
        <li v-for="(leak, index) in topLeaks" :key="leak.key" class="flex items-start gap-3">
          <span
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-danger/15 text-xs font-semibold text-danger"
          >
            {{ index + 1 }}
          </span>
          <div class="min-w-0">
            <p class="text-sm font-medium">{{ leak.label }}</p>
            <p class="text-xs text-muted">{{ leak.detail }}</p>
          </div>
        </li>
      </ol>
    </div>
    <div v-else class="rounded-lg border border-dashed border-border p-6 text-center text-muted">
      <p v-if="totalRankedGames === 0" class="text-sm">
        Pas encore de parties classées enregistrées -- reviens ici après quelques games.
      </p>
      <p v-else class="text-sm">Aucun point faible marquant sur tes {{ totalRankedGames }} parties classées.</p>
    </div>

    <details class="group rounded-lg border border-border bg-surface">
      <summary class="flex cursor-pointer items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
        <h2 class="font-heading text-sm font-medium">Winrate par carte</h2>
        <UIcon name="i-heroicons-chevron-down" class="h-4 w-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div class="border-t border-border p-4">
        <UiDataTable :columns="mapColumns" :rows="weaknesses?.maps ?? []" row-key="mapId">
          <template #cell-winrate="{ row }">
            <span :class="(row.winrate as number) >= 0.5 ? 'text-success' : 'text-danger'">
              {{ formatPercent(row.winrate as number) }}
            </span>
          </template>
        </UiDataTable>
      </div>
    </details>

    <details class="group rounded-lg border border-border bg-surface">
      <summary class="flex cursor-pointer items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
        <h2 class="font-heading text-sm font-medium">Matchups défavorables</h2>
        <UIcon name="i-heroicons-chevron-down" class="h-4 w-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div class="border-t border-border p-4">
        <UiDataTable :columns="matchupColumns" :rows="weaknesses?.matchups ?? []" row-key="heroId">
          <template #cell-winrate="{ row }">
            <span :class="(row.winrate as number) >= 0.5 ? 'text-success' : 'text-danger'">
              {{ formatPercent(row.winrate as number) }}
            </span>
          </template>
        </UiDataTable>
      </div>
    </details>

    <details class="group rounded-lg border border-border bg-surface">
      <summary class="flex cursor-pointer items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
        <h2 class="font-heading text-sm font-medium">Talents sous-performants</h2>
        <UIcon name="i-heroicons-chevron-down" class="h-4 w-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div class="border-t border-border p-4">
        <UiDataTable
          :columns="talentColumns"
          :rows="weaknesses?.talents ?? []"
          row-key="talentId"
          mobile-primary-key="talentName"
          mobile-secondary-key="heroName"
        >
          <template #cell-talentName="{ row }">
            {{ formatTalentName(row.talentName as string, row.heroName as string) }}
          </template>
          <template #cell-talentWinrate="{ row }">
            <span class="text-danger">{{ formatPercent(row.talentWinrate as number) }}</span>
          </template>
          <template #cell-heroWinrate="{ row }">{{ formatPercent(row.heroWinrate as number) }}</template>
        </UiDataTable>
      </div>
    </details>
  </div>
</template>
