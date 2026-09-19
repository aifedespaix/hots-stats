<script setup lang="ts">
import type { DraftPlayerSlot } from "@hots-stats/shared-types";
import type { HeroMatchupsResponse, HeroStats } from "~/types/analytics";
import {
  DRAFT_ASSIST_MAX_BANS,
  DRAFT_ASSIST_MAX_LIKELY_HEROES,
  DRAFT_ASSIST_MAX_PICKS,
  rankBanSuggestions,
  rankPickSuggestions,
  summarizeComposition,
  type LikelyHeroMatchups,
} from "~/utils/draftAssist";
import { isMine } from "~/utils/myAccounts";
import { TONE_TEXT_CLASS, winrateTone } from "~/utils/tone";

const props = defineProps<{
  /** The two teams *after* the page's client-side pseudo overrides are applied. */
  teamLeft: DraftPlayerSlot[];
  teamRight: DraftPlayerSlot[];
  /** Resolved battleground id; null while the OCR read has no known match. */
  mapId: string | null;
  /** Every BattleTag the viewer owns -- the same Set the team columns use. */
  ownBattletags: Set<string>;
}>();

const config = useRuntimeConfig();

// The team the viewer is on. Empty while their own slot is unresolved --
// "your composition" has no meaning until we know which side is yours.
const ownTeam = computed<DraftPlayerSlot[]>(() => {
  if (props.ownBattletags.size === 0) return [];
  const isLeft = props.teamLeft.some((slot) => isMine(slot.effectiveBattletag, props.ownBattletags));
  const isRight = props.teamRight.some((slot) => isMine(slot.effectiveBattletag, props.ownBattletags));
  // Unknown, or (impossible) on both sides: refuse to guess a side.
  if (isLeft === isRight) return [];
  return isLeft ? props.teamLeft : props.teamRight;
});

const composition = computed(() => summarizeComposition(ownTeam.value));
const takenRoles = computed(() => ownTeam.value.map((slot) => slot.heroRole));

// Refetch the pick pool only when the map or the *roles* already picked on the
// viewer's team change: rebuilding the array reference on every SSE push must
// not flash the panel back to its spinner (same guard as DraftTeamThreats).
const picksKey = computed(() =>
  props.mapId && composition.value.resolved > 0
    ? props.mapId + "|" + takenRoles.value.map((role) => role ?? "-").join(",")
    : "",
);

const {
  data: mapHeroes,
  pending: picksPending,
  errored: picksErrored,
} = useAsyncResource<HeroStats[]>({
  fetcher: async () => {
    if (!picksKey.value || !props.mapId) return [];
    const res = await $fetch<{ heroes: HeroStats[] }>("/heroes", {
      baseURL: config.public.apiBase,
      credentials: "include",
      // Personal only: these are the viewer's own picks, whatever their
      // persisted heroStatsScope says.
      query: { scope: "personal", mapId: props.mapId },
    });
    return res.heroes;
  },
  watch: () => picksKey.value,
});

const pickSuggestions = computed(() =>
  rankPickSuggestions(mapHeroes.value ?? [], takenRoles.value, DRAFT_ASSIST_MAX_PICKS),
);

// Ban search runs off the top pick suggestions: each one costs a
// /heroes/:heroId/matchups call, so the count is capped.
const likelyHeroes = computed(() => pickSuggestions.value.slice(0, DRAFT_ASSIST_MAX_LIKELY_HEROES));
const bansKey = computed(() => likelyHeroes.value.map((hero) => hero.heroId).join(","));

const {
  data: matchupGroups,
  pending: bansPending,
  errored: bansErrored,
} = useAsyncResource<LikelyHeroMatchups[]>({
  fetcher: async () => {
    if (likelyHeroes.value.length === 0) return [];
    return Promise.all(
      likelyHeroes.value.map(async (hero) => {
        const res = await $fetch<HeroMatchupsResponse>(
          "/heroes/" + encodeURIComponent(hero.heroId) + "/matchups",
          {
            baseURL: config.public.apiBase,
            credentials: "include",
            query: { scope: "personal" },
          },
        );
        return { heroId: hero.heroId, heroName: hero.heroName, worstMatchups: res.worstMatchups };
      }),
    );
  },
  watch: () => bansKey.value,
});

const banSuggestions = computed(() => rankBanSuggestions(matchupGroups.value ?? [], DRAFT_ASSIST_MAX_BANS));

