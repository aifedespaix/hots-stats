<script setup lang="ts">
import type { MatchListResponse, StatsSummary } from "~/types/matches";
import type { WeaknessesResponse } from "~/types/weaknesses";

definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Dashboard",
  description:
    "Vue d'ensemble de tes statistiques Heroes of the Storm : winrate, parties récentes et accès rapide à ton historique.",
  ogTitle: "Dashboard - HotS Analytics",
  ogDescription:
    "Vue d'ensemble de tes statistiques Heroes of the Storm : winrate, parties récentes et accès rapide à ton historique.",
  ogImage: "/og/index.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/index.png",
  robots: "noindex, follow",
});

const { data: authData } = await useAuthUser();

// Always personal: this page has no scope toggle, so it must never inherit
// `heroStatsScope` (the account-wide personal/global preference set on the
// Heroes/Talents/Friends pages) -- otherwise "Parties jouées" here silently
// switches to counting every match ever recorded by the app, across every
// player, the moment the user has toggled "Toute l'app" anywhere else.
const { data: summary } = await useApiFetch<StatsSummary>("/stats/summary", { query: { scope: "personal" } });

const { data: recentMatches } = await useApiFetch<MatchListResponse>("/matches", {
  query: { page: 1, pageSize: 8 },
});

const { data: weaknesses } = await useApiFetch<WeaknessesResponse>("/weaknesses");
const topLeak = computed(() => (weaknesses.value ? getTopWeaknesses(weaknesses.value, { limit: 1 })[0] : undefined));
const topStrength = computed(() => (weaknesses.value ? getTopStrengths(weaknesses.value, { limit: 1 })[0] : undefined));

const columns = [
  { key: "playedAt", label: "Date" },
  { key: "mapName", label: "Carte" },
  { key: "gameMode", label: "Mode" },
  { key: "heroName", label: "Héros" },
  { key: "durationSeconds", label: "Durée", numeric: true },
  { key: "result", label: "Résultat" },
];

function goToMatch(row: Record<string, unknown>) {
  navigateTo(`/matches/${row.id}`);
}
</script>

<template>
  <div class="space-y-8">
    <div>
      <h1 class="font-heading text-2xl font-semibold">Dashboard</h1>
      <p class="mt-1 text-sm text-muted">
        Bienvenue {{ authData?.user?.displayName }}, voici un aperçu de tes statistiques.
      </p>
    </div>

    <NuxtLink
      to="/upload"
      class="flex items-center gap-3 rounded-lg border border-brand/30 bg-brand/5 p-4 transition-colors hover:bg-brand/10"
    >
      <UIcon name="i-heroicons-cloud-arrow-up" class="h-5 w-5 shrink-0 text-brand" />
      <div class="min-w-0 flex-1">
        <p class="text-xs uppercase tracking-wide text-muted">Tes parties uploadées</p>
        <p class="truncate text-sm font-medium">
          {{ summary ? summary.gamesPlayed : "…" }} partie{{ (summary?.gamesPlayed ?? 0) > 1 ? "s" : "" }} sur ton
          compte — envoie les prochaines
        </p>
      </div>
      <UIcon name="i-heroicons-chevron-right" class="h-4 w-4 shrink-0 text-muted" />
    </NuxtLink>

    <StatsAccountSummaryStats :summary="summary" />

    <div v-if="topLeak || topStrength" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <NuxtLink
        v-if="topStrength"
        to="/analysis"
        class="flex items-center gap-3 rounded-lg border border-success/30 bg-success/5 p-4 transition-colors hover:bg-success/10"
      >
        <UIcon name="i-heroicons-sparkles" class="h-5 w-5 shrink-0 text-success" />
        <div class="min-w-0 flex-1">
          <p class="text-xs uppercase tracking-wide text-muted">Ton point fort du moment</p>
          <p class="truncate text-sm font-medium">{{ topStrength.label }}</p>
        </div>
        <UIcon name="i-heroicons-chevron-right" class="h-4 w-4 shrink-0 text-muted" />
      </NuxtLink>

      <NuxtLink
        v-if="topLeak"
        to="/analysis"
        class="flex items-center gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4 transition-colors hover:bg-danger/10"
      >
        <UIcon name="i-heroicons-exclamation-triangle" class="h-5 w-5 shrink-0 text-danger" />
        <div class="min-w-0 flex-1">
          <p class="text-xs uppercase tracking-wide text-muted">Ton point faible du moment</p>
          <p class="truncate text-sm font-medium">{{ topLeak.label }}</p>
        </div>
        <UIcon name="i-heroicons-chevron-right" class="h-4 w-4 shrink-0 text-muted" />
      </NuxtLink>
    </div>

    <div>
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-heading text-lg font-medium">Dernières parties</h2>
        <NuxtLink to="/matches" class="text-sm text-brand hover:underline">
          Voir tout l'historique
        </NuxtLink>
      </div>

      <UiDataTable
        :columns="columns"
        :rows="recentMatches?.matches ?? []"
        clickable
        mobile-primary-key="mapName"
        mobile-secondary-key="playedAt"
        mobile-badge-key="result"
        @row-click="goToMatch"
      >
        <template #cell-playedAt="{ row }">{{ formatDate(row.playedAt as string) }}</template>
        <template #cell-gameMode="{ row }">{{ formatGameMode(row.gameMode as never) }}</template>
        <template #cell-durationSeconds="{ row }">{{ formatDuration(row.durationSeconds as number) }}</template>
        <template #cell-result="{ row }">
          <span :class="row.winner ? TONE_TEXT_CLASS.success : TONE_TEXT_CLASS.danger">
            {{ row.winner ? "Victoire" : "Défaite" }}
          </span>
        </template>
      </UiDataTable>
    </div>
  </div>
</template>
