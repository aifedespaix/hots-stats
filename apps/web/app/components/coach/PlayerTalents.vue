<script setup lang="ts">
import type { MatchDetailPlayer } from "~/types/matches";

defineProps<{
  players: MatchDetailPlayer[];
}>();
</script>

<template>
  <div class="space-y-3">
    <h2 class="font-heading text-lg font-medium">Talents</h2>
    <div v-for="player in players" :key="player.id" class="rounded-lg border border-border bg-surface p-4">
      <p class="text-sm font-medium">
        {{ player.heroName }} <span class="font-mono text-xs text-muted">({{ player.battletag }})</span>
      </p>
      <div v-if="player.talents.length > 0" class="mt-2 flex flex-wrap gap-2">
        <div v-for="tier in TALENT_TIER_LEVELS" :key="tier" class="rounded border border-border px-2 py-1 text-xs">
          <span class="text-muted">{{ tier }}:</span>
          {{ formatTalentName(player.talents.find((t) => t.tier === tier)?.talentName ?? "-", player.heroName) }}
        </div>
      </div>
    </div>
  </div>
</template>
