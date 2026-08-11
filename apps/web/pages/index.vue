<script setup lang="ts">
import type { MatchListResponse, StatsSummary } from "~/types/matches";

definePageMeta({ middleware: "auth" });

const { data: authData } = await useAuthUser();

const { data: summary } = await useApiFetch<StatsSummary>("/stats/summary");

const { data: recentMatches } = await useApiFetch<MatchListResponse>("/matches", {
  query: { page: 1, pageSize: 8 },
});

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

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <UiStatTile
        label="Winrate"
        :value="summary ? formatPercent(summary.winrate) : '—'"
        :tone="summary && summary.winrate >= 0.5 ? 'success' : 'danger'"
      />
      <UiStatTile label="Parties jouées" :value="summary ? String(summary.gamesPlayed) : '—'" />
      <UiStatTile label="Victoires" :value="summary ? String(summary.wins) : '—'" />
      <UiStatTile
        label="Durée moyenne"
        :value="summary ? formatDuration(summary.avgDurationSeconds) : '—'"
      />
    </div>

    <div>
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-heading text-lg font-medium">Dernières parties</h2>
        <NuxtLink to="/matches" class="text-sm text-primary hover:underline">
          Voir tout l'historique
        </NuxtLink>
      </div>

      <UiDataTable
        :columns="columns"
        :rows="recentMatches?.matches ?? []"
        clickable
        @row-click="goToMatch"
      >
        <template #cell-playedAt="{ row }">{{ formatDate(row.playedAt as string) }}</template>
        <template #cell-gameMode="{ row }">{{ formatGameMode(row.gameMode as never) }}</template>
        <template #cell-durationSeconds="{ row }">{{ formatDuration(row.durationSeconds as number) }}</template>
        <template #cell-result="{ row }">
          <span :class="row.winner ? 'text-success' : 'text-danger'">
            {{ row.winner ? "Victoire" : "Défaite" }}
          </span>
        </template>
      </UiDataTable>
    </div>

    <div class="rounded-lg border border-border bg-surface p-6">
      <h2 class="font-heading text-lg font-medium">Télécharger le daemon</h2>
      <p class="mt-1 text-sm text-muted">
        Le daemon Windows détecte automatiquement tes replays Heroes of the Storm et les envoie
        vers ton compte.
      </p>
      <UButton
        class="mt-4"
        to="https://github.com/aifedespaix/hots-stats/releases/latest"
        external
        target="_blank"
        icon="i-heroicons-arrow-down-tray"
      >
        Télécharger la dernière version
      </UButton>
    </div>
  </div>
</template>
