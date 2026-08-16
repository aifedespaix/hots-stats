<script setup lang="ts">
import { UNKNOWN_GAME_VERSION } from "@hots-stats/shared-types";
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
  gameVersions: string[];
}

interface PlayerSearchResponse {
  players: string[];
  hasMore: boolean;
}

const config = useRuntimeConfig();
const { data: filterOptions } = await useApiFetch<FiltersResponse>("/matches/filters");

// Visiting the page is what clears the "new games" nav chip -- the sync
// toast watermark (which games we've *notified* about) is tracked
// separately. `engagement.matchesTotal` can still be its stale startup
// default (0) at this point, since the background poll it's normally fed
// by (see useEngagementWatchers) hasn't necessarily resolved yet -- marking
// visited against that stale value would peg the badge's baseline at 0 and
// make it falsely count the whole history as "new" once the poll catches
// up. Fetch the same lightweight total the poll uses so the baseline is
// always current when we clear it.
{
  const engagementStore = useEngagementStore();
  const { data: freshMatchesTotal } = await useApiFetch<MatchListResponse>("/matches", {
    query: { page: 1, pageSize: 1, sortBy: "playedAt", sortDir: "desc" },
  });
  if (freshMatchesTotal.value) engagementStore.reportMatchesTotal(freshMatchesTotal.value.total);
  engagementStore.markMatchesVisited();
}

const filtersStore = useMatchesFiltersStore();
const { filters, sortKey, sortDir } = storeToRefs(filtersStore);
const gameModeStore = useGameModeStore();
const gameVersionFilterStore = useGameVersionFilterStore();
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

// --- Version filter (game patch) --------------------------------------

const allGameVersions = computed(() => filterOptions.value?.gameVersions ?? []);
const selectedGameVersions = computed<string[]>({
  get: () => allGameVersions.value.filter((v) => !gameVersionFilterStore.isExcluded(v)),
  set: (included) => gameVersionFilterStore.setIncluded(allGameVersions.value, included),
});
const gameVersionItems = computed(() =>
  allGameVersions.value.map((v) => ({ value: v, label: v === UNKNOWN_GAME_VERSION ? "Version inconnue" : v })),
);
// A version filter that resolves to zero selected versions must still ask
// the API for *something* (`gameVersion` can't be an empty list -- see
// gameVersionListSchema) -- this placeholder never matches a real
// `matches.gameVersion` value or the `UNKNOWN_GAME_VERSION` sentinel, so it
// correctly yields an empty result set instead of accidentally matching
// everything (an absent filter) or erroring (an empty one).
const NO_VERSION_SELECTED = "__none_selected__";

function onSort(key: string) {
  filtersStore.onSort(key as MatchesSortableColumn);
}

const page = ref(1);
const pageSize = 20;

// The "result" column (shown as Victoire/Défaite) sorts by the underlying
// `winner` boolean server-side, which isn't its own visible column.
const apiSortBy = computed(() => (sortKey.value === "result" ? "winner" : sortKey.value));

const activeFilters = computed(() => ({
  mode: gameModeStore.modeQueryParam,
  ...(heroId.value ? { heroId: heroId.value } : {}),
  ...(mapId.value ? { mapId: mapId.value } : {}),
  ...(dateFrom.value ? { dateFrom: new Date(dateFrom.value).toISOString() } : {}),
  ...(dateTo.value ? { dateTo: new Date(dateTo.value).toISOString() } : {}),
  ...(opponentBattletag.value ? { opponentBattletag: opponentBattletag.value } : {}),
  // Omitted entirely (not sent as the full list) when nothing's excluded,
  // same reasoning as every other filter above -- keeps "everything
  // checked" indistinguishable from "no version filter" server-side.
  ...(!gameVersionFilterStore.isDefault
    ? {
        gameVersion: (selectedGameVersions.value.length > 0 ? selectedGameVersions.value : [NO_VERSION_SELECTED]).join(
          ",",
        ),
      }
    : {}),
}));

const query = computed(() => ({
  page: page.value,
  pageSize,
  sortBy: apiSortBy.value,
  sortDir: sortDir.value,
  ...activeFilters.value,
}));

const { data: matchesData, pending } = await useApiFetch<MatchListResponse>("/matches", { query });

watch(
  [() => gameModeStore.activeTags, heroId, mapId, dateFrom, dateTo, opponentBattletag, () => gameVersionFilterStore.excluded],
  () => {
    page.value = 1;
  },
);

watch([sortKey, sortDir], () => {
  page.value = 1;
});

// No empty-string item here: reka-ui's Combobox reserves an empty-string
// item value to mean "clear the selection" and throws if a real item uses
// it, breaking the whole dropdown. "Tous les héros"/"Toutes les cartes" is
// instead the select's own placeholder (heroId/mapId stays "") plus its
// built-in clear ("x") button.
const heroItems = computed(() =>
  (filterOptions.value?.heroes ?? []).map((hero) => ({ value: hero.id, label: hero.name })),
);
const mapItems = computed(() =>
  (filterOptions.value?.maps ?? []).map((map) => ({ value: map.id, label: map.name })),
);

// Backs the "joueur croisé" combobox: querying the full opponent list
// upfront used to ship every battletag the user has ever crossed paths
// with and render it all in one dropdown, which could hang or crash the
// tab once that list got large. Search server-side instead, past 3 chars,
// capped at 5 matches (see GET /matches/filters/players).
const opponentSearchTerm = ref("");
const opponentItems = ref<{ value: string; label: string; disabled?: boolean }[]>([]);
const opponentSearchPending = ref(false);
let opponentSearchTimeout: ReturnType<typeof setTimeout> | undefined;

