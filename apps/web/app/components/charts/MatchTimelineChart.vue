<script setup lang="ts">
import {
  buildMatchTimelineSummary,
  deathMarkerRadius,
  timelineLeadMax,
  timelineLeadY,
  timelineTeamLabels,
  timelineX,
} from "~/composables/useMatchTimelineSeries";
import type { MatchTimelineSeries } from "~/types/coach";
import { ALLY_TEAM_RGB, ENEMY_TEAM_RGB } from "~/utils/spatialColors";

const props = withDefaults(
  defineProps<{
    series: MatchTimelineSeries;
    /** Match length, the x-axis domain (never the last snapshot's time). */
    durationSeconds: number;
    /** Current scrub position in seconds (v-model:scrub-seconds); null hides the scrub line. */
    scrubSeconds?: number | null;
    /** The viewer's team, so the sides are named/coloured rather than numbered; null when the viewer isn't in this match. */
    allyTeam?: 0 | 1 | null;
  }>(),
  { scrubSeconds: null, allyTeam: null },
);

const emit = defineEmits<{
  "update:scrubSeconds": [value: number];
}>();

// Wide viewBox; the default preserveAspectRatio (xMidYMid meet) keeps every
// circle round when the SVG stretches to the panel width.
const WIDTH = 800;
const HEIGHT = 240;
const LEAD_TOP = 16;
const LEAD_BOTTOM = 140;
const LEAD_MID = (LEAD_TOP + LEAD_BOTTOM) / 2;
const LEAD_HALF = (LEAD_BOTTOM - LEAD_TOP) / 2;
const TEAM0_ROW_Y = 166;
const TEAM1_ROW_Y = 190;
const STRUCTURE_ROW_Y = 214;

const labels = computed(() => timelineTeamLabels(props.allyTeam));

const teamColors = computed<[string, string]>(() => {
  const ally = "rgb(" + ALLY_TEAM_RGB.join(", ") + ")";
  const enemy = "rgb(" + ENEMY_TEAM_RGB.join(", ") + ")";
  // Team 0 is the ally colour by default; when the viewer is on team 1 the
  // colours swap so the viewer's own team keeps the ally colour, exactly like
  // the heatmaps' "Par équipe" mode.
  return props.allyTeam === 1 ? [enemy, ally] : [ally, enemy];
});

const leadMax = computed(() => timelineLeadMax(props.series.points));

const leadPoints = computed(() =>
  props.series.points.map((point) => ({
    ...point,
    x: timelineX(point.atSeconds, props.durationSeconds, WIDTH),
    y: timelineLeadY(point.lead, leadMax.value, LEAD_MID, LEAD_HALF),
  })),
);

const leadPolyline = computed(() => leadPoints.value.map((point) => point.x + "," + point.y).join(" "));

const leadArea = computed(() => {
  const points = leadPoints.value;
  if (points.length === 0) return "";
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return (
    "M " + first.x + "," + LEAD_MID +
    " L " + points.map((point) => point.x + "," + point.y).join(" L ") +
    " L " + last.x + "," + LEAD_MID + " Z"
  );
});

const deathMarkers = computed(() =>
  props.series.deaths.map((marker) => ({
    ...marker,
    x: timelineX(marker.atSeconds, props.durationSeconds, WIDTH),
    y: marker.team === 0 ? TEAM0_ROW_Y : TEAM1_ROW_Y,
    radius: deathMarkerRadius(marker.deaths),
    color: teamColors.value[marker.team],
  })),
);

const structureMarkers = computed(() =>
  props.series.structures.map((event) => ({
    ...event,
    x: timelineX(event.atSeconds, props.durationSeconds, WIDTH),
  })),
);

const scrubX = computed(() =>
  props.scrubSeconds === null ? null : timelineX(props.scrubSeconds, props.durationSeconds, WIDTH),
);

const summary = computed(() => buildMatchTimelineSummary(props.series, labels.value));
const hasMarkers = computed(() => props.series.deaths.length > 0 || props.series.structures.length > 0);
const showChart = computed(() => props.series.hasLevelData || hasMarkers.value);
const sliderMax = computed(() => Math.max(0, Math.floor(props.durationSeconds)));

function onScrub(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  emit("update:scrubSeconds", Number.isFinite(value) ? value : 0);
}
</script>

