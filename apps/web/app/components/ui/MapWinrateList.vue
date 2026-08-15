<script setup lang="ts">
export interface MapWinrateEntry {
  mapId: string;
  mapName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winrate: number;
}

const props = defineProps<{ maps: MapWinrateEntry[] }>();

const sorted = computed(() => [...props.maps].sort((a, b) => b.gamesPlayed - a.gamesPlayed));
</script>

<template>
  <div class="rounded-lg border border-border bg-surface p-4">
    <ol v-if="sorted.length > 0" class="space-y-3">
      <li v-for="map in sorted" :key="map.mapId" class="text-sm">
        <div class="mb-1 flex items-center justify-between gap-2">
          <span class="min-w-0 truncate font-medium">{{ map.mapName }}</span>
          <span class="shrink-0 font-mono text-xs text-muted">
            {{ map.wins }}V / {{ map.losses }}D · {{ map.gamesPlayed }} partie{{ map.gamesPlayed > 1 ? "s" : "" }}
          </span>
        </div>
        <UiWinrateBar :winrate="map.winrate" />
      </li>
    </ol>
    <p v-else class="py-2 text-sm text-muted">-</p>
  </div>
</template>