const waitingMessage = computed(() => {
  if (ownTeam.value.length === 0) return "En attente de ton pseudo dans la draft.";
  if (composition.value.resolved === 0) return "En attente des héros de ton équipe (lecture OCR).";
  if (!props.mapId) return "Carte non reconnue : suggestions de pick indisponibles.";
  return null;
});
</script>

<template>
  <div class="rounded-lg border border-border bg-surface p-3">
    <div class="mb-2 flex items-center gap-2">
      <UIcon name="i-heroicons-sparkles" class="h-4 w-4 text-muted" />
      <h2 class="text-xs font-medium uppercase tracking-wide text-muted">Aide au draft</h2>
    </div>

    <p v-if="waitingMessage" class="py-1 text-xs text-muted">{{ waitingMessage }}</p>

    <template v-else>
      <div class="flex flex-wrap items-center gap-1.5">
        <span
          v-for="role in composition.counts"
          :key="role.role"
          class="rounded-full bg-background px-2 py-0.5 text-[11px]"
        >
          {{ formatHeroRole(role.role) }} ×{{ role.count }}
        </span>
        <span v-if="composition.partial" class="text-[11px] text-muted">
          {{ composition.resolved }}/{{ composition.total }} héros reconnus
        </span>
      </div>

      <ul v-if="composition.warnings.length" class="mt-1.5 space-y-0.5">
        <li
          v-for="warning in composition.warnings"
          :key="warning.kind"
          class="flex items-center gap-1.5 text-[11px] text-danger"
        >
          <UIcon name="i-heroicons-exclamation-triangle" class="h-3 w-3 shrink-0" />
          {{ warning.message }}
        </li>
      </ul>

      <div class="mt-2.5">
        <h3 class="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Picks suggérés</h3>
        <UiStateCard v-if="picksPending && !mapHeroes" state="loading" size="sm" />
        <p v-else-if="picksErrored" class="py-1 text-xs text-danger">
          Impossible de charger tes héros sur cette carte.
        </p>
        <p v-else-if="pickSuggestions.length === 0" class="py-1 text-xs text-muted">
          Pas assez de parties à toi sur cette carte.
        </p>
        <div v-else class="flex flex-wrap gap-2">
          <div
            v-for="pick in pickSuggestions"
            :key="pick.heroId"
            class="flex min-w-[8rem] flex-1 items-center gap-2 rounded-md border border-border px-2 py-1.5"
          >
            <HeroesHeroAvatar :hero-id="pick.heroId" :name="pick.heroName" :role="pick.heroRole" :size="24" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">{{ pick.heroName }}</p>
              <p class="text-[10px] text-muted">
                {{ pick.gamesPlayed }} partie{{ pick.gamesPlayed > 1 ? "s" : "" }} ·
                <span :class="TONE_TEXT_CLASS[winrateTone(pick.winrate)]">{{ formatPercent(pick.winrate) }}</span>
                <span v-if="pick.smallSample"> · échantillon faible</span>
              </p>
            </div>
          </div>
        </div>

        <template v-if="pickSuggestions.length > 0">
          <h3 class="mb-1 mt-2 text-[11px] font-medium uppercase tracking-wide text-muted">Bans suggérés</h3>
          <UiStateCard v-if="bansPending && !matchupGroups" state="loading" size="sm" />
          <p v-else-if="bansErrored" class="py-1 text-xs text-danger">
            Impossible de charger tes pires matchups.
          </p>
          <p v-else-if="banSuggestions.length === 0" class="py-1 text-xs text-muted">
            Aucun adversaire ne se détache nettement.
          </p>
          <div v-else class="flex flex-wrap gap-2">
            <div
              v-for="ban in banSuggestions"
              :key="ban.heroId"
              class="flex min-w-[9rem] flex-1 items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5"
            >
              <HeroesHeroAvatar :hero-id="ban.heroId" :name="ban.heroName" :role="ban.heroRole" :size="24" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm">{{ ban.heroName }}</p>
                <p class="text-[10px] text-muted">
                  contre {{ ban.counteredHeroName }} ·
                  <span :class="TONE_TEXT_CLASS[winrateTone(ban.deltaWinrate, 0)]">
                    {{ formatSignedPercent(ban.deltaWinrate) }}
                  </span>
                  · {{ ban.gamesPlayed }} partie{{ ban.gamesPlayed > 1 ? "s" : "" }}
                  <span v-if="ban.smallSample"> · échantillon faible</span>
                </p>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
