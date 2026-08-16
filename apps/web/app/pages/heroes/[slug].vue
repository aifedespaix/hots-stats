<script setup lang="ts">
import type { HeroDetailResponse, HeroListResponse, HeroMatchupsResponse, HeroTalentsResponse } from "~/types/analytics";

definePageMeta({ middleware: "auth" });

const route = useRoute();
const heroId = route.params.slug as string;

const { data, error } = await useApiFetch<HeroDetailResponse>(`/heroes/${heroId}`);
const { data: talentsData } = await useApiFetch<HeroTalentsResponse>(`/heroes/${heroId}/talents`);

const { scope: matchupScope, saving: matchupScopeSaving, setScope: setMatchupScope } = useHeroStatsScope();
const { data: matchupsData, pending: matchupsPending } = await useApiFetch<HeroMatchupsResponse>(
  `/heroes/${heroId}/matchups`,
  { query: computed(() => ({ scope: matchupScope.value })) },
);
// Search options need every hero ever recorded app-wide, not just the ones
// the connected account has played -- independent of `matchupScope`, which
// only controls how the best/worst matchup numbers are computed.
const { data: allHeroesData } = await useApiFetch<HeroListResponse>("/heroes", { query: { scope: "global" } });
const opponentHeroOptions = computed(() =>
  (allHeroesData.value?.heroes ?? [])
    .filter((hero) => hero.heroId !== heroId)
    .map((hero) => ({ id: hero.heroId, name: hero.heroName }))
    .sort((a, b) => a.name.localeCompare(b.name)),
);

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

const roleColors = computed(() => heroRoleColorClasses(data.value?.hero.heroRole ?? null));

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
  <UiErrorState
    v-if="error"
    :status-code="404"
    message="Héros introuvable - tu n'as pas encore de partie enregistrée avec ce héros."
    back-to="/heroes"
    back-label="Retour aux héros"
  />

  <div v-else-if="data" class="space-y-8">
    <div class="space-y-3">
      <UiBackLink to="/heroes" label="Retour aux héros" />
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <HeroesHeroAvatar :hero-id="heroId" :name="data.hero.heroName" :role="data.hero.heroRole" :size="80" ring />
          <div>
            <p
              v-if="data.hero.heroRole"
              class="mb-1.5 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
              :class="[roleColors.tint, roleColors.text]"
            >
              {{ formatHeroRole(data.hero.heroRole) }}
            </p>
            <h1 class="font-heading text-2xl font-semibold">{{ data.hero.heroName }}</h1>
          </div>
        </div>
        <UButton :to="`/talents?heroId=${heroId}`" color="neutral" variant="soft" icon="i-heroicons-sparkles" size="sm">
          Analyser les talents de ce héros
        </UButton>
      </div>
    </div>

    <StatsFormTrackerWidget
      :context="{ heroId }"
      title="Forme récente sur ce héros"
      :modal-description="`Winrate sur ${data.hero.heroName}, selon la fenêtre choisie ci-dessous.`"
    />

    <UiGlobalScopeBadge :scope="data.scope" label="Stats calculées sur toute la communauté">
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <UiStatTile
          label="Winrate"
          :value="formatPercent(data.hero.winrate)"
          :tone="winrateTone(data.hero.winrate)"
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
              class="inline-flex items-center gap-1 rounded-full bg-info/15 px-2 py-0.5 text-info"
              title="Assistances"
            >
              <UIcon name="i-lucide-hand-helping" class="h-3.5 w-3.5" />
              <span class="font-mono text-sm font-semibold sm:text-base">{{ formatAvg(data.hero.avgAssists) }}</span>
            </span>
          </div>
        </UiStatTile>
        <UiStatTile label="Participation aux kills" :value="formatPercent(data.hero.avgKillParticipation)" />
      </div>
    </UiGlobalScopeBadge>

    <div>
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 class="font-heading text-lg font-medium">Matchups</h2>
      </div>
      <UiStatsScopeToggle
        :model-value="matchupScope"
        :loading="matchupScopeSaving"
        personal-description="Uniquement tes propres parties"
        class="mb-4"
        @update:model-value="setMatchupScope"
      />

      <div class="mb-4">
        <HeroesHeroMatchupSearch
          :hero-id="heroId"
          :hero-name="data.hero.heroName"
          :scope="matchupScope"
          :hero-options="opponentHeroOptions"
        />
      </div>

      <div v-if="matchupsPending" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <UiSkeletonBlock v-for="i in 2" :key="i" class="h-40 rounded-lg border border-border bg-surface" />
      </div>
      <UiGlobalScopeBadge v-else-if="matchupsData" :scope="matchupScope">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <HeroesHeroMatchupList
            title="Meilleurs contres"
            tone="success"
            :entries="matchupsData.bestMatchups"
            empty-message="Pas encore assez de parties pour dégager un contre fiable."
          />
          <HeroesHeroMatchupList
            title="Pires matchups"
            tone="danger"
            :entries="matchupsData.worstMatchups"
            empty-message="Pas encore assez de parties pour dégager une faiblesse fiable."
          />
        </div>
      </UiGlobalScopeBadge>
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
                <span :class="TONE_TEXT_CLASS[winrateTone(talent.winrate)]">
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
