<script setup lang="ts">
import type { FaceAFaceSignatureHero } from "@hots-stats/shared-types";

defineProps<{
  me: FaceAFaceSignatureHero[];
  friend: FaceAFaceSignatureHero[];
  meName: string;
  friendName: string;
}>();
</script>

<template>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <div>
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-brand">{{ meName }}</p>
      <div class="space-y-2">
        <div v-for="hero in me" :key="hero.heroId" class="rounded-lg border border-l-4 border-border border-l-brand bg-surface p-3">
          <div class="flex items-center justify-between gap-2">
            <p class="truncate font-medium">{{ hero.heroName }}</p>
            <span
              v-if="hero.smallSample"
              class="shrink-0 rounded-full bg-background px-2 py-0.5 text-[10px] text-muted"
              title="Moins de 5 parties jouées : échantillon réduit"
            >
              Peu de parties
            </span>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span :class="hero.winrate >= 0.5 ? 'text-success' : 'text-danger'">
              {{ formatPercent(hero.winrate) }} winrate
            </span>
            <span>KDA {{ formatAvg(hero.kda) }}</span>
            <span>{{ hero.gamesPlayed }} partie{{ hero.gamesPlayed > 1 ? "s" : "" }}</span>
          </div>
        </div>
        <p v-if="me.length === 0" class="rounded-lg border border-border bg-surface p-4 text-center text-sm text-muted">
          Pas encore de héros signature.
        </p>
      </div>
    </div>

    <div>
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-accent">{{ friendName }}</p>
      <div class="space-y-2">
        <div
          v-for="hero in friend"
          :key="hero.heroId"
          class="rounded-lg border border-l-4 border-border border-l-accent bg-surface p-3"
        >
          <div class="flex items-center justify-between gap-2">
            <p class="truncate font-medium">{{ hero.heroName }}</p>
            <span
              v-if="hero.smallSample"
              class="shrink-0 rounded-full bg-background px-2 py-0.5 text-[10px] text-muted"
              title="Moins de 5 parties jouées : échantillon réduit"
            >
              Peu de parties
            </span>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span :class="hero.winrate >= 0.5 ? 'text-success' : 'text-danger'">
              {{ formatPercent(hero.winrate) }} winrate
            </span>
            <span>KDA {{ formatAvg(hero.kda) }}</span>
            <span>{{ hero.gamesPlayed }} partie{{ hero.gamesPlayed > 1 ? "s" : "" }}</span>
          </div>
        </div>
        <p v-if="friend.length === 0" class="rounded-lg border border-border bg-surface p-4 text-center text-sm text-muted">
          Pas encore de héros signature.
        </p>
      </div>
    </div>
  </div>
</template>
