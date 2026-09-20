<script setup lang="ts">
import type { MatchObjectiveEvent } from "@hots-stats/shared-types";
import { timelineTeamLabels } from "~/composables/useMatchTimelineSeries";
import { formatClock } from "~/utils/heatmapCellDetails";
import { objectiveEventLabel, objectiveSideLabel } from "~/utils/objectiveEvents";
import { ALLY_TEAM_RGB, ENEMY_TEAM_RGB } from "~/utils/spatialColors";

const props = withDefaults(
  defineProps<{
    objectives: MatchObjectiveEvent[];
    durationSeconds: number;
    allyTeam?: 0 | 1 | null;
  }>(),
  { allyTeam: null },
);

/** Matches the chart's own 800-unit viewBox so markers line up vertically. */
const WIDTH = 800;
const HEIGHT = 36;

const labels = computed(() => timelineTeamLabels(props.allyTeam));

const teamColors = computed<[string, string]>(() => {
  const ally = "rgb(" + ALLY_TEAM_RGB.join(", ") + ")";
  const enemy = "rgb(" + ENEMY_TEAM_RGB.join(", ") + ")";
  return props.allyTeam === 1 ? [enemy, ally] : [ally, enemy];
});

/** Marker x from the real elapsed time -- never an invented position. */
function markerX(atSeconds: number): number {
  const ratio = props.durationSeconds > 0 ? Math.min(1, Math.max(0, atSeconds / props.durationSeconds)) : 0;
  return ratio * WIDTH;
}

function markerColor(team: 0 | 1 | null): string {
  if (team === null) return "rgb(148, 163, 184)";
  return teamColors.value[team]!;
}
</script>

<template>
  <section class="rounded-lg border border-border bg-surface p-4">
    <h3 class="text-sm font-semibold text-foreground">Objectifs et camps</h3>

    <UiStateCard
      v-if="objectives.length === 0"
      state="empty"
      size="sm"
      message="Aucun objectif ni camp enregistré pour cette partie."
    />

    <template v-else>
      <svg
        class="mt-3 w-full"
        :viewBox="'0 0 ' + WIDTH + ' ' + HEIGHT"
        role="img"
        aria-label="Chronologie des objectifs et camps de la partie"
      >
        <line :x1="0" :y1="HEIGHT / 2" :x2="WIDTH" :y2="HEIGHT / 2" stroke="rgb(148, 163, 184)" stroke-width="2" />
        <circle
          v-for="(objective, index) in objectives"
          :key="index"
          :cx="markerX(objective.atSeconds)"
          :cy="HEIGHT / 2"
          r="6"
          :fill="markerColor(objective.team)"
        />
      </svg>

      <ul class="mt-3 flex flex-col gap-1 text-sm">
        <li v-for="(objective, index) in objectives" :key="index" class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-muted">{{ formatClock(objective.atSeconds) }}</span>
          <span
            class="inline-block h-2 w-2 rounded-full"
            :style="{ backgroundColor: markerColor(objective.team) }"
            aria-hidden="true"
          />
          <span class="text-foreground">{{ objectiveEventLabel(objective) }}</span>
          <span class="text-muted">— {{ objectiveSideLabel(objective.team, labels) }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>
