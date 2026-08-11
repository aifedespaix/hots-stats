<script setup lang="ts">
import type { PlayerDetailResponse } from "~/types/analytics";
import type { MatchListResponse } from "~/types/matches";

definePageMeta({ middleware: "auth" });

const route = useRoute();
const battletag = route.params.battletag as string;

const { data, error } = await useApiFetch<PlayerDetailResponse>(
  `/players/${encodeURIComponent(battletag)}`,
);

const page = ref(1);
const pageSize = 20;

const { data: matchesData, pending } = await useApiFetch<MatchListResponse>("/matches", {
  query: computed(() => ({ opponentBattletag: battletag, page: page.value, pageSize })),
});

const columns = [
  { key: "playedAt", label: "Date" },
  { key: "mapName", label: "Carte" },
  { key: "gameMode", label: "Mode" },
  { key: "heroName", label: "Ton héros" },
  { key: "result", label: "Résultat" },
];

function goToMatch(row: Record<string, unknown>) {
  navigateTo(`/matches/${row.id}`);
}
</script>

<template>
  <div v-if="error" class="rounded-lg border border-border bg-surface p-8 text-center text-muted">
    Aucune partie en commun avec ce joueur.
  </div>

  <div v-else-if="data" class="space-y-8">
    <div>
      <NuxtLink to="/players" class="text-sm text-brand hover:underline">&larr; Retour aux joueurs</NuxtLink>
      <h1 class="mt-2 font-heading text-2xl font-semibold font-mono">{{ data.player.battletag }}</h1>
    </div>

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <UiStatTile label="Parties ensemble" :value="String(data.player.gamesTogether)" />
      <UiStatTile
        label="En tant qu'alliés"
        :value="`${data.player.winsAsAlly} V / ${data.player.gamesAsAlly - data.player.winsAsAlly} D`"
        :sublabel="`${data.player.gamesAsAlly} parties`"
      />
      <UiStatTile
        label="En tant qu'adversaires"
        :value="`${data.player.winsAsOpponent} V / ${data.player.gamesAsOpponent - data.player.winsAsOpponent} D`"
        :sublabel="`${data.player.gamesAsOpponent} parties`"
      />
      <UiStatTile
        label="Victoires totales"
        :value="String(data.player.winsAsAlly + data.player.winsAsOpponent)"
        tone="success"
      />
    </div>

    <div>
      <h2 class="mb-3 font-heading text-lg font-medium">Historique des parties partagées</h2>

      <UiDataTable :columns="columns" :rows="matchesData?.matches ?? []" clickable @row-click="goToMatch">
        <template #cell-playedAt="{ row }">{{ formatDate(row.playedAt as string) }}</template>
        <template #cell-gameMode="{ row }">{{ formatGameMode(row.gameMode as never) }}</template>
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
          :disabled="pending"
        />
      </div>
    </div>
  </div>
</template>
