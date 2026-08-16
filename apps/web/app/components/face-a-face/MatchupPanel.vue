<script setup lang="ts">
import type { FaceAFaceMatchupStats } from "@hots-stats/shared-types";

const props = defineProps<{
  matchups: FaceAFaceMatchupStats;
  opponentBattletag: string | null;
}>();

const losses = computed(() => props.matchups.gamesPlayed - props.matchups.wins);

function toComboItems(combos: FaceAFaceMatchupStats["bestMatchups"], prefix: string) {
  return combos.map((combo) => ({
    id: `${prefix}-${combo.myHeroId}-${combo.friendHeroId}`,
    left: combo.myHeroName,
    right: combo.friendHeroName,
    winrate: combo.winrate,
    gamesPlayed: combo.gamesPlayed,
  }));
}

const bestComboItems = computed(() => toComboItems(props.matchups.bestMatchups, "best"));
const worstComboItems = computed(() => toComboItems(props.matchups.worstMatchups, "worst"));
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <UiStatTile label="Parties en ennemis" :value="String(matchups.gamesPlayed)" />
      <UiStatTile label="Bilan face à face" :value="`${matchups.wins}V / ${losses}D`" />
      <UiStatTile
        label="Winrate face à lui"
        :value="matchups.gamesPlayed > 0 ? formatPercent(matchups.winrate) : '-'"
        :tone="matchups.gamesPlayed === 0 ? 'default' : winrateTone(matchups.winrate)"
      />
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-success">Tes meilleurs contres</p>
        <StatsTopComboList
          :items="bestComboItems"
          tone="success"
          empty-text="Pas encore assez de face-à-face pour dégager un contre fiable."
        />
      </div>

      <div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-danger">Ce qui te bat</p>
        <StatsTopComboList
          :items="worstComboItems"
          tone="danger"
          empty-text="Pas encore assez de face-à-face pour dégager une faiblesse fiable."
        />
      </div>
    </div>

    <UiArrowLink
      v-if="opponentBattletag && matchups.gamesPlayed > 0"
      :to="`/matches?opponentBattletag=${encodeURIComponent(opponentBattletag)}`"
    >
      Voir nos parties l'un contre l'autre
    </UiArrowLink>
  </div>
</template>
