<script setup lang="ts">
import type { FaceAFaceSynergyStats } from "@hots-stats/shared-types";

const props = defineProps<{
  synergy: FaceAFaceSynergyStats;
  friendBattletag: string | null;
}>();

const losses = computed(() => props.synergy.gamesPlayed - props.synergy.wins);
const medals = ["🥇", "🥈", "🥉"];
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <UiStatTile label="Parties ensemble" :value="String(synergy.gamesPlayed)" />
      <UiStatTile label="Bilan en duo" :value="`${synergy.wins}V / ${losses}D`" />
      <UiStatTile
        label="Winrate duo"
        :value="synergy.gamesPlayed > 0 ? formatPercent(synergy.winrate) : '-'"
        :tone="synergy.gamesPlayed === 0 ? 'default' : synergy.winrate >= 0.5 ? 'success' : 'danger'"
      />
    </div>

    <div v-if="synergy.topCombos.length > 0">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Meilleurs combos</p>
      <ol class="space-y-2">
        <li
          v-for="(combo, index) in synergy.topCombos"
          :key="`${combo.myHeroId}-${combo.friendHeroId}`"
          class="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
        >
          <span class="w-5 shrink-0 text-center text-sm">{{ medals[index] }}</span>
          <span class="min-w-0 flex-1 truncate text-sm">
            <span class="font-medium text-brand">{{ combo.myHeroName }}</span>
            <span class="mx-1 text-muted">+</span>
            <span class="font-medium text-accent">{{ combo.friendHeroName }}</span>
          </span>
          <span class="shrink-0 font-mono text-xs" :class="combo.winrate >= 0.5 ? 'text-success' : 'text-danger'">
            {{ formatPercent(combo.winrate) }} · {{ combo.gamesPlayed }} partie{{ combo.gamesPlayed > 1 ? "s" : "" }}
          </span>
        </li>
      </ol>
    </div>
    <p v-else class="rounded-lg border border-border bg-surface p-4 text-center text-sm text-muted">
      Pas encore assez de parties ensemble pour dégager un combo fiable.
    </p>

    <NuxtLink
      v-if="friendBattletag && synergy.gamesPlayed > 0"
      :to="`/matches?allyBattletag=${encodeURIComponent(friendBattletag)}`"
      class="inline-flex items-center gap-1 text-sm text-brand hover:underline"
    >
      Voir nos parties ensemble &rarr;
    </NuxtLink>
  </div>
</template>
