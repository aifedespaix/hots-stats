<script setup lang="ts">
import type { MapHubResponse } from "~/types/maps";

definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Cartes",
  description: "Le menu des cartes de Heroes of the Storm : ton winrate personnel sur chacune, en un coup d'œil.",
  ogTitle: "Cartes - HotS Analytics",
  ogDescription: "Le menu des cartes de Heroes of the Storm : ton winrate personnel sur chacune, en un coup d'œil.",
  ogImage: "/og/maps-index.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/maps-index.png",
  robots: "noindex, follow",
});

const { data } = await useApiFetch<MapHubResponse>("/maps");

const search = ref("");
type SortMode = "performance" | "name" | "games";
const sortMode = ref<SortMode>("performance");
const sortOptions: { value: SortMode; label: string }[] = [
  { value: "performance", label: "Ma performance (pire d'abord)" },
  { value: "games", label: "Parties jouées" },
  { value: "name", label: "Nom" },
];

const filteredMaps = computed(() => {
  const term = search.value.trim().toLowerCase();
  const rows = (data.value?.maps ?? []).filter((m) => (term ? m.mapName.toLowerCase().includes(term) : true));
  const sorted = [...rows];
  if (sortMode.value === "performance") sorted.sort((a, b) => a.winrate - b.winrate);
  else if (sortMode.value === "games") sorted.sort((a, b) => b.gamesPlayed - a.gamesPlayed);
  else sorted.sort((a, b) => a.mapName.localeCompare(b.mapName));
  return sorted;
});

function barSegment(winrate: number) {
  const pct = winrate * 100;
  const left = Math.min(50, pct);
  const width = Math.abs(pct - 50);
  return { left: `${left}%`, width: `${width}%` };
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="font-heading text-2xl font-semibold">Cartes</h1>
      <p class="mt-1 text-sm text-muted">
        Ton winrate par carte, sur tes parties classées. Choisis une carte pour la méta, ton historique et ton impact
        d'équipe dessus.
      </p>
    </div>

    <div class="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
      <UInput v-model="search" placeholder="Rechercher une carte" icon="i-lucide-search" />
      <USelectMenu
        v-model="sortMode"
        :options="sortOptions"
        value-attribute="value"
        option-attribute="label"
        placeholder="Trier par"
      />
    </div>

    <div v-if="filteredMaps.length === 0" class="rounded-lg border border-dashed border-border p-8 text-center text-muted">
      Aucune carte ne correspond à ta recherche.
    </div>

    <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="map in filteredMaps"
        :key="map.mapId"
        :to="`/maps/${map.mapId}`"
        class="group rounded-lg border p-4 transition-colors"
        :class="[
          map.gamesPlayed === 0
            ? 'border-border bg-surface'
            : map.winrate >= 0.5
              ? 'border-success/30 bg-surface hover:border-success/60'
              : 'border-danger/30 bg-surface hover:border-danger/60',
        ]"
      >
        <div class="flex items-start justify-between gap-2">
          <h2 class="font-heading text-base font-medium leading-tight group-hover:text-brand">{{ map.mapName }}</h2>
          <UIcon
            name="i-heroicons-arrow-right"
            class="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand"
          />
        </div>

        <p class="mt-1 text-xs text-muted">
          {{ map.gamesPlayed }} partie{{ map.gamesPlayed > 1 ? "s" : "" }} classée{{ map.gamesPlayed > 1 ? "s" : "" }}
        </p>

        <div v-if="map.gamesPlayed > 0" class="mt-3">
          <div class="relative h-2 w-full overflow-hidden rounded-full bg-background">
            <span class="absolute inset-y-0 w-px bg-border" style="left: 50%" />
            <span
              class="absolute inset-y-0 rounded-full"
              :class="map.winrate >= 0.5 ? 'bg-success' : 'bg-danger'"
              :style="barSegment(map.winrate)"
            />
          </div>
          <p class="mt-1.5 text-right font-mono text-sm font-semibold" :class="map.winrate >= 0.5 ? 'text-success' : 'text-danger'">
            {{ formatPercent(map.winrate) }}
          </p>
        </div>
        <p v-else class="mt-3 text-sm text-muted">Pas encore de partie</p>
      </NuxtLink>
    </div>
  </div>
</template>
