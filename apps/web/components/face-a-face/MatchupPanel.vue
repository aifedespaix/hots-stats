<script setup lang="ts">
import type { FaceAFaceMatchupStats } from "@hots-stats/shared-types";

const props = defineProps<{
  matchups: FaceAFaceMatchupStats;
  opponentBattletag: string | null;
}>();

const losses = computed(() => props.matchups.gamesPlayed - props.matchups.wins);
const medals = ["🥇", "🥈", "🥉"];
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <UiStatTile label="Parties en ennemis" :value="String(matchups.gamesPlayed)" />
      <UiStatTile label="Bilan face à face" :value="`${matchups.wins}V / ${losses}D`" />
      <UiStatTile
        label="Winrate face à lui"
        :value="matchups.gamesPlayed > 0 ? formatPercent(matchups.winrate) : '-'"
        :tone="matchups.gamesPlayed === 0 ? 'default' : matchups.winrate >= 0.5 ? 'success' : 'danger'"
      />
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-success">Tes meilleurs contres</p>
        <ol v-if="matchups.bestMatchups.length > 0" class="space-y-2">
          <li
            v-for="(combo, index) in matchups.bestMatchups"
            :key="`best-${combo.myHeroId}-${combo.friendHeroId}`"
            class="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
          >
            <span class="w-5 shrink-0 text-center text-sm">{{ medals[index] }}</span>
            <span class="min-w-0 flex-1 truncate text-sm">
              <span class="font-medium text-brand">{{ combo.myHeroName }}</span>
              <span class="mx-1 text-muted">vs</span>
              <span class="font-medium text-accent">{{ combo.friendHeroName }}</span>
            </span>
            <span class="shrink-0 font-mono text-xs text-success">
              {{ formatPercent(combo.winrate) }} · {{ combo.gamesPlayed }} partie{{ combo.gamesPlayed > 1 ? "s" : "" }}
            </span>
          </li>
        </ol>
        <p v-else class="rounded-lg border border-border bg-surface p-4 text-center text-sm text-muted">
          Pas encore assez de face-à-face pour dégager un contre fiable.
        </p>
      </div>

      <div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-danger">Ce qui te bat</p>
        <ol v-if="matchups.worstMatchups.length > 0" class="space-y-2">
          <li
            v-for="(combo, index) in matchups.worstMatchups"
            :key="`worst-${combo.myHeroId}-${combo.friendHeroId}`"
            class="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
          >
            <span class="w-5 shrink-0 text-center text-sm">{{ medals[index] }}</span>
            <span class="min-w-0 flex-1 truncate text-sm">
              <span class="font-medium text-brand">{{ combo.myHeroName }}</span>
              <span class="mx-1 text-muted">vs</span>
              <span class="font-medium text-accent">{{ combo.friendHeroName }}</span>
            </span>
            <span class="shrink-0 font-mono text-xs text-danger">
              {{ formatPercent(combo.winrate) }} · {{ combo.gamesPlayed }} partie{{ combo.gamesPlayed > 1 ? "s" : "" }}
            </span>
          </li>
        </ol>
        <p v-else class="rounded-lg border border-border bg-surface p-4 text-center text-sm text-muted">
          Pas encore assez de face-à-face pour dégager une faiblesse fiable.
        </p>
      </div>
    </div>

    <NuxtLink
      v-if="opponentBattletag && matchups.gamesPlayed > 0"
      :to="`/matches?opponentBattletag=${encodeURIComponent(opponentBattletag)}`"
      class="inline-flex items-center gap-1 text-sm text-brand hover:underline"
    >
      Voir nos parties l'un contre l'autre &rarr;
    </NuxtLink>
  </div>
</template>
