<script setup lang="ts">
import type { DraftHeroStat, DraftPlayerStats } from "@hots-stats/shared-types";
import { DRAFT_MIN_RANKED_GAMES_FOR_RANKING } from "@hots-stats/shared-types";

const props = defineProps<{ battletag: string | null }>();

const config = useRuntimeConfig();
const stats = ref<DraftPlayerStats | null>(null);
const pending = ref(false);
const errored = ref(false);

watch(
  () => props.battletag,
  async (battletag) => {
    stats.value = null;
    errored.value = false;
    if (!battletag) return;

    pending.value = true;
    try {
      const res = await $fetch<{ stats: DraftPlayerStats }>(`/draft/players/${encodeURIComponent(battletag)}`, {
        baseURL: config.public.apiBase,
        credentials: "include",
      });
      stats.value = res.stats;
    } catch {
      errored.value = true;
    } finally {
      pending.value = false;
    }
  },
  { immediate: true },
);

interface Section {
  key: "played" | "winrate" | "kda";
  title: string;
  icon: string;
  heroes: DraftHeroStat[];
  metricLabel: (hero: DraftHeroStat) => string;
  note: string;
}

const sections = computed<Section[]>(() => {
  if (!stats.value) return [];
  return [
    {
      key: "played",
      title: "Top 3 joués (classé)",
      icon: "i-heroicons-fire",
      heroes: stats.value.topPlayed,
      metricLabel: (hero) => `${hero.gamesPlayed} partie${hero.gamesPlayed > 1 ? "s" : ""}`,
      note: "Calculé sur toutes les parties classées enregistrées, pas seulement les tiennes.",
    },
    {
      key: "winrate",
      title: "Top 3 winrate (classé)",
      icon: "i-heroicons-trophy",
      heroes: stats.value.topWinrate,
      metricLabel: (hero) => `${Math.round(hero.winrate * 100)}%`,
      note: `Calculé sur stats globales, ${DRAFT_MIN_RANKED_GAMES_FOR_RANKING}+ parties classées requises.`,
    },
    {
      key: "kda",
      title: "Top 2 KDA moyen (classé)",
      icon: "i-heroicons-chart-bar",
      heroes: stats.value.topKda.slice(0, 2),
      metricLabel: (hero) => hero.kda.toFixed(2),
      note: `Calculé sur stats globales, ${DRAFT_MIN_RANKED_GAMES_FOR_RANKING}+ parties classées requises.`,
    },
  ];
});

const medals = ["🥇", "🥈", "🥉"];
</script>

<template>
  <div class="flex h-full flex-col rounded-lg border border-border bg-surface">
    <h2 class="shrink-0 border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted">
      Statistiques
    </h2>

    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <div v-if="!battletag" class="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
        <UIcon name="i-heroicons-cursor-arrow-rays" class="h-8 w-8" />
        <p class="text-sm">Sélectionne un joueur dans une des deux équipes pour voir ses statistiques.</p>
      </div>

      <div v-else-if="pending" class="flex h-full items-center justify-center text-muted">
        <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin" />
      </div>

      <div v-else-if="errored" class="flex h-full flex-col items-center justify-center gap-2 text-center text-danger">
        <UIcon name="i-heroicons-exclamation-triangle" class="h-6 w-6" />
        <p class="text-sm">Impossible de charger les statistiques de ce joueur.</p>
      </div>

      <div v-else-if="stats" class="space-y-5">
        <div class="flex flex-wrap items-center gap-2">
          <p class="break-all font-mono text-lg font-semibold">{{ stats.battletag }}</p>
          <PlayersAnnotationBadges :battletag="stats.battletag" />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <UiStatTile label="Rencontres avec toi" :value="String(stats.encounters)" />
          <UiStatTile label="Parties classées" :value="String(stats.rankedGamesTotal)" />
        </div>

        <div class="rounded-lg border border-border p-3">
          <div class="mb-2 flex items-center gap-2">
            <UIcon name="i-heroicons-clock" class="h-4 w-4 text-muted" />
            <h3 class="text-xs font-medium uppercase tracking-wide text-muted">5 dernières parties</h3>
          </div>

          <template v-if="stats.recentGames.length > 0">
            <div class="mb-2.5 flex gap-1">
              <span
                v-for="game in stats.recentGames"
                :key="game.playedAt"
                class="h-1.5 flex-1 rounded-full"
                :class="game.winner ? 'bg-success' : 'bg-danger'"
              />
            </div>
            <ul class="space-y-1.5">
              <li
                v-for="game in stats.recentGames"
                :key="game.playedAt"
                class="flex items-start gap-2.5 rounded-md px-1.5 py-1"
              >
                <span
                  class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  :class="game.winner ? 'bg-success' : 'bg-danger'"
                />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm">{{ game.heroName }}</p>
                  <p class="text-[11px] text-muted">
                    {{ formatGameMode(game.gameMode) }} · {{ formatDate(game.playedAt) }}
                  </p>
                </div>
              </li>
            </ul>
          </template>
          <p v-else class="py-1 text-xs text-muted">Pas assez de données.</p>
        </div>

        <div v-for="section in sections" :key="section.key" class="rounded-lg border border-border p-3">
          <div class="mb-2 flex items-center gap-2">
            <UIcon :name="section.icon" class="h-4 w-4 text-muted" />
            <h3 class="text-xs font-medium uppercase tracking-wide text-muted">{{ section.title }}</h3>
          </div>

          <ol v-if="section.heroes.length > 0" class="space-y-1.5">
            <li
              v-for="(hero, index) in section.heroes"
              :key="hero.heroId"
              class="flex items-center gap-2.5 rounded-md px-1.5 py-1"
            >
              <span class="w-5 shrink-0 text-center text-sm">{{ medals[index] }}</span>
              <span class="min-w-0 flex-1 truncate text-sm">{{ hero.heroName }}</span>
              <span class="shrink-0 font-mono text-xs text-muted">{{ section.metricLabel(hero) }}</span>
            </li>
          </ol>
          <p v-else class="py-1 text-xs text-muted">Pas assez de données.</p>

          <p class="mt-2 text-[10px] italic text-muted">{{ section.note }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
