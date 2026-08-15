<script setup lang="ts">
import type { FaceAFaceOverviewStats } from "@hots-stats/shared-types";
import type { TooltipItem } from "chart.js";

const props = defineProps<{
  me: FaceAFaceOverviewStats;
  friend: FaceAFaceOverviewStats;
  meName: string;
  friendName: string;
}>();

const themeColor = useChartThemeColor();

interface Axis {
  label: string;
  meRaw: number;
  friendRaw: number;
  meDisplay: string;
  friendDisplay: string;
}

// "Survie" is 1/avgDeaths (fewer deaths = better) rather than mixing in
// damageTaken/healing -- those measure "absorbs a lot" (a tank's job, not
// necessarily survival) and would make the axis harder to explain at a glance.
const axes = computed<Axis[]>(() => {
  const fmtNum = (value: number) => Math.round(value).toLocaleString("fr-FR");
  const meDamage = props.me.avgHeroDamage + props.me.avgSiegeDamage;
  const friendDamage = props.friend.avgHeroDamage + props.friend.avgSiegeDamage;

  return [
    {
      label: "Dégâts",
      meRaw: meDamage,
      friendRaw: friendDamage,
      meDisplay: fmtNum(meDamage),
      friendDisplay: fmtNum(friendDamage),
    },
    {
      label: "Survie",
      meRaw: 1 / Math.max(1, props.me.avgDeaths),
      friendRaw: 1 / Math.max(1, props.friend.avgDeaths),
      meDisplay: `${formatAvg(props.me.avgDeaths)} morts/partie`,
      friendDisplay: `${formatAvg(props.friend.avgDeaths)} morts/partie`,
    },
    {
      label: "Macro / XP",
      meRaw: props.me.avgExperienceContribution,
      friendRaw: props.friend.avgExperienceContribution,
      meDisplay: fmtNum(props.me.avgExperienceContribution),
      friendDisplay: fmtNum(props.friend.avgExperienceContribution),
    },
    {
      label: "Teamfights",
      meRaw: props.me.avgKillParticipation,
      friendRaw: props.friend.avgKillParticipation,
      meDisplay: formatPercent(props.me.avgKillParticipation),
      friendDisplay: formatPercent(props.friend.avgKillParticipation),
    },
  ];
});

const hasData = computed(() => props.me.gamesPlayed > 0 || props.friend.gamesPlayed > 0);

// Normalized per-axis, relative to the max of the two sides *for that axis
// only* (never a shared max across axes -- damage is in the tens of
// thousands, kill participation is a 0-1 ratio, so a shared max would make
// Damage always read ~100 and Teamfights always read ~0).
function normalize(raw: number, other: number): number {
  const max = Math.max(raw, other);
  return max > 0 ? (raw / max) * 100 : 0;
}

const chartData = computed(() => ({
  labels: axes.value.map((axis) => axis.label),
  datasets: [
    {
      label: props.meName,
      data: axes.value.map((axis) => normalize(axis.meRaw, axis.friendRaw)),
      borderColor: themeColor("--color-primary"),
      backgroundColor: themeColor("--color-primary", 0.25),
      pointBackgroundColor: themeColor("--color-primary"),
      borderWidth: 2,
    },
    {
      label: props.friendName,
      data: axes.value.map((axis) => normalize(axis.friendRaw, axis.meRaw)),
      borderColor: themeColor("--color-accent"),
      backgroundColor: themeColor("--color-accent", 0.25),
      pointBackgroundColor: themeColor("--color-accent"),
      borderWidth: 2,
    },
  ],
}));

const chartOptions = computed(() => ({
  scales: {
    r: {
      min: 0,
      max: 100,
      ticks: { display: false, stepSize: 25 },
      grid: { color: themeColor("--color-border") },
      angleLines: { color: themeColor("--color-border") },
      pointLabels: { color: themeColor("--color-foreground"), font: { size: 12 } },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: TooltipItem<"radar">) => {
          const axis = axes.value[ctx.dataIndex];
          if (!axis) return "";
          const display = ctx.datasetIndex === 0 ? axis.meDisplay : axis.friendDisplay;
          return `${ctx.dataset.label} : ${display}`;
        },
      },
    },
  },
}));
</script>

<template>
  <div class="rounded-lg border border-border bg-surface p-4">
    <div class="h-72 sm:h-80">
      <p v-if="!hasData" class="flex h-full items-center justify-center text-center text-sm text-muted">
        Pas encore assez de parties pour comparer vos styles de jeu.
      </p>
      <ChartsRadarChart v-else :data="chartData" :options="chartOptions" />
    </div>
  </div>
</template>