<template>
  <div class="space-y-3">
    <UiStateCard
      v-if="!series.hasLevelData"
      state="empty"
      size="sm"
      message="Données de niveau absentes pour cette partie : la courbe d'avance/retard ne peut pas être tracée (partie analysée avant l'extraction des niveaux, ou niveaux incomplets)."
    />

    <svg
      v-if="showChart"
      :viewBox="'0 0 ' + WIDTH + ' ' + HEIGHT"
      class="h-56 w-full"
      role="img"
      :aria-label="series.hasLevelData ? summary : 'Chronologie des morts et des structures de cette partie.'"
    >
      <template v-if="series.hasLevelData">
        <line
          x1="0"
          :y1="LEAD_MID"
          :x2="WIDTH"
          :y2="LEAD_MID"
          class="text-border"
          stroke="currentColor"
          stroke-width="1"
          stroke-dasharray="4 4"
        />
        <path :d="leadArea" class="text-brand" fill="currentColor" fill-opacity="0.12" />
        <polyline
          v-if="leadPoints.length > 1"
          :points="leadPolyline"
          fill="none"
          class="text-brand"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <circle
          v-else-if="leadPoints.length === 1"
          :cx="leadPoints[0]!.x"
          :cy="leadPoints[0]!.y"
          r="3"
          class="text-brand"
          fill="currentColor"
        />
      </template>

      <circle
        v-for="(marker, index) in deathMarkers"
        :key="'death-' + index"
        :cx="marker.x"
        :cy="marker.y"
        :r="marker.radius"
        :fill="marker.color"
        fill-opacity="0.85"
        stroke="rgba(0, 0, 0, 0.6)"
        stroke-width="1"
      >
        <title>{{ marker.deaths }} mort(s) {{ marker.team === 0 ? labels.team0 : labels.team1 }} à {{ formatDuration(marker.atSeconds) }}</title>
      </circle>

      <rect
        v-for="(event, index) in structureMarkers"
        :key="'structure-' + index"
        :x="event.x - 4"
        :y="STRUCTURE_ROW_Y - 4"
        width="8"
        height="8"
        fill="currentColor"
        fill-opacity="0.7"
        class="text-muted"
      >
        <title>{{ event.structureType }} détruit à {{ formatDuration(event.atSeconds) }} ({{ event.team === 0 ? labels.team0 : labels.team1 }}) — détection best-effort</title>
      </rect>

      <line
        v-if="scrubX !== null"
        :x1="scrubX"
        y1="6"
        :x2="scrubX"
        :y2="STRUCTURE_ROW_Y + 8"
        class="text-foreground"
        stroke="currentColor"
        stroke-width="1"
        stroke-dasharray="3 3"
      />

      <text x="0" :y="HEIGHT - 4" fill="currentColor" class="text-muted" font-size="12">0:00</text>
      <text :x="WIDTH" :y="HEIGHT - 4" fill="currentColor" class="text-muted" font-size="12" text-anchor="end">
        {{ formatDuration(durationSeconds) }}
      </text>
    </svg>

    <template v-if="series.hasLevelData">
      <div class="flex flex-wrap items-center gap-3 text-[11px] text-muted">
        <span class="flex items-center gap-1.5">
          <span class="h-2 w-2 rounded-full" :style="{ background: teamColors[0] }" />
          {{ labels.team0 }}
        </span>
        <span class="flex items-center gap-1.5">
          <span class="h-2 w-2 rounded-full" :style="{ background: teamColors[1] }" />
          {{ labels.team1 }}
        </span>
        <span v-if="series.deaths.length > 0">Morts : la taille du point = morts groupées</span>
        <span v-if="series.structures.length > 0">Structures détruites : {{ series.structures.length }} (best-effort)</span>
      </div>

      <label class="flex flex-col gap-1 text-xs text-muted">
        <span>Position dans la chronologie : {{ formatDuration(scrubSeconds ?? durationSeconds) }}</span>
        <input
          type="range"
          min="0"
          :max="sliderMax"
          step="1"
          :value="scrubSeconds ?? sliderMax"
          aria-label="Position dans la chronologie de la partie"
          @input="onScrub"
        />
      </label>
    </template>

    <p v-else-if="hasMarkers" class="text-[11px] text-muted">
      Morts et structures restent tracées ci-dessus ; seule la courbe de niveaux est indisponible.
    </p>
  </div>
</template>
