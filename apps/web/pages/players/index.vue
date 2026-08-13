<script setup lang="ts">
import type { PlayerListResponse } from "~/types/analytics";
import type { PlayersSortableColumn } from "~/stores/usePlayersFiltersStore";

definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Joueurs",
  description:
    "Radar des joueurs croisés, alliés ou adversaires, dans tes parties Heroes of the Storm : victoires, défaites et rencontres.",
  ogTitle: "Joueurs - HotS Analytics",
  ogDescription:
    "Radar des joueurs croisés, alliés ou adversaires, dans tes parties Heroes of the Storm : victoires, défaites et rencontres.",
  ogImage: "/og/players-index.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/players-index.png",
  robots: "noindex, follow",
});

// Sort/filter keys the backend can sort by directly; the two win-ratio
// columns aren't stored columns, so they're sorted client-side below.
const backendSortableColumns = ["battletag", "gamesTogether", "gamesAsAlly", "gamesAsOpponent", "wins", "losses"];

const filtersStore = usePlayersFiltersStore();
const { filters, sortKey, sortDir } = storeToRefs(filtersStore);
const mode = computed({
  get: () => filters.value.mode,
  set: (value: string) => (filters.value.mode = value),
});
const search = computed({
  get: () => filters.value.search,
  set: (value: string) => (filters.value.search = value),
});
function onSort(key: string) {
  filtersStore.onSort(key as PlayersSortableColumn);
}

const config = useRuntimeConfig();

const query = computed(() => ({
  sortBy: backendSortableColumns.includes(sortKey.value) ? sortKey.value : "gamesTogether",
  sortDir: sortDir.value,
  ...(mode.value ? { mode: mode.value } : {}),
}));

const { data, refresh } = await useApiFetch<PlayerListResponse>("/players", { query });

const sendingIds = reactive<Record<string, boolean>>({});

async function addFriend(accountUserId: string) {
  sendingIds[accountUserId] = true;
  try {
    await $fetch("/friends/requests", {
      method: "POST",
      baseURL: config.public.apiBase,
      credentials: "include",
      body: { userId: accountUserId },
    });
    await refresh();
  } finally {
    sendingIds[accountUserId] = false;
  }
}

const modeOptions = [{ value: "" as const, label: "Tous les modes" }, ...gameModeFilterOptions()];

function winRatio(wins: number, games: number): number | null {
  return games > 0 ? wins / games : null;
}

const rows = computed(() => {
  const searchTerm = search.value.trim().toLowerCase();
  const filtered = (data.value?.players ?? [])
    .filter((player) => (searchTerm ? player.battletag.toLowerCase().includes(searchTerm) : true))
    .map((player) => ({
      ...player,
      wins: player.winsAsAlly + player.winsAsOpponent,
      losses: player.gamesTogether - (player.winsAsAlly + player.winsAsOpponent),
      winRatioAsAlly: winRatio(player.winsAsAlly, player.gamesAsAlly),
      winRatioAsOpponent: winRatio(player.winsAsOpponent, player.gamesAsOpponent),
    }));

  // The two win-ratio columns aren't backend-sortable columns (they're
  // derived), so sort them client-side; every other column is already
  // sorted server-side via the `query` above.
  if (sortKey.value === "winRatioAsAlly" || sortKey.value === "winRatioAsOpponent") {
    const dir = sortDir.value === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey.value as "winRatioAsAlly" | "winRatioAsOpponent"] ?? -1;
      const bv = b[sortKey.value as "winRatioAsAlly" | "winRatioAsOpponent"] ?? -1;
      return (av - bv) * dir;
    });
  }
  return filtered;
});

// Pagination slices `rows`, which is already filtered by `search` - the
// search box keeps matching across the whole list, not just the current page.
const { page, pageSize, total, paginated: pagedRows } = usePagination(rows, 20);

watch([mode, search], () => {
  page.value = 1;
});

