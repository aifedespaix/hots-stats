<script setup lang="ts">
interface AccountSummary {
  winrate: number | null;
  gamesPlayed: number;
  wins: number;
}

// The summary can be undefined while it's still loading (most callers await
// their own fetch before rendering this, but a couple render it eagerly) --
// accepting `null | undefined` keeps every caller from having to wrap this
// component in its own `v-if`.
const props = withDefaults(
  defineProps<{ summary?: AccountSummary | null; loading?: boolean }>(),
  { summary: null, loading: false },
);
</script>

<template>
  <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
    <template v-if="loading && !summary">
      <UiSkeletonBlock v-for="i in 4" :key="i" class="h-[86px] rounded-lg border border-border bg-surface" />
    </template>
    <template v-else>
      <UiStatTile
        label="Winrate"
        :value="summary ? formatPercent(summary.winrate ?? 0) : '-'"
        :tone="winrateTone(summary?.winrate)"
      />
      <UiStatTile label="Parties jouées" :value="summary ? String(summary.gamesPlayed) : '-'" />
      <UiStatTile label="Victoires" :value="summary ? String(summary.wins) : '-'" />
      <!-- The Dashboard fills this 4th cell (sparkline tile) so the 4-column
      grid keeps its shape without the removed duration tile. Callers without
      slot content simply render three tiles. -->
      <slot />
    </template>
  </div>
</template>
