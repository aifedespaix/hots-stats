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

// The API always returns both scopes for this hero ("hero" = the account's
// preferred scope, "other" = the opposite one) so the winrate/KDA tiles can
// show a personal-vs-community comparison regardless of which scope the
// account currently prefers.
const personalStats = computed(() => (data.value?.scope === "personal" ? data.value.hero : (data.value?.other ?? null)));
const globalStats = computed(() => (data.value?.scope === "global" ? data.value.hero : (data.value?.other ?? null)));

type Verdict = { tone: "success" | "danger" | "default"; text: string };

const winrateVerdict = computed<Verdict | null>(() => {
  const mine = personalStats.value;
  const global = globalStats.value;
  if (!mine || !global) return null;
  const diff = mine.winrate - global.winrate;
  if (Math.abs(diff) < 0.005) return { tone: "default", text: "Dans la moyenne des autres joueurs." };
  return diff > 0
    ? { tone: "success", text: "Meilleur winrate que la moyenne des autres joueurs, bravo !" }
    : { tone: "danger", text: "Moins bon winrate que la moyenne des autres joueurs." };
});

const personalKda = computed(() =>
  personalStats.value
    ? computeKdaRatio(personalStats.value.avgKills, personalStats.value.avgDeaths, personalStats.value.avgAssists)
    : null,
);
const globalKda = computed(() =>
  globalStats.value
    ? computeKdaRatio(globalStats.value.avgKills, globalStats.value.avgDeaths, globalStats.value.avgAssists)
    : null,
);

const kdaVerdict = computed<Verdict | null>(() => {
  if (!personalStats.value || !globalStats.value) return null;
  const mine = personalKda.value;
  const global = globalKda.value;
  if (mine === null && global === null) return { tone: "default", text: "KDA parfait, identique à la moyenne des autres joueurs." };
  if (mine === null) return { tone: "success", text: "Meilleur KDA que la moyenne des autres joueurs, bravo !" };
  if (global === null) return { tone: "danger", text: "Moins bon KDA que la moyenne des autres joueurs." };
  const diff = mine - global;
  if (Math.abs(diff) < 0.05) return { tone: "default", text: "KDA dans la moyenne des autres joueurs." };
  return diff > 0
    ? { tone: "success", text: "Meilleur KDA que la moyenne des autres joueurs, bravo !" }
    : { tone: "danger", text: "Moins bon KDA que la moyenne des autres joueurs." };
});

const verdictClass: Record<Verdict["tone"], string> = {
  success: "text-success",
  danger: "text-danger",
  default: "text-muted",
};

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
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <NuxtLink to="/heroes" class="text-sm text-brand hover:underline">&larr; Retour aux héros</NuxtLink>
        <h1 class="mt-2 font-heading text-2xl font-semibold">{{ data.hero.heroName }}</h1>
        <p class="mt-1 text-sm text-muted">{{ formatHeroRole(data.hero.heroRole) }}</p>
      </div>
      <UButton :to="`/talents?heroId=${heroId}`" color="gray" variant="soft" icon="i-heroicons-sparkles" size="sm">
        Analyser les talents de ce héros
      </UButton>
    </div>

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <UiStatTile
        label="Winrate"
        :value="formatPercent(data.hero.winrate)"
        :tone="data.hero.winrate >= 0.5 ? 'success' : 'danger'"
      >
        <template v-if="personalStats && globalStats" #tooltip>
          <p class="flex items-center justify-between gap-3">
            <span class="text-muted">Toi</span>
            <span class="font-mono font-medium text-foreground">{{ formatPercent(personalStats.winrate) }}</span>
          </p>
          <p class="flex items-center justify-between gap-3">
            <span class="text-muted">Communauté</span>
            <span class="font-mono font-medium text-foreground">{{ formatPercent(globalStats.winrate) }}</span>
          </p>
          <p v-if="winrateVerdict" class="font-medium" :class="verdictClass[winrateVerdict.tone]">
            {{ winrateVerdict.text }}
          </p>
        </template>
      </UiStatTile>
      <UiStatTile label="Parties jouées" :value="String(data.hero.gamesPlayed)" />
      <UiStatTile
        label="KDA moyen"
        :value="`${formatAvg(data.hero.avgKills)} / ${formatAvg(data.hero.avgDeaths)} / ${formatAvg(data.hero.avgAssists)}`"
      >
        <template v-if="personalStats && globalStats" #tooltip>
          <p class="flex items-center justify-between gap-3">
            <span class="text-muted">Toi</span>
            <span class="font-mono font-medium text-foreground">{{ formatKda(personalKda) }}</span>
          </p>
          <p class="flex items-center justify-between gap-3">
            <span class="text-muted">Communauté</span>
            <span class="font-mono font-medium text-foreground">{{ formatKda(globalKda) }}</span>
          </p>
          <p v-if="kdaVerdict" class="font-medium" :class="verdictClass[kdaVerdict.tone]">
            {{ kdaVerdict.text }}
          </p>
        </template>
        <div class="flex flex-wrap items-center gap-1.5">
          <span
            class="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-success"
            title="Éliminations"
          >
            <UIcon name="i-lucide-sword" class="h-3.5 w-3.5" />
            <span class="font-mono text-sm font-semibold sm:text-base">{{ formatAvg(data.hero.avgKills) }}</span>
          </span>
          <span
            class="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-danger"
            title="Morts"
          >
            <UIcon name="i-lucide-skull" class="h-3.5 w-3.5" />
            <span class="font-mono text-sm font-semibold sm:text-base">{{ formatAvg(data.hero.avgDeaths) }}</span>
          </span>
          <span
            class="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-blue-400"
            title="Assistances"
          >
            <UIcon name="i-lucide-hand-helping" class="h-3.5 w-3.5" />
            <span class="font-mono text-sm font-semibold sm:text-base">{{ formatAvg(data.hero.avgAssists) }}</span>
          </span>
        </div>
      </UiStatTile>
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
