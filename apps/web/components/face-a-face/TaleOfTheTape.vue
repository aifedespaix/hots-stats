<script setup lang="ts">
import type { FaceAFaceOverviewStats } from "@hots-stats/shared-types";

const props = defineProps<{
  me: FaceAFaceOverviewStats;
  friend: FaceAFaceOverviewStats;
  meName: string;
  friendName: string;
}>();

interface Row {
  label: string;
  meValue: string;
  friendValue: string;
  meWins: boolean;
  friendWins: boolean;
}

function winner(meValue: number, friendValue: number): { meWins: boolean; friendWins: boolean } {
  if (meValue === friendValue) return { meWins: false, friendWins: false };
  return meValue > friendValue ? { meWins: true, friendWins: false } : { meWins: false, friendWins: true };
}

const rows = computed<Row[]>(() => [
  {
    label: "Winrate",
    meValue: formatPercent(props.me.winrate),
    friendValue: formatPercent(props.friend.winrate),
    ...winner(props.me.winrate, props.friend.winrate),
  },
  {
    label: "KDA",
    meValue: formatAvg(props.me.kda),
    friendValue: formatAvg(props.friend.kda),
    ...winner(props.me.kda, props.friend.kda),
  },
  {
    label: "Parties jouées",
    meValue: String(props.me.gamesPlayed),
    friendValue: String(props.friend.gamesPlayed),
    ...winner(props.me.gamesPlayed, props.friend.gamesPlayed),
  },
  {
    label: "Temps de jeu",
    meValue: formatTotalPlaytime(props.me.totalDurationSeconds),
    friendValue: formatTotalPlaytime(props.friend.totalDurationSeconds),
    ...winner(props.me.totalDurationSeconds, props.friend.totalDurationSeconds),
  },
]);
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-border bg-surface">
    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border bg-background/40 px-3 py-2 sm:px-4">
      <span class="truncate text-right text-xs font-semibold text-brand">{{ meName }}</span>
      <span class="px-1" />
      <span class="truncate text-xs font-semibold text-accent">{{ friendName }}</span>
    </div>

    <div
      v-for="row in rows"
      :key="row.label"
      class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border px-3 py-3 last:border-0 sm:gap-4 sm:px-4"
    >
      <div class="flex items-center justify-end gap-1.5 text-right">
        <UIcon v-if="row.meWins" name="i-heroicons-trophy" class="h-4 w-4 shrink-0 text-brand" />
        <span
          class="truncate font-mono text-base font-semibold sm:text-lg"
          :class="row.meWins ? 'text-brand' : 'text-foreground'"
        >
          {{ row.meValue }}
        </span>
      </div>

      <span class="px-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted sm:text-xs">
        {{ row.label }}
      </span>

      <div class="flex items-center gap-1.5">
        <span
          class="truncate font-mono text-base font-semibold sm:text-lg"
          :class="row.friendWins ? 'text-accent' : 'text-foreground'"
        >
          {{ row.friendValue }}
        </span>
        <UIcon v-if="row.friendWins" name="i-heroicons-trophy" class="h-4 w-4 shrink-0 text-accent" />
      </div>
    </div>
  </div>
</template>