const columns = [
  { key: "battletag", label: "Joueur", sortable: true },
  { key: "gamesTogether", label: "Rencontres", numeric: true, sortable: true },
  { key: "gamesAsAlly", label: "Allié", numeric: true, sortable: true },
  { key: "gamesAsOpponent", label: "Adversaire", numeric: true, sortable: true },
  { key: "wins", label: "Victoires", numeric: true, sortable: true },
  { key: "losses", label: "Défaites", numeric: true, sortable: true },
  { key: "winRatioAsAlly", label: "% victoires alliés", numeric: true, sortable: true },
  { key: "winRatioAsOpponent", label: "% victoires adversaire", numeric: true, sortable: true },
  { key: "account", label: "Compte" },
];

function goToPlayer(row: Record<string, unknown>) {
  navigateTo(`/players/${encodeURIComponent(row.battletag as string)}`);
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="font-heading text-2xl font-semibold">Radar des joueurs</h1>
    <p class="text-sm text-muted">Tous les joueurs croisés (alliés ou adversaires) dans tes parties.</p>

    <div class="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
      <USelectMenu
        v-model="mode"
        :options="modeOptions"
        value-attribute="value"
        option-attribute="label"
        placeholder="Mode"
      />
      <UInput v-model="search" placeholder="Rechercher un joueur (Pseudo#12345)" icon="i-lucide-search" />
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
      :rows="pagedRows"
      row-key="battletag"
      clickable
      :sort-key="sortKey"
      :sort-dir="sortDir"
      @row-click="goToPlayer"
      @sort="onSort"
    >
      <template #cell-battletag="{ row }">
        <span class="font-mono">{{ row.battletag }}</span>
      </template>
      <template #cell-wins="{ row }">
        <span class="text-success">{{ row.wins }}</span>
      </template>
      <template #cell-losses="{ row }">
        <span class="text-danger">{{ row.losses }}</span>
      </template>
      <template #cell-winRatioAsAlly="{ row }">
        <span
          v-if="row.winRatioAsAlly !== null"
          :title="`Victoires dans les parties où ce joueur était dans ton équipe (${row.gamesAsAlly} parties)`"
        >
          {{ Math.round((row.winRatioAsAlly as number) * 100) }}%
        </span>
        <span v-else class="text-muted">-</span>
      </template>
      <template #cell-winRatioAsOpponent="{ row }">
        <span
          v-if="row.winRatioAsOpponent !== null"
          :title="`Victoires dans les parties où ce joueur était dans l'équipe adverse (${row.gamesAsOpponent} parties)`"
        >
          {{ Math.round((row.winRatioAsOpponent as number) * 100) }}%
        </span>
        <span v-else class="text-muted">-</span>
      </template>
      <template #cell-account="{ row }">
        <NuxtLink
          v-if="row.friendshipStatus === 'friends'"
          :to="`/friends/${row.accountUserId}`"
          class="inline-flex items-center gap-1 text-xs font-medium text-success"
          @click.stop
        >
          <UIcon name="i-heroicons-check-badge" class="h-4 w-4" />
          Ami
        </NuxtLink>
        <span v-else-if="row.friendshipStatus === 'pending_outgoing'" class="text-xs text-muted">
          Demande envoyée
        </span>
        <NuxtLink
          v-else-if="row.friendshipStatus === 'pending_incoming'"
          to="/friends"
          class="text-xs font-medium text-brand"
          @click.stop
        >
          À répondre
        </NuxtLink>
        <UButton
          v-else-if="row.accountUserId"
          size="2xs"
          variant="soft"
          icon="i-heroicons-user-plus"
          :loading="sendingIds[row.accountUserId as string]"
          @click.stop="addFriend(row.accountUserId as string)"
        >
          Ajouter
        </UButton>
        <span v-else class="text-xs text-muted">-</span>
      </template>
    </UiDataTable>

    <div v-if="total > pageSize" class="flex justify-center">
      <UPagination v-model="page" :page-count="pageSize" :total="total" />
    </div>
  </div>
</template>
