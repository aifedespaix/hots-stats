<script setup lang="ts">
import type { HeroStatsScope } from "@hots-stats/shared-types";
import type { HeroMatchupResponse } from "~/types/analytics";

const props = defineProps<{
  heroId: string;
  heroName: string;
  scope: HeroStatsScope;
  heroOptions: { id: string; name: string }[];
}>();

const config = useRuntimeConfig();
const selectedOpponentId = ref<string | undefined>(undefined);
const result = ref<HeroMatchupResponse | null>(null);
const pending = ref(false);

async function loadMatchup(opponentId: string) {
  pending.value = true;
  result.value = null;
  try {
    result.value = await $fetch<HeroMatchupResponse>(`/heroes/${props.heroId}/matchups/${opponentId}`, {
      baseURL: config.public.apiBase,
      credentials: "include",
      query: { scope: props.scope },
    });
  } finally {
    pending.value = false;
  }
}

function onSelect(opponentId: string | undefined) {
  selectedOpponentId.value = opponentId;
  if (opponentId) {
    void loadMatchup(opponentId);
  } else {
    result.value = null;
  }
}

// The scope toggle above this search lives on the page, not this component
// -- re-run the currently open duel under the new scope instead of leaving
// it showing stale numbers.
watch(
  () => props.scope,
  () => {
    if (selectedOpponentId.value) void loadMatchup(selectedOpponentId.value);
  },
);

const opponentHeroName = computed(
  () => props.heroOptions.find((hero) => hero.id === selectedOpponentId.value)?.name ?? "",
);
const losses = computed(() => (result.value ? result.value.opponent.gamesPlayed - result.value.opponent.wins : 0));

function closeCard() {
  selectedOpponentId.value = undefined;
  result.value = null;
}
</script>

<template>
  <div class="space-y-3">
    <USelectMenu
      :model-value="selectedOpponentId"
      searchable
      searchable-placeholder="Chercher un adversaire..."
      :options="heroOptions"
      value-attribute="id"
      option-attribute="name"
      placeholder="Chercher un adversaire..."
      @update:model-value="onSelect"
    >
      <template #label>
        <span v-if="opponentHeroName" class="truncate">{{ opponentHeroName }}</span>
        <span v-else class="text-muted">Chercher un adversaire...</span>
      </template>
      <template #trailing>
        <UButton
          v-if="selectedOpponentId"
          icon="i-heroicons-x-mark"
          size="2xs"
          color="gray"
          variant="link"
          :padded="false"
          @click.stop="closeCard"
        />
        <UIcon v-else name="i-heroicons-magnifying-glass" class="h-4 w-4 text-muted" />
      </template>
      <template #option-empty="{ query }">Aucun héros ne correspond à "{{ query }}"</template>
    </USelectMenu>

    <div v-if="pending" class="animate-pulse space-y-3 rounded-lg border border-border bg-surface p-4">
      <div class="mx-auto h-4 w-1/3 rounded bg-border" />
      <div class="mx-auto h-8 w-1/4 rounded bg-border" />
      <div class="h-16 rounded bg-border" />
    </div>

    <Transition name="matchup-card">
      <div v-if="!pending && result" class="space-y-4 rounded-lg border border-border bg-surface p-4">
        <div class="flex items-center justify-between gap-3">
          <span class="min-w-0 truncate font-heading text-sm font-semibold text-brand">{{ heroName }}</span>
          <span
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-background bg-foreground font-heading text-xs font-extrabold text-background"
          >
            VS
          </span>
          <span class="min-w-0 truncate text-right font-heading text-sm font-semibold text-accent">
            {{ result.opponent.heroName }}
          </span>
        </div>

        <div v-if="result.opponent.gamesPlayed === 0" class="rounded-lg bg-background p-4 text-center text-sm text-muted">
          Pas encore de partie enregistrée entre {{ heroName }} et {{ result.opponent.heroName }}.
        </div>
        <template v-else>
          <div class="text-center">
            <p
              class="font-mono text-3xl font-bold"
              :class="result.opponent.winrate >= 0.5 ? 'text-success' : 'text-danger'"
            >
              {{ formatPercent(result.opponent.winrate) }}
            </p>
            <p class="text-xs text-muted">de victoires face à {{ result.opponent.heroName }}</p>
            <p
              class="mt-1 font-mono text-xs font-medium"
              :class="result.opponent.deltaWinrate >= 0 ? 'text-success' : 'text-danger'"
            >
              {{ formatSignedPercent(result.opponent.deltaWinrate) }} vs sa moyenne ({{
                formatPercent(result.baselineWinrate)
              }})
            </p>
          </div>

          <dl class="space-y-2 text-sm">
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">Bilan</dt>
              <dd class="font-mono">
                {{ result.opponent.wins }}V / {{ losses }}D sur {{ result.opponent.gamesPlayed }} partie{{
                  result.opponent.gamesPlayed > 1 ? "s" : ""
                }}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">KDA dans ce duel</dt>
              <dd class="font-mono">
                {{ formatKda(result.opponent.kda) }}
                <span :class="result.opponent.deltaKda >= 0 ? 'text-success' : 'text-danger'">
                  ({{ formatSignedKda(result.opponent.deltaKda) }})
                </span>
              </dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">Participation aux kills</dt>
              <dd class="font-mono">
                {{ formatPercent(result.opponent.avgKillParticipation) }}
                <span :class="result.opponent.deltaKillParticipation >= 0 ? 'text-success' : 'text-danger'">
                  ({{ formatSignedPercent(result.opponent.deltaKillParticipation) }})
                </span>
              </dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">Dégâts aux héros</dt>
              <dd class="font-mono" :class="result.opponent.deltaHeroDamage >= 0 ? 'text-success' : 'text-danger'">
                {{ formatSignedPercent(result.opponent.deltaHeroDamage) }}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">Dégâts subis</dt>
              <dd class="font-mono" :class="result.opponent.deltaDamageTaken <= 0 ? 'text-success' : 'text-danger'">
                {{ formatSignedPercent(result.opponent.deltaDamageTaken) }}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">Contribution XP</dt>
              <dd class="font-mono" :class="result.opponent.deltaExperienceContribution >= 0 ? 'text-success' : 'text-danger'">
                {{ formatSignedPercent(result.opponent.deltaExperienceContribution) }}
              </dd>
            </div>
          </dl>

          <p v-if="result.opponent.smallSample" class="text-xs text-muted">
            Échantillon limité ({{ result.opponent.gamesPlayed }} partie{{
              result.opponent.gamesPlayed > 1 ? "s" : ""
            }}) -- verdict à prendre avec prudence.
          </p>

          <NuxtLink
            :to="`/matches?heroId=${heroId}&opponentHeroId=${selectedOpponentId}`"
            class="inline-flex items-center gap-1 text-sm text-brand hover:underline"
          >
            Voir nos parties l'un contre l'autre &rarr;
          </NuxtLink>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.matchup-card-enter-active {
  transition:
    opacity 0.2s ease-out,
    transform 0.2s ease-out;
}
.matchup-card-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.matchup-card-leave-active {
  transition: opacity 0.15s ease-in;
}
.matchup-card-leave-to {
  opacity: 0;
}
</style>
