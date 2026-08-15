<script setup lang="ts">
import type { PlayerAnnotationEntry } from "@hots-stats/shared-types";
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

// Sort/filter keys the backend can sort by directly; every other sortable
// column (win-ratio, rating/notes/behavior, global winrate/K-D) is derived
// or annotation-sourced, so it's sorted client-side below instead.
const backendSortableColumns = ["battletag", "gamesTogether", "gamesAsAlly", "gamesAsOpponent", "wins", "losses"];

const filtersStore = usePlayersFiltersStore();
const { filters, sortKey, sortDir } = storeToRefs(filtersStore);
const gameModeStore = useGameModeStore();
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
  mode: gameModeStore.modeQueryParam,
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

function winRatio(wins: number, games: number): number | null {
  return games > 0 ? wins / games : null;
}

// Every player currently in the list needs its annotation fetched up front
// (not just the current page) so the Note/Commentaires/Comportement columns
// can be sorted correctly before pagination slices the list -- sorting only
// the visible page would silently reorder rows in and out of view as you
// page through.
const annotationsStore = usePlayerAnnotationsStore();
const allBattletags = computed(() => (data.value?.players ?? []).map((player) => player.battletag));
watch(allBattletags, (battletags) => {
  if (battletags.length > 0) annotationsStore.fetchMany(battletags);
}, { immediate: true });

const rows = computed(() => {
  const searchTerm = search.value.trim().toLowerCase();
  const filtered = (data.value?.players ?? [])
    .filter((player) => (searchTerm ? player.battletag.toLowerCase().includes(searchTerm) : true))
    .map((player) => {
      const annotation = annotationsStore.annotationFor(player.battletag);
      return {
        ...player,
        wins: player.winsAsAlly + player.winsAsOpponent,
        losses: player.gamesTogether - (player.winsAsAlly + player.winsAsOpponent),
        winRatioAsAlly: winRatio(player.winsAsAlly, player.gamesAsAlly),
        winRatioAsOpponent: winRatio(player.winsAsOpponent, player.gamesAsOpponent),
        ratingAverage: annotation?.ratingAverage ?? null,
        ratingCount: annotation?.ratingCount ?? 0,
        notesEntries: annotation?.entries ?? [],
        notesCount: annotation?.entries.length ?? 0,
        fdpCount: annotation?.fdpCount ?? 0,
        pgmCount: annotation?.pgmCount ?? 0,
        behaviorScore: (annotation?.pgmCount ?? 0) - (annotation?.fdpCount ?? 0),
      };
    });

  // Columns that aren't backend-sortable (annotation-derived, or global
  // stats computed alongside but not wired into the API's own `sortBy`) are
  // sorted client-side; every other column is already sorted server-side
  // via the `query` above.
  if (!backendSortableColumns.includes(sortKey.value)) {
    const key = sortKey.value as
      | "winRatioAsAlly"
      | "winRatioAsOpponent"
      | "ratingAverage"
      | "notesCount"
      | "behaviorScore"
      | "globalWinrate"
      | "globalKdRatio";
    const dir = sortDir.value === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      // Always push players with no data for that column (null) to the end,
      // regardless of sort direction, so they don't clutter the top when
      // sorting ascending.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
  }
  return filtered;
});

// Pagination slices `rows`, which is already filtered by `search` - the
// search box keeps matching across the whole list, not just the current page.
const { page, pageSize, total, paginated: pagedRows } = usePagination(rows, 20);

watch([() => gameModeStore.activeTags, search], () => {
  page.value = 1;
});

function rowClass(row: Record<string, unknown>): string {
  const annotation = annotationsStore.annotationFor(row.battletag as string);
  if (annotation?.fdpCount) return "bg-danger/5 hover:bg-danger/10";
  if (annotation?.pgmCount) return "bg-accent/5 hover:bg-accent/10";
  if (row.friendshipStatus === "friends") return "bg-success/5 hover:bg-success/10";
  return "";
}

