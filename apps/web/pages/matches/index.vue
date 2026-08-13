<script setup lang="ts">
import type { MatchListResponse } from "~/types/matches";
import type { MatchesSortableColumn } from "~/stores/useMatchesFiltersStore";

definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Historique",
  description:
    "Historique complet de tes parties Heroes of the Storm avec filtres par mode, héros, carte et joueur croisé.",
  ogTitle: "Historique - HotS Analytics",
  ogDescription:
    "Historique complet de tes parties Heroes of the Storm avec filtres par mode, héros, carte et joueur croisé.",
  ogImage: "/og/matches-index.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/matches-index.png",
  robots: "noindex, follow",
});

interface FiltersResponse {
  heroes: { id: string; name: string }[];
  maps: { id: string; name: string }[];
}

const { data: filterOptions } = await useApiFetch<FiltersResponse>("/matches/filters");

const filtersStore = useMatchesFiltersStore();
const { filters, sortKey, sortDir } = storeToRefs(filtersStore);
const mode = computed({
  get: () => filters.value.mode,
  set: (value: string) => (filters.value.mode = value),
});
const heroId = computed({
  get: () => filters.value.heroId,
  set: (value: string) => (filters.value.heroId = value),
});
const mapId = computed({
  get: () => filters.value.mapId,
  set: (value: string) => (filters.value.mapId = value),
});
const dateFrom = computed({
  get: () => filters.value.dateFrom,
  set: (value: string) => (filters.value.dateFrom = value),
});
const dateTo = computed({
  get: () => filters.value.dateTo,
  set: (value: string) => (filters.value.dateTo = value),
});
const opponentBattletag = computed({
  get: () => filters.value.opponentBattletag,
  set: (value: string) => (filters.value.opponentBattletag = value),
});
function onSort(key: string) {
  filtersStore.onSort(key as MatchesSortableColumn);
}

const page = ref(1);
const pageSize = 20;

// The "result" column (shown as Victoire/Défaite) sorts by the underlying
// `winner` boolean server-side, which isn't its own visible column.
const apiSortBy = computed(() => (sortKey.value === "result" ? "winner" : sortKey.value));

const activeFilters = computed(() => ({
  ...(mode.value ? { mode: mode.value } : {}),
  ...(heroId.value ? { heroId: heroId.value } : {}),
  ...(mapId.value ? { mapId: mapId.value } : {}),
  ...(dateFrom.value ? { dateFrom: new Date(dateFrom.value).toISOString() } : {}),
  ...(dateTo.value ? { dateTo: new Date(dateTo.value).toISOString() } : {}),
  ...(opponentBattletag.value ? { opponentBattletag: opponentBattletag.value } : {}),
}));

const query = computed(() => ({
  page: page.value,
  pageSize,
  sortBy: apiSortBy.value,
  sortDir: sortDir.value,
  ...activeFilters.value,
}));

const { data: matchesData, pending } = await useApiFetch<MatchListResponse>("/matches", { query });

const isChartOpen = ref(false);

watch([mode, heroId, mapId, dateFrom, dateTo, opponentBattletag], () => {
  page.value = 1;
});

watch([sortKey, sortDir], () => {
  page.value = 1;
});

const modeOptions = [{ value: "" as const, label: "Tous les modes" }, ...gameModeFilterOptions()];

const columns = [
  { key: "playedAt", label: "Date", sortable: true },
  { key: "mapName", label: "Carte", sortable: true },
  { key: "gameMode", label: "Mode", sortable: true },
  { key: "heroName", label: "Héros", sortable: true },
  { key: "durationSeconds", label: "Durée", numeric: true, sortable: true },
  { key: "result", label: "Résultat", sortable: true },
];

function goToMatch(row: Record<string, unknown>) {
  navigateTo(`/matches/${row.id}`);
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 class="font-heading text-2xl font-semibold">Historique des parties</h1>
      <UButton
        icon="i-lucide-line-chart"
        color="gray"
        variant="outline"
        class="justify-center"
        @click="isChartOpen = true"
      >
        Voir le graphique
      </UButton>
    </div>

    <div class="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3 lg:grid-cols-6">
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

    <div class="flex flex-wrap gap-2">
      <UButton
        size="xs"
        color="neutral"
        variant="soft"
        icon="i-heroicons-x-mark"
        :disabled="filtersStore.isFiltersDefault"
        @click="filtersStore.resetFilters()"
      >
        Réinitialiser les filtres
      </UButton>
      <UButton
        size="xs"
        color="neutral"
        variant="soft"
        icon="i-heroicons-arrows-up-down"
        :disabled="filtersStore.isSortDefault"
        @click="filtersStore.resetSort()"
      >
        Réinitialiser le tri
      </UButton>
    </div>

    <UiDataTable
      :columns="columns"
      :rows="matchesData?.matches ?? []"
      clickable
      :sort-key="sortKey"
      :sort-dir="sortDir"
      mobile-primary-key="mapName"
      mobile-secondary-key="playedAt"
      mobile-badge-key="result"
      @row-click="goToMatch"
      @sort="onSort"
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

    <ChartsWinrateTrendModal :open="isChartOpen" :filters="activeFilters" @update:open="isChartOpen = $event" />
  </div>
</template>
