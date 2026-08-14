<script setup lang="ts">
import type { HeroMatchupEntry } from "@hots-stats/shared-types";

defineProps<{
  title: string;
  tone: "success" | "danger";
  entries: HeroMatchupEntry[];
  emptyMessage: string;
}>();

const medals = ["🥇", "🥈", "🥉"];
</script>

<template>
  <div>
    <p class="mb-2 text-xs font-semibold uppercase tracking-wide" :class="tone === 'success' ? 'text-success' : 'text-danger'">
      {{ title }}
    </p>
    <ol v-if="entries.length > 0" class="space-y-2">
      <li
        v-for="(entry, index) in entries"
        :key="entry.heroId"
        class="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
        :class="{ 'opacity-70': entry.smallSample }"
      >
        <span class="w-5 shrink-0 text-center text-sm">{{ medals[index] }}</span>
        <HeroesHeroAvatar :hero-id="entry.heroId" :name="entry.heroName" :role="entry.heroRole" :size="28" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium">{{ entry.heroName }}</span>
          <span class="block text-xs text-muted">{{ formatHeroRole(entry.heroRole) }}</span>
        </span>
        <span class="shrink-0 text-right">
          <span
            class="block font-mono text-sm font-semibold"
            :class="entry.smallSample ? 'text-muted' : tone === 'success' ? 'text-success' : 'text-danger'"
          >
            {{ formatSignedPercent(entry.deltaWinrate) }}
          </span>
          <span class="block font-mono text-xs text-muted">
            {{ formatPercent(entry.winrate) }} · {{ entry.gamesPlayed }} partie{{ entry.gamesPlayed > 1 ? "s" : "" }}
            <template v-if="entry.smallSample"> · échantillon faible</template>
          </span>
        </span>
      </li>
    </ol>
    <p v-else class="rounded-lg border border-border bg-surface p-4 text-center text-sm text-muted">
      {{ emptyMessage }}
    </p>
  </div>
</template>
