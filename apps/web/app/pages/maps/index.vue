<script setup lang="ts">
import { GAME_MODE_TAGS } from "~/utils/gameModeTags";
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

// Synced with the header's global "Type de partie" filter -- switching it
// recomputes this page's stats instantly instead of staying locked to Classé.
const gameModeStore = useGameModeStore();
const query = computed(() => ({ mode: gameModeStore.modeQueryParam }));

const { data } = await useApiFetch<MapHubResponse>("/maps", { query });

/** Human-readable label for whichever game-mode tags are currently active,
 * for the page intro and the recent-form accessible summary below. */
const activeModeLabel = computed(() =>
  GAME_MODE_TAGS.filter((tag) => gameModeStore.activeTags.includes(tag.key))
    .map((tag) => tag.label)
    .join(" + "),
);

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
  const rows = (data.value?.maps ?? []).filter(
    (m) => m.gamesPlayed > 0 && (term ? m.mapName.toLowerCase().includes(term) : true),
  );
  const sorted = [...rows];
  if (sortMode.value === "performance") sorted.sort((a, b) => a.winrate - b.winrate);
  else if (sortMode.value === "games") sorted.sort((a, b) => b.gamesPlayed - a.gamesPlayed);
  else sorted.sort((a, b) => a.mapName.localeCompare(b.mapName));
  return sorted;
});

/** Accessible summary of the recent-form dot strip, since the dots
 * themselves only carry color -- oldest game first, same order as rendered. */
function formLabel(recentForm: boolean[]): string {
  const wins = recentForm.filter(Boolean).length;
  return `Forme sur les ${recentForm.length} dernières parties (${activeModeLabel.value}) : ${wins} victoire${wins > 1 ? "s" : ""}, ${
    recentForm.length - wins
  } défaite${recentForm.length - wins > 1 ? "s" : ""} -- de la plus ancienne à la plus récente.`;
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="font-heading text-2xl font-semibold">Cartes</h1>
      <p class="mt-1 text-sm text-muted">
        Ton winrate par carte, sur tes parties {{ activeModeLabel }}. Choisis une carte pour la méta, ton historique
        et ton impact d'équipe dessus.
      </p>
    </div>

    <UiFilterBar :columns="2">
      <UInput
        v-model="search"
        placeholder="Rechercher une carte"
        icon="i-lucide-search"
        size="xl"
        :ui="{ base: 'h-14 rounded-full px-5 text-base', leadingIcon: 'size-5' }"
      />
      <USelectMenu
        v-model="sortMode"
        :items="sortOptions"
        value-key="value"
        label-key="label"
        placeholder="Trier par"
        size="xl"
        :ui="{ base: 'h-14 rounded-full px-5 text-base', trailingIcon: 'size-5' }"
      />
    </UiFilterBar>

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
          {{ map.gamesPlayed }} partie{{ map.gamesPlayed > 1 ? "s" : "" }} ({{ activeModeLabel }})
        </p>

        <div v-if="map.gamesPlayed > 0" class="mt-3">
          <UiWinrateBar :winrate="map.winrate" centered />
          <p class="mt-1.5 text-right font-mono text-sm font-semibold" :class="TONE_TEXT_CLASS[winrateTone(map.winrate)]">
            {{ formatPercent(map.winrate) }}
          </p>

          <div v-if="map.recentForm.length > 0" class="mt-2.5 flex items-center gap-1.5">
            <span class="text-[10px] uppercase tracking-wide text-muted">Forme</span>
            <div class="flex items-center gap-[3px]" :aria-label="formLabel(map.recentForm)">
              <span
                v-for="(win, index) in map.recentForm"
                :key="index"
                class="h-2 w-2 rounded-[2px]"
                :class="win ? 'bg-success' : 'bg-danger'"
                :title="win ? 'Victoire' : 'Défaite'"
              />
            </div>
          </div>
        </div>
        <p v-else class="mt-3 text-sm text-muted">Pas encore de partie</p>
      </NuxtLink>
    </div>
  </div>
</template>
