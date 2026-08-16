<script setup lang="ts">
import type { HeroListResponse, HeroStats } from "~/types/analytics";

definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Héros",
  description:
    "Statistiques détaillées par héros : winrate, KDA moyen et participation aux kills sur toutes tes parties Heroes of the Storm.",
  ogTitle: "Héros - HotS Analytics",
  ogDescription:
    "Statistiques détaillées par héros : winrate, KDA moyen et participation aux kills sur toutes tes parties Heroes of the Storm.",
  ogImage: "/og/heroes-index.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/heroes-index.png",
  robots: "noindex, follow",
});

const filtersStore = useHeroesFiltersStore();
const { filters, sortKey, sortDir } = storeToRefs(filtersStore);
const search = computed({
  get: () => filters.value.search,
  set: (value: string) => (filters.value.search = value),
});
const onSort = filtersStore.onSort;

const { scope, saving: scopeSaving, setScope } = useHeroStatsScope();
const gameModeStore = useGameModeStore();

const query = computed(() => ({
  mode: gameModeStore.modeQueryParam,
  scope: scope.value,
}));

const { data } = await useApiFetch<HeroListResponse>("/heroes", { query });

const sortedHeroes = computed(() => {
  const searchTerm = search.value.trim().toLowerCase();
  const heroes = (data.value?.heroes ?? []).filter((hero) =>
    searchTerm ? hero.heroName.toLowerCase().includes(searchTerm) : true,
  );
  return sortByKey(heroes, sortKey.value as keyof HeroStats, sortDir.value);
});

// Pagination slices sortedHeroes, which is already filtered by `search` -
// the search box keeps matching across the whole list, not just the current page.
const { page, pageSize, total, paginated: pagedHeroes } = usePagination(sortedHeroes, 20);

watch([() => gameModeStore.activeTags, search], () => {
  page.value = 1;
});

const columns = [
  { key: "heroName", label: "Héros", sortable: true },
  { key: "heroRole", label: "Rôle", sortable: true },
  { key: "gamesPlayed", label: "Parties", numeric: true, sortable: true },
  { key: "winrate", label: "Winrate", numeric: true, sortable: true },
  { key: "kda", label: "KDA", numeric: true },
  { key: "avgKillParticipation", label: "Participation", numeric: true, sortable: true },
];

function goToHero(row: Record<string, unknown>) {
  navigateTo(`/heroes/${row.heroId}`);
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="font-heading text-2xl font-semibold">Héros</h1>

    <UiStatsScopeToggle
      :model-value="scope"
      :loading="scopeSaving"
      personal-description="Uniquement tes propres parties"
      @update:model-value="setScope"
    />

    <UiSearchInput v-model="search" placeholder="Rechercher un héros" />

    <UiFilterResetActions
      :filters-default="filtersStore.isFiltersDefault"
      :sort-default="filtersStore.isSortDefault"
      @reset-filters="filtersStore.resetFilters()"
      @reset-sort="filtersStore.resetSort()"
    />

    <UiGlobalScopeBadge :scope="scope" label="Toute la communauté">
      <UiTableScrollPanel>
      <UiDataTable
        :columns="columns"
        :rows="pagedHeroes"
        row-key="heroId"
        clickable
        :sort-key="sortKey"
        :sort-dir="sortDir"
        mobile-secondary-key="heroRole"
        mobile-badge-key="winrate"
        sticky-header
        @row-click="goToHero"
        @sort="onSort"
      >
        <template #cell-heroName="{ row }">
          <div class="flex items-center gap-2.5">
            <HeroesHeroAvatar :hero-id="row.heroId as string" :name="row.heroName as string" :role="row.heroRole as string | null" :size="28" />
            <span class="truncate">{{ row.heroName }}</span>
          </div>
        </template>
        <template #cell-heroRole="{ row }">{{ formatHeroRole(row.heroRole as string | null) }}</template>
        <template #cell-winrate="{ row }">
          <span :class="TONE_TEXT_CLASS[winrateTone(row.winrate as number)]">
            {{ formatPercent(row.winrate as number) }}
          </span>
        </template>
        <template #cell-kda="{ row }">
          {{ formatAvg(row.avgKills as number) }} / {{ formatAvg(row.avgDeaths as number) }} /
          {{ formatAvg(row.avgAssists as number) }}
        </template>
        <template #cell-avgKillParticipation="{ row }">
          {{ formatPercent(row.avgKillParticipation as number) }}
        </template>
      </UiDataTable>
      </UiTableScrollPanel>

      <div v-if="total > pageSize" class="mt-4 flex justify-center">
        <UPagination v-model:page="page" :items-per-page="pageSize" :total="total" />
      </div>
    </UiGlobalScopeBadge>
  </div>
</template>
