<script setup lang="ts">
import type { PlayerListResponse } from "~/types/analytics";

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

const sortKey = ref<"battletag" | "gamesTogether" | "wins" | "losses">("gamesTogether");
const sortDir = ref<"asc" | "desc">("desc");

const query = computed(() => ({ sortBy: sortKey.value, sortDir: sortDir.value }));

const { data } = await useApiFetch<PlayerListResponse>("/players", { query });

function onSort(key: string) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortKey.value = key as typeof sortKey.value;
    sortDir.value = "desc";
  }
}

const rows = computed(
  () =>
    data.value?.players.map((player) => ({
      ...player,
      wins: player.winsAsAlly + player.winsAsOpponent,
      losses: player.gamesTogether - (player.winsAsAlly + player.winsAsOpponent),
    })) ?? [],
);

const columns = [
  { key: "battletag", label: "Joueur", sortable: true },
  { key: "gamesTogether", label: "Rencontres", numeric: true, sortable: true },
  { key: "wins", label: "Victoires", numeric: true, sortable: true },
  { key: "losses", label: "Défaites", numeric: true, sortable: true },
];

function goToPlayer(row: Record<string, unknown>) {
  navigateTo(`/players/${encodeURIComponent(row.battletag as string)}`);
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="font-heading text-2xl font-semibold">Radar des joueurs</h1>
    <p class="text-sm text-muted">Tous les joueurs croisés (alliés ou adversaires) dans tes parties.</p>

    <UiDataTable
      :columns="columns"
      :rows="rows"
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
    </UiDataTable>
  </div>
</template>
