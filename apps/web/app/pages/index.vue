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

    <UiTeaserLink to="/upload" icon="i-heroicons-cloud-arrow-up" eyebrow="Tes parties uploadées">
      {{ summary ? summary.gamesPlayed : "…" }} partie{{ (summary?.gamesPlayed ?? 0) > 1 ? "s" : "" }} sur ton
      compte — envoie les prochaines
    </UiTeaserLink>

    <StatsAccountSummaryStats :summary="summary" />

    <div v-if="topLeak || topStrength" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <UiTeaserLink
        v-if="topStrength"
        to="/analysis"
        icon="i-heroicons-sparkles"
        tone="success"
        eyebrow="Ton point fort du moment"
      >
        {{ topStrength.label }}
      </UiTeaserLink>

      <UiTeaserLink
        v-if="topLeak"
        to="/analysis"
        icon="i-heroicons-exclamation-triangle"
        tone="danger"
        eyebrow="Ton point faible du moment"
      >
        {{ topLeak.label }}
      </UiTeaserLink>
    </div>

    <div>
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-heading text-lg font-medium">Dernières parties</h2>
        <UiArrowLink to="/matches">Voir tout l'historique</UiArrowLink>
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
