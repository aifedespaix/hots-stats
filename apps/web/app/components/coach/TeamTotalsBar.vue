<script setup lang="ts">
import type { ScoreboardRow } from "~/types/coach";

const props = defineProps<{
  myTeam: ScoreboardRow[];
  enemyTeam: ScoreboardRow[];
}>();

type TotalsKey = "kills" | "heroDamage" | "siegeDamage" | "healing" | "experienceContribution";

interface TotalsRow {
  key: TotalsKey;
  label: string;
}

const TOTALS_ROWS: TotalsRow[] = [
  { key: "kills", label: "Kills" },
  { key: "heroDamage", label: "Dégâts héros" },
  { key: "siegeDamage", label: "Dégâts de siège" },
  { key: "healing", label: "Soin" },
  { key: "experienceContribution", label: "Contribution XP" },
];

function sum(rows: ScoreboardRow[], key: TotalsKey): number {
  return rows.reduce((total, row) => total + row[key], 0);
}

const totals = computed(() =>
  TOTALS_ROWS.map((row) => {
    const mine = sum(props.myTeam, row.key);
    const theirs = sum(props.enemyTeam, row.key);
    const combined = mine + theirs;
    return { ...row, mine, theirs, myShare: combined > 0 ? mine / combined : 0.5 };
  }),
);
</script>

<template>
  <div class="rounded-lg border border-border bg-surface p-4">
    <div class="mb-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide">
      <span class="text-info">Ton équipe</span>
      <span class="text-muted">Comparatif d'équipe</span>
      <span class="text-danger">Équipe adverse</span>
    </div>
    <div class="space-y-2.5">
      <div v-for="row in totals" :key="row.key">
        <div class="mb-1 flex items-center justify-between text-sm">
          <span class="font-mono tabular-nums" :class="row.myShare >= 0.5 ? 'text-info' : 'text-muted'">
            {{ row.mine.toLocaleString() }}
          </span>
          <span class="text-[11px] text-muted">{{ row.label }}</span>
          <span class="font-mono tabular-nums" :class="row.myShare < 0.5 ? 'text-danger' : 'text-muted'">
            {{ row.theirs.toLocaleString() }}
          </span>
        </div>
        <div class="relative h-1.5 w-full overflow-hidden rounded-full bg-background">
          <span class="absolute inset-y-0 left-0 bg-info" :style="{ width: `${row.myShare * 100}%` }" />
          <span class="absolute inset-y-0 right-0 bg-danger" :style="{ width: `${(1 - row.myShare) * 100}%` }" />
        </div>
      </div>
    </div>
  </div>
</template>
