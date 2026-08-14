<script setup lang="ts">
import type { FaceAFaceSynergyStats } from "@hots-stats/shared-types";

const props = defineProps<{
  synergy: FaceAFaceSynergyStats;
  friendBattletag: string | null;
}>();

const losses = computed(() => props.synergy.gamesPlayed - props.synergy.wins);

const comboItems = computed(() =>
  props.synergy.topCombos.map((combo) => ({
    id: `${combo.myHeroId}-${combo.friendHeroId}`,
    left: combo.myHeroName,
    right: combo.friendHeroName,
    winrate: combo.winrate,
    gamesPlayed: combo.gamesPlayed,
  })),
);
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <UiStatTile label="Parties ensemble" :value="String(synergy.gamesPlayed)" />
      <UiStatTile label="Bilan en duo" :value="`${synergy.wins}V / ${losses}D`" />
      <UiStatTile
        label="Winrate duo"
        :value="synergy.gamesPlayed > 0 ? formatPercent(synergy.winrate) : '-'"
        :tone="synergy.gamesPlayed === 0 ? 'default' : winrateTone(synergy.winrate)"
      />
    </div>

    <div>
      <p v-if="synergy.topCombos.length > 0" class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Meilleurs combos
      </p>
      <StatsTopComboList
        :items="comboItems"
        separator="+"
        tone="auto"
        empty-text="Pas encore assez de parties ensemble pour dégager un combo fiable."
      />
    </div>

    <NuxtLink
      v-if="friendBattletag && synergy.gamesPlayed > 0"
      :to="`/matches?allyBattletag=${encodeURIComponent(friendBattletag)}`"
      class="inline-flex items-center gap-1 text-sm text-brand hover:underline"
    >
      Voir nos parties ensemble &rarr;
    </NuxtLink>
  </div>
</template>
