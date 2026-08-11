<script setup lang="ts">
import type { GameMode } from "@hots-stats/shared-types";
import type { MatchListResponse } from "~/types/matches";

definePageMeta({ middleware: "auth" });

interface FiltersResponse {
  heroes: { id: string; name: string }[];
  maps: { id: string; name: string }[];
}

const { data: filterOptions } = await useApiFetch<FiltersResponse>("/matches/filters");

const mode = ref<GameMode | "">("");
const heroId = ref("");
const mapId = ref("");
const dateFrom = ref("");
const dateTo = ref("");
const opponentBattletag = ref("");
const page = ref(1);
const pageSize = 20;

const query = computed(() => ({
  page: page.value,
  pageSize,
  ...(mode.value ? { mode: mode.value } : {}),
  ...(heroId.value ? { heroId: heroId.value } : {}),
  ...(mapId.value ? { mapId: mapId.value } : {}),
  ...(dateFrom.value ? { dateFrom: new Date(dateFrom.value).toISOString() } : {}),
  ...(dateTo.value ? { dateTo: new Date(dateTo.value).toISOString() } : {}),
  ...(opponentBattletag.value ? { opponentBattletag: opponentBattletag.value } : {}),
}));

const { data: matchesData, pending } = await useApiFetch<MatchListResponse>("/matches", { query });

watch([mode, heroId, mapId, dateFrom, dateTo, opponentBattletag], () => {
  page.value = 1;
});

const modeOptions = [{ value: "" as const, label: "Tous les modes" }, ...gameModeOptions()];

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
  <div class="space-y-6">
    <h1 class="font-heading text-2xl font-semibold">Historique des parties</h1>

    <div class="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3 lg:grid-cols-6">
      <USelectMenu
        v-model="mode"
        :options="modeOptions"
        value-attribute="value"
        option-attribute="label"
        placeholder="Mode"
      />
      <USelectMenu
        v-model="heroId"
        :options="[{ id: '', name: 'Tous les héros' }, ...(filterOptions?.heroes ?? [])]"
        value-attribute="id"
        option-attribute="name"
        placeholder="Héros"
      />
      <USelectMenu
        v-model="mapId"
        :options="[{ id: '', name: 'Toutes les cartes' }, ...(filterOptions?.maps ?? [])]"
        value-attribute="id"
        option-attribute="name"
        placeholder="Carte"
      />
      <UInput v-model="dateFrom" type="date" placeholder="Du" />
      <UInput v-model="dateTo" type="date" placeholder="Au" />
      <UInput v-model="opponentBattletag" placeholder="Joueur croisé (Pseudo#12345)" />
    </div>

    <UiDataTable
      :columns="columns"
      :rows="matchesData?.matches ?? []"
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

    <div class="flex justify-center">
      <UPagination
        v-model="page"
        :page-count="pageSize"
        :total="matchesData?.total ?? 0"
        :disabled="pending"
      />
    </div>
  </div>
</template>
