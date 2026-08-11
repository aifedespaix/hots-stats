<script setup lang="ts">
import type { GameMode } from "@hots-stats/shared-types";
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

const mode = ref<GameMode | "">("");
const search = ref("");

const { scope, saving: scopeSaving, setScope } = useHeroStatsScope();

const query = computed(() => ({
  ...(mode.value ? { mode: mode.value } : {}),
  scope: scope.value,
}));

const { data } = await useApiFetch<HeroListResponse>("/heroes", { query });

const { sortKey, sortDir, onSort } = useSortState<keyof HeroStats>("gamesPlayed", "desc");

const modeOptions = [{ value: "" as const, label: "Tous les modes" }, ...gameModeOptions()];

const sortedHeroes = computed(() => {
  const searchTerm = search.value.trim().toLowerCase();
  const heroes = (data.value?.heroes ?? []).filter((hero) =>
    searchTerm ? hero.heroName.toLowerCase().includes(searchTerm) : true,
  );
  const dir = sortDir.value === "asc" ? 1 : -1;
  return heroes.sort((a, b) => {
    const av = a[sortKey.value];
    const bv = b[sortKey.value];
    if (typeof av === "string" && typeof bv === "string") {
      return av.localeCompare(bv) * dir;
    }
    return ((av as number) - (bv as number)) * dir;
  });
});

// Pagination slices sortedHeroes, which is already filtered by `search` -
// the search box keeps matching across the whole list, not just the current page.
const { page, pageSize, total, paginated: pagedHeroes } = usePagination(sortedHeroes, 20);

watch([mode, search], () => {
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

    <div class="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
      <USelectMenu
        v-model="mode"
        :options="modeOptions"
        value-attribute="value"
        option-attribute="label"
        placeholder="Mode"
      />
      <UInput v-model="search" placeholder="Rechercher un héros" icon="i-lucide-search" />
    </div>

    <UiDataTable
      :columns="columns"
      :rows="pagedHeroes"
      row-key="heroId"
      clickable
      :sort-key="sortKey"
      :sort-dir="sortDir"
      mobile-secondary-key="heroRole"
      mobile-badge-key="winrate"
      @row-click="goToHero"
      @sort="onSort"
    >
      <template #cell-heroRole="{ row }">{{ formatHeroRole(row.heroRole as string | null) }}</template>
      <template #cell-winrate="{ row }">
        <span :class="(row.winrate as number) >= 0.5 ? 'text-success' : 'text-danger'">
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

    <div v-if="total > pageSize" class="flex justify-center">
      <UPagination v-model="page" :page-count="pageSize" :total="total" />
    </div>
  </div>
</template>
