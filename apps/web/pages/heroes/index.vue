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

const { data } = await useApiFetch<HeroListResponse>("/heroes");

const sortKey = ref<keyof HeroStats>("gamesPlayed");
const sortDir = ref<"asc" | "desc">("desc");

function onSort(key: string) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortKey.value = key as keyof HeroStats;
    sortDir.value = "desc";
  }
}

const sortedHeroes = computed(() => {
  const heroes = [...(data.value?.heroes ?? [])];
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

    <UiDataTable
      :columns="columns"
      :rows="sortedHeroes"
      row-key="heroId"
      clickable
      :sort-key="sortKey"
      :sort-dir="sortDir"
      @row-click="goToHero"
      @sort="onSort"
    >
      <template #cell-heroRole="{ row }">{{ formatHeroRole(row.heroRole as string) }}</template>
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
  </div>
</template>
