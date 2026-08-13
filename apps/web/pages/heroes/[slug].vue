<script setup lang="ts">
import type { HeroDetailResponse, HeroTalentsResponse } from "~/types/analytics";

definePageMeta({ middleware: "auth" });

const route = useRoute();
const heroId = route.params.slug as string;

const { data, error } = await useApiFetch<HeroDetailResponse>(`/heroes/${heroId}`);
const { data: talentsData } = await useApiFetch<HeroTalentsResponse>(`/heroes/${heroId}/talents`);

const heroName = computed(() => data.value?.hero.heroName ?? "Héros");
const heroSeoDescription = computed(
  () =>
    `Statistiques de ${heroName.value} sur Heroes of the Storm : winrate, KDA moyen et talents les plus performants.`,
);

useSeoMeta({
  title: () => heroName.value,
  description: () => heroSeoDescription.value,
  ogTitle: () => `${heroName.value} - HotS Analytics`,
  ogDescription: () => heroSeoDescription.value,
  ogImage: "/og/heroes-[slug].png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/heroes-[slug].png",
  robots: "noindex, follow",
});

const talentTiers = [1, 4, 7, 10, 13, 16, 20] as const;

const talentsByTier = computed(() => {
  const map = new Map<number, HeroTalentsResponse["talents"]>();
  for (const talent of talentsData.value?.talents ?? []) {
    const list = map.get(talent.tier) ?? [];
    list.push(talent);
    map.set(talent.tier, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => b.pickRate - a.pickRate);
  }
  return map;
});
</script>

<template>
  <div v-if="error" class="rounded-lg border border-border bg-surface p-8 text-center text-muted">
    Héros introuvable - tu n'as pas encore de partie enregistrée avec ce héros.
  </div>

  <div v-else-if="data" class="space-y-8">
    <div>
      <NuxtLink to="/heroes" class="text-sm text-brand hover:underline">&larr; Retour aux héros</NuxtLink>
      <h1 class="mt-2 font-heading text-2xl font-semibold">{{ data.hero.heroName }}</h1>
      <p class="mt-1 text-sm text-muted">{{ formatHeroRole(data.hero.heroRole) }}</p>
    </div>

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <UiStatTile
        label="Winrate"
        :value="formatPercent(data.hero.winrate)"
        :tone="data.hero.winrate >= 0.5 ? 'success' : 'danger'"
      />
      <UiStatTile label="Parties jouées" :value="String(data.hero.gamesPlayed)" />
      <UiStatTile
        label="KDA moyen"
        :value="`${formatAvg(data.hero.avgKills)} / ${formatAvg(data.hero.avgDeaths)} / ${formatAvg(data.hero.avgAssists)}`"
      />
      <UiStatTile label="Participation aux kills" :value="formatPercent(data.hero.avgKillParticipation)" />
    </div>

    <div>
      <h2 class="mb-3 font-heading text-lg font-medium">Talents par palier</h2>
      <div class="grid gap-4 md:grid-cols-2">
        <div
          v-for="tier in talentTiers"
          :key="tier"
          class="rounded-lg border border-border bg-surface p-4"
        >
          <h3 class="mb-2 font-heading text-sm font-medium text-muted">Palier {{ tier }}</h3>
          <div v-if="(talentsByTier.get(tier)?.length ?? 0) === 0" class="text-sm text-muted">
            Aucune donnée.
          </div>
          <ul v-else class="space-y-2">
            <li
              v-for="talent in talentsByTier.get(tier)"
              :key="talent.talentId"
              class="flex items-center justify-between gap-2 text-sm"
            >
              <span>{{ formatTalentName(talent.talentName, data.hero.heroName) }}</span>
              <span class="flex shrink-0 gap-3 font-mono text-xs text-muted">
                <span>{{ formatPercent(talent.pickRate) }} pick</span>
                <span :class="talent.winrate >= 0.5 ? 'text-success' : 'text-danger'">
                  {{ formatPercent(talent.winrate) }} win
                </span>
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