watch(opponentSearchTerm, (rawQuery) => {
  clearTimeout(opponentSearchTimeout);
  opponentSearchTimeout = setTimeout(async () => {
    const term = rawQuery.trim();
    if (term.length < 3) {
      opponentItems.value = [];
      return;
    }
    opponentSearchPending.value = true;
    try {
      const res = await $fetch<PlayerSearchResponse>("/matches/filters/players", {
        baseURL: config.public.apiBase,
        credentials: "include",
        query: { q: term },
      });
      const items: { value: string; label: string; disabled?: boolean }[] = res.players.map((battletag) => ({
        value: battletag,
        label: battletag,
      }));
      if (res.hasMore) {
        items.push({ value: "__more_results__", label: "Plus de 5 résultats, précise ton pseudo…", disabled: true });
      }
      opponentItems.value = items;
    } finally {
      opponentSearchPending.value = false;
    }
  }, 200);
});

const columns = [
  { key: "playedAt", label: "Date", sortable: true },
  { key: "mapName", label: "Carte", sortable: true },
  { key: "gameMode", label: "Mode", sortable: true },
  { key: "heroName", label: "Héros", sortable: true },
  { key: "durationSeconds", label: "Durée", numeric: true, sortable: true },
  { key: "result", label: "Résultat", sortable: true },
  { key: "gameVersion", label: "Version" },
];

function goToMatch(row: Record<string, unknown>) {
  navigateTo(`/matches/${row.id}`);
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="font-heading text-2xl font-semibold">Historique des parties</h1>

    <StatsFormTrackerWidget
      :context="{}"
      title="Forme récente"
      modal-title="Suivi de la forme"
      modal-description="Winrate sur l'ensemble de ton compte, selon la fenêtre choisie ci-dessous."
    />

    <div>
      <h2 class="mb-3 font-heading text-lg font-medium">Dashboard</h2>
      <StatsDashboard :filters="activeFilters" />
    </div>

    <UiFilterBar :columns="4">
      <USelectMenu v-model="heroId" value-key="value" :items="heroItems" placeholder="Héros" clear />
      <USelectMenu v-model="mapId" value-key="value" :items="mapItems" placeholder="Carte" clear />
      <UInput v-model="dateFrom" type="date" placeholder="Du" />
      <UInput v-model="dateTo" type="date" placeholder="Au" />
      <USelectMenu
        v-model="opponentBattletag"
        v-model:search-term="opponentSearchTerm"
        value-key="value"
        :items="opponentItems"
        :loading="opponentSearchPending"
        ignore-filter
        placeholder="Joueur croisé"
      >
        <template #trailing>
          <UButton
            v-if="opponentBattletag"
            icon="i-heroicons-x-mark"
            size="xs"
            color="neutral"
            variant="link"
            :padded="false"
            @click.stop="opponentBattletag = ''"
          />
          <UIcon v-else name="i-heroicons-chevron-up-down" class="h-4 w-4 text-muted" />
        </template>
        <template #empty>
          {{ opponentSearchTerm.trim().length < 3 ? "Tape au moins 3 caractères" : "Aucun joueur trouvé" }}
        </template>
      </USelectMenu>

      <div class="flex min-w-0 items-center gap-1.5">
        <USelectMenu
          v-model="selectedGameVersions"
          multiple
          value-key="value"
          :items="gameVersionItems"
          placeholder="Version"
          class="min-w-0 flex-1"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="soft"
          title="Cocher toutes les versions"
          @click="gameVersionFilterStore.includeAll()"
        >
          Tout
        </UButton>
        <UButton
          size="xs"
          color="neutral"
          variant="soft"
          title="Décocher toutes les versions"
          @click="gameVersionFilterStore.excludeAll(allGameVersions)"
        >
          Aucune
        </UButton>
      </div>
    </UiFilterBar>

    <UiFilterResetActions
      :filters-default="filtersStore.isFiltersDefault && gameVersionFilterStore.isDefault"
      :sort-default="filtersStore.isSortDefault"
      @reset-filters="
        filtersStore.resetFilters();
        gameVersionFilterStore.includeAll();
      "
      @reset-sort="filtersStore.resetSort()"
    />

    <UiTableScrollPanel>
      <UiDataTable
        :columns="columns"
        :rows="matchesData?.matches ?? []"
        clickable
        :sort-key="sortKey"
        :sort-dir="sortDir"
        mobile-primary-key="mapName"
        mobile-secondary-key="playedAt"
        mobile-badge-key="result"
        sticky-header
        @row-click="goToMatch"
        @sort="onSort"
      >
        <template #cell-playedAt="{ row }">{{ formatDate(row.playedAt as string) }}</template>
        <template #cell-gameMode="{ row }">{{ formatGameMode(row.gameMode as never) }}</template>
        <template #cell-durationSeconds="{ row }">{{ formatDuration(row.durationSeconds as number) }}</template>
        <template #cell-result="{ row }">
          <span :class="row.winner ? TONE_TEXT_CLASS.success : TONE_TEXT_CLASS.danger">
            {{ row.winner ? "Victoire" : "Défaite" }}
          </span>
        </template>
        <template #cell-gameVersion="{ row }">
          <span v-if="row.gameVersion" class="font-mono text-xs text-muted">{{ row.gameVersion }}</span>
          <span v-else class="text-xs text-muted">—</span>
        </template>
      </UiDataTable>
    </UiTableScrollPanel>

    <div class="flex justify-center">
      <UPagination
        v-model:page="page"
        :items-per-page="pageSize"
        :total="matchesData?.total ?? 0"
        :disabled="pending"
      />
    </div>
  </div>
</template>