const columns = [
  { key: "battletag", label: "Joueur", sortable: true },
  { key: "gamesTogether", label: "Rencontres", numeric: true, sortable: true },
  { key: "gamesAsAlly", label: "Allié", numeric: true, sortable: true },
  { key: "gamesAsOpponent", label: "Adversaire", numeric: true, sortable: true },
  { key: "wins", label: "Victoires", numeric: true, sortable: true },
  { key: "losses", label: "Défaites", numeric: true, sortable: true },
  { key: "winRatioAsAlly", label: "% victoires alliés", numeric: true, sortable: true },
  { key: "winRatioAsOpponent", label: "% victoires adversaire", numeric: true, sortable: true },
  { key: "ratingAverage", label: "Note", numeric: true, sortable: true },
  { key: "notesCount", label: "Commentaires", numeric: true, sortable: true },
  { key: "behaviorScore", label: "Comportement", numeric: true, sortable: true },
  { key: "globalWinrate", label: "Ratio victoire", numeric: true, sortable: true },
  { key: "globalKdRatio", label: "Ratio K/D", numeric: true, sortable: true },
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

    <UInput v-model="search" placeholder="Rechercher un joueur (Pseudo#12345)" icon="i-lucide-search" class="max-w-sm" />

    <UiFilterResetActions
      :filters-default="filtersStore.isFiltersDefault"
      :sort-default="filtersStore.isSortDefault"
      @reset-filters="filtersStore.resetFilters()"
      @reset-sort="filtersStore.resetSort()"
    />

    <UiTableScrollPanel>
    <UiDataTable
      :columns="columns"
      :rows="pagedRows"
      row-key="battletag"
      clickable
      :sort-key="sortKey"
      :sort-dir="sortDir"
      :row-class="rowClass"
      sticky-header
      @row-click="goToPlayer"
      @sort="onSort"
    >
      <template #cell-battletag="{ row }">
        <span class="font-mono underline-offset-2 hover:underline">{{ row.battletag }}</span>
      </template>
      <template #cell-ratingAverage="{ row }">
        <UiStarRatingAverage :average="row.ratingAverage as number | null" :count="row.ratingCount as number" size="h-3.5 w-3.5" />
      </template>
      <template #cell-notesCount="{ row }">
        <PlayersNotesButton :battletag="row.battletag as string" :entries="row.notesEntries as PlayerAnnotationEntry[]" />
      </template>
      <template #cell-behaviorScore="{ row }">
        <div class="flex items-center gap-1.5">
          <span
            v-if="(row.pgmCount as number) > 0"
            class="inline-flex items-center gap-0.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent"
            :title="`Marqué sympa par ${row.pgmCount} joueur(s)`"
          >
            <UIcon name="i-heroicons-face-smile" class="h-3 w-3" />
            {{ row.pgmCount }}
          </span>
          <span
            v-if="(row.fdpCount as number) > 0"
            class="inline-flex items-center gap-0.5 rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger"
            :title="`Marqué FDP par ${row.fdpCount} joueur(s)`"
          >
            <UIcon name="i-heroicons-face-frown" class="h-3 w-3" />
            {{ row.fdpCount }}
          </span>
          <span v-if="(row.pgmCount as number) === 0 && (row.fdpCount as number) === 0" class="text-xs text-muted">-</span>
        </div>
      </template>
      <template #cell-globalWinrate="{ row }">
        <span :class="TONE_TEXT_CLASS[winrateTone(row.globalWinrate as number)]">
          {{ formatPercent(row.globalWinrate as number) }}
        </span>
        <span class="ml-1 text-xs text-muted">({{ row.globalGamesPlayed }})</span>
      </template>
      <template #cell-globalKdRatio="{ row }">
        {{ row.globalKdRatio === null ? "Parfait" : (row.globalKdRatio as number).toFixed(2) }}
      </template>
      <template #cell-wins="{ row }">
        <span class="inline-flex items-center justify-center rounded-md bg-success/10 px-2 py-0.5 font-mono text-success">
          {{ row.wins }}
        </span>
      </template>
      <template #cell-losses="{ row }">
        <span class="inline-flex items-center justify-center rounded-md bg-danger/10 px-2 py-0.5 font-mono text-danger">
          {{ row.losses }}
        </span>
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
          size="xs"
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
    </UiTableScrollPanel>

    <div v-if="total > pageSize" class="flex justify-center">
      <UPagination v-model:page="page" :items-per-page="pageSize" :total="total" />
    </div>
  </div>
</template>
