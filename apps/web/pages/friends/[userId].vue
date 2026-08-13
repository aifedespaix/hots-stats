<script setup lang="ts">
import type { HeroStatsScope } from "@hots-stats/shared-types";
import type { FriendSummaryResponse } from "~/types/friends";
import type { MatchListResponse } from "~/types/matches";

definePageMeta({ middleware: "auth" });

const route = useRoute();
const friendId = route.params.userId as string;

const { scope, saving: scopeSaving, setScope } = useHeroStatsScope();

const { data, error } = await useApiFetch<FriendSummaryResponse>(`/friends/${friendId}/summary`, {
  query: computed(() => ({ scope: scope.value })),
});

const friendName = computed(() => data.value?.friend.displayName ?? "Ami");

useSeoMeta({
  title: () => friendName.value,
  description: () => `Statistiques complètes de ${friendName.value} sur Heroes of the Storm.`,
  robots: "noindex, follow",
});

const page = ref(1);
const pageSize = 20;

const { data: matchesData, pending: matchesPending } = await useApiFetch<MatchListResponse>(
  `/friends/${friendId}/matches`,
  { query: computed(() => ({ page: page.value, pageSize })) },
);

const columns = [
  { key: "playedAt", label: "Date" },
  { key: "mapName", label: "Carte" },
  { key: "gameMode", label: "Mode" },
  { key: "heroName", label: "Héros" },
  { key: "durationSeconds", label: "Durée", numeric: true },
  { key: "result", label: "Résultat" },
];

const topHeroes = computed(
  () =>
    data.value?.heroes.map((hero) => ({
      heroId: hero.heroId,
      heroName: hero.heroName,
      gamesPlayed: hero.gamesPlayed,
      wins: hero.wins,
      losses: hero.gamesPlayed - hero.wins,
    })) ?? [],
);

function goToMatch(row: Record<string, unknown>) {
  navigateTo(`/matches/${row.id}`);
}

function onScopeChange(value: HeroStatsScope) {
  setScope(value);
}
</script>

<template>
  <div v-if="error" class="rounded-lg border border-border bg-surface p-8 text-center text-muted">
    <p v-if="error.statusCode === 403">Vous n'êtes pas ami avec ce joueur.</p>
    <p v-else>Impossible de charger les statistiques de ce joueur.</p>
    <NuxtLink to="/friends" class="mt-3 inline-block text-sm text-brand hover:underline">
      &larr; Retour à mes amis
    </NuxtLink>
  </div>

  <div v-else-if="data" class="space-y-8">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <NuxtLink to="/friends" class="text-sm text-brand hover:underline">&larr; Retour à mes amis</NuxtLink>
        <h1 class="mt-2 break-words font-heading text-2xl font-semibold">{{ data.friend.displayName }}</h1>
        <p v-if="data.friend.battletag" class="font-mono text-sm text-muted">{{ data.friend.battletag }}</p>
      </div>
      <UButton
        v-if="data.friend.battletag"
        :to="`/face-a-face/${encodeURIComponent(data.friend.battletag)}`"
        icon="i-lucide-swords"
      >
        Face-à-Face
      </UButton>
    </div>

    <UiStatsScopeToggle
      :model-value="scope"
      :loading="scopeSaving"
      personal-label="Ses parties"
      personal-description="Uniquement les parties enregistrées pour ce joueur"
      @update:model-value="onScopeChange"
    />

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <UiStatTile
        label="Winrate"
        :value="formatPercent(data.summary.winrate)"
        :tone="data.summary.winrate >= 0.5 ? 'success' : 'danger'"
      />
      <UiStatTile label="Parties jouées" :value="String(data.summary.gamesPlayed)" />
      <UiStatTile label="Victoires" :value="String(data.summary.wins)" />
      <UiStatTile label="Durée moyenne" :value="formatDuration(data.summary.avgDurationSeconds)" />
    </div>

    <div>
      <h2 class="mb-3 font-heading text-lg font-medium">Top héros</h2>
      <UiTopHeroesTop3 :heroes="topHeroes" />
    </div>

    <div>
      <h2 class="mb-3 font-heading text-lg font-medium">Historique des parties</h2>
      <UiDataTable
        :columns="columns"
        :rows="matchesData?.matches ?? []"
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
          <span :class="row.winner ? 'text-success' : 'text-danger'">
            {{ row.winner ? "Victoire" : "Défaite" }}
          </span>
        </template>
      </UiDataTable>

      <div class="mt-4 flex justify-center">
        <UPagination
          v-model="page"
          :page-count="pageSize"
          :total="matchesData?.total ?? 0"
          :disabled="matchesPending"
        />
      </div>
    </div>
  </div>
</template>
