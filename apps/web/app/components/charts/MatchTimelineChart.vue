<script setup lang="ts">
import {
  buildMatchTimelineSummary,
  deathMarkerRadius,
  formatTimelineLevel,
  structureTypeLabel,
  timelineComparison,
  timelineLeadLabel,
  timelineLeadMax,
  timelineLeadY,
  timelineStateAt,
  timelineStructureLanes,
  timelineStructureMarkers,
  timelineStructureSideLabel,
  timelineTeamLabels,
  timelineX,
} from "~/composables/useMatchTimelineSeries";
import type { TimelineWindow } from "~/composables/useTimelineViewport";
import type { MatchTimelineFocus, MatchTimelineLane, MatchTimelineLeadPoint, MatchTimelineSeries } from "~/types/coach";
import { CLUSTER_TIME_WINDOW_SECONDS } from "~/utils/deathClustering";
import { ALLY_TEAM_RGB, ENEMY_TEAM_RGB } from "~/utils/spatialColors";

const props = withDefaults(
  defineProps<{
    series: MatchTimelineSeries;
    /** The match's full length -- the overview band's domain. */
    durationSeconds: number;
    /** The visible window, in seconds -- the main chart's domain. */
    window: TimelineWindow;
    /** Cursor position in seconds; the page shares this with the heatmap tab. */
    scrubSeconds: number;
    /** The viewer's team, so the sides are named/coloured rather than numbered; null when the viewer isn't in this match. */
    allyTeam?: 0 | 1 | null;
    /** "me" = my lane full height with the other nine as micro-lanes; "all" = ten named lanes. */
    laneMode?: "me" | "all";
    /** The death under the cursor, so its lane and marker are emphasised. */
    focus?: MatchTimelineFocus | null;
    /** Widest window the overview band shows its own curve on; below this it is a bare density strip. */
    isZoomed?: boolean;
  }>(),
  { allyTeam: null, laneMode: "me", focus: null, isZoomed: false },
);

const emit = defineEmits<{
  scrub: [seconds: number];
  "zoom-window": [window: TimelineWindow];
  "zoom-around": [payload: { anchorSeconds: number; factor: number }];
  pan: [deltaSeconds: number];
  "reset-zoom": [];
}>();

// A wide viewBox: the chart is sized by its width, so the lanes keep their
// relative heights instead of being letterboxed into a fixed pixel height.
const WIDTH = 800;
const HEIGHT = 380;
/** Lane labels live left of the track, so nothing is drawn over the data. */
const TRACK_LEFT = 132;
const TRACK_WIDTH = 660;
const LEAD_TOP = 22;
const LEAD_BOTTOM = 134;
const LEAD_MID = (LEAD_TOP + LEAD_BOTTOM) / 2;
const LEAD_HALF = (LEAD_BOTTOM - LEAD_TOP) / 2;
const LANES_TOP = 158;
const LANES_HEIGHT = 168;
const LANES_BOTTOM = LANES_TOP + LANES_HEIGHT;
/** Structure band: two rows (ally first) between the lanes and the axis. */
const STRUCTURE_TOP = 330;
const STRUCTURE_ROW_HEIGHT = 15;
const STRUCTURE_MARKER_SIZE = 9;
const STRUCTURE_MARKER_SLOT_STEP = 11;
const AXIS_Y = 368;
const OVERVIEW_HEIGHT = 26;
/** Below this a drag is a click, not a window selection. */
const MIN_DRAG_SECONDS = 2;

const labels = computed(() => timelineTeamLabels(props.allyTeam));

const teamColors = computed<[string, string]>(() => {
  const ally = "rgb(" + ALLY_TEAM_RGB.join(", ") + ")";
  const enemy = "rgb(" + ENEMY_TEAM_RGB.join(", ") + ")";
  // Team 0 is the ally colour by default; when the viewer is on team 1 the
  // colours swap so the viewer's own team keeps the ally colour, exactly like
  // the heatmaps' "Par équipe" mode.
  return props.allyTeam === 1 ? [enemy, ally] : [ally, enemy];
});

const span = computed(() => Math.max(0, props.window.endSeconds - props.window.startSeconds));

/** A timestamp to a pixel on the main track, clamped to the window. */
function trackX(atSeconds: number): number {
  return TRACK_LEFT + timelineX(atSeconds - props.window.startSeconds, span.value, TRACK_WIDTH);
}

/** A timestamp to a pixel on the overview band, clamped to the match. */
function overviewX(atSeconds: number): number {
  return timelineX(atSeconds, props.durationSeconds, WIDTH);
}

function clampSeconds(value: number): number {
  return Math.min(props.durationSeconds, Math.max(0, value));
}

// The lead domain comes from the whole match, not the visible window, so the
// curve does not rescale every time the window changes.
const leadMax = computed(() => timelineLeadMax(props.series.points));

/**
 * The points to draw: those inside the window, plus an opening point carrying
 * the levels known at the window's start (the same carried-forward step the
 * curve is built from -- never an interpolated value) so a fully zoomed-in
 * window still shows the state it opened on.
 */
const windowPoints = computed<MatchTimelineLeadPoint[]>(() => {
  const inside = props.series.points.filter(
    (point) => point.atSeconds > props.window.startSeconds && point.atSeconds <= props.window.endSeconds,
  );
  if (inside.length === 0) return [];
  const state = timelineStateAt(props.series, props.window.startSeconds);
  if (state.team0Level === null || state.team1Level === null || state.lead === null) return inside;
  return [
    {
      atSeconds: props.window.startSeconds,
      team0Level: state.team0Level,
      team1Level: state.team1Level,
      lead: state.lead,
    },
    ...inside,
  ];
});

const curvePoints = computed(() =>
  windowPoints.value.map((point) => ({
    x: trackX(point.atSeconds),
    y: timelineLeadY(point.lead, leadMax.value, LEAD_MID, LEAD_HALF),
  })),
);

const leadPolyline = computed(() => curvePoints.value.map((point) => point.x + "," + point.y).join(" "));

const leadArea = computed(() => {
  const points = curvePoints.value;
  if (points.length === 0) return "";
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return (
    "M " + first.x + "," + LEAD_MID +
    " L " + points.map((point) => point.x + "," + point.y).join(" L ") +
    " L " + last.x + "," + LEAD_MID + " Z"
  );
});

interface LaneRow {
  lane: MatchTimelineLane;
  y: number;
  height: number;
}

/**
 * The lane layout. Both modes fill exactly the same vertical band, so
 * switching "moi" / "les 10 joueurs" never makes the page jump: in "me" mode
 * my lane takes half of it and the other nine share the rest.
 */
const laneRows = computed<LaneRow[]>(() => {
  const lanes = props.series.lanes;
  if (lanes.length === 0) return [];
  if (props.laneMode === "all") {
    const rowHeight = LANES_HEIGHT / lanes.length;
    return lanes.map((lane, index) => ({ lane, y: LANES_TOP + index * rowHeight, height: rowHeight }));
  }
  const primary = lanes.find((lane) => lane.isMe) ?? null;
  const rest = lanes.filter((lane) => lane !== primary);
  if (primary === null) {
    const rowHeight = LANES_HEIGHT / Math.max(1, rest.length);
    return rest.map((lane, index) => ({ lane, y: LANES_TOP + index * rowHeight, height: rowHeight }));
  }
  const primaryHeight = LANES_HEIGHT / 2;
  const rowHeight = (LANES_HEIGHT - primaryHeight) / Math.max(1, rest.length);
  return [
    { lane: primary, y: LANES_TOP, height: primaryHeight },
    ...rest.map((lane, index) => ({
      lane,
      y: LANES_TOP + primaryHeight + index * rowHeight,
      height: rowHeight,
    })),
  ];
});

interface DeathDot {
  key: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  opacity: number;
  focused: boolean;
}

const deathDots = computed<DeathDot[]>(() => {
  const dots: DeathDot[] = [];
  for (const row of laneRows.value) {
    const color = teamColors.value[row.lane.team];
    const baseRadius = row.height >= 40 ? 5 : row.height >= 13 ? 3.4 : 2.4;
    for (const death of row.lane.deaths) {
      if (death.atSeconds < props.window.startSeconds || death.atSeconds > props.window.endSeconds) continue;
      const focused =
        props.focus?.victim.battletag === row.lane.battletag &&
        props.focus.victim.atSeconds === death.atSeconds;
      const near = Math.abs(death.atSeconds - props.scrubSeconds) <= CLUSTER_TIME_WINDOW_SECONDS;
      dots.push({
        key: row.lane.battletag + "-" + death.atSeconds,
        x: trackX(death.atSeconds),
        y: row.y + row.height / 2,
        radius: focused ? baseRadius + 1.6 : baseRadius,
        color,
        opacity: focused || near ? 0.95 : 0.28,
        focused,
      });
    }
  }
  return dots;
});

/**
 * The two structure rows (ally first) with their square markers. A square is
 * the shape language for a structure, exactly as a round pastille is for a
 * death, so the two can never be confused at a glance. Simultaneous
 * destructions are spread sideways instead of stacking on one pixel.
 */
const structureRows = computed(() => {
  const lanes = timelineStructureLanes(props.allyTeam, labels.value);
  const markers = timelineStructureMarkers(props.series.structures, props.window);
  return lanes.map((lane, index) => {
    const y = STRUCTURE_TOP + index * STRUCTURE_ROW_HEIGHT;
    const height = STRUCTURE_ROW_HEIGHT - 2;
    const center = y + height / 2;
    return {
      key: lane.side,
      label: lane.label,
      color: teamColors.value[lane.team],
      y,
      height,
      labelY: center + 3,
      markers: markers
        .filter((marker) => marker.team === lane.team)
        .map((marker) => {
          const size = marker.structureType === "core" ? STRUCTURE_MARKER_SIZE + 3 : STRUCTURE_MARKER_SIZE;
          const raw = trackX(marker.atSeconds) + marker.slot * STRUCTURE_MARKER_SLOT_STEP;
          const x = Math.min(TRACK_LEFT + TRACK_WIDTH - size / 2, Math.max(TRACK_LEFT + size / 2, raw));
          return {
            key: marker.key,
            x,
            y: center,
            size,
            color: teamColors.value[marker.team],
            side: timelineStructureSideLabel(marker.team, props.allyTeam),
            typeLabel: structureTypeLabel(marker.structureType),
          };
        }),
    };
  });
});

const hasStructures = computed(() => props.series.structures.length > 0);

/** Minute-ish gridlines, spaced to whatever keeps them readable at this zoom. */
const ticks = computed(() => {
  const spanSeconds = span.value;
  const step = spanSeconds <= 360 ? 30 : spanSeconds <= 900 ? 60 : spanSeconds <= 2400 ? 120 : 300;
  const list: { x: number; label: string }[] = [];
  for (let seconds = Math.ceil(props.window.startSeconds / step) * step; seconds <= props.window.endSeconds; seconds += step) {
    if (seconds < 0) continue;
    list.push({ x: trackX(seconds), label: formatDuration(seconds) });
  }
  return list;
});

const scrubVisible = computed(
  () => props.scrubSeconds >= props.window.startSeconds && props.scrubSeconds <= props.window.endSeconds,
);
const scrubX = computed(() => trackX(props.scrubSeconds));

const summary = computed(() => buildMatchTimelineSummary(props.series, labels.value));
const hasMarkers = computed(() => props.series.allDeaths.length > 0 || props.series.structures.length > 0);
const showChart = computed(() => props.series.hasLevelData || props.series.lanes.length > 0);
const ariaLabel = computed(() =>
  props.series.hasLevelData ? summary.value : "Chronologie des morts et des structures de cette partie.",
);

// --- pointer handling: hover drives the cursor, drag selects a window ------

const svg = ref<SVGSVGElement | null>(null);
const overview = ref<SVGSVGElement | null>(null);
const drag = ref<{ startSeconds: number; endSeconds: number; moved: boolean } | null>(null);

// --- hover card: the level comparison, drawn on the graph itself ----------

const wrap = ref<HTMLElement | null>(null);
/** Cursor position (and container size) in px relative to `wrap`; null while
 * the pointer is off the chart, which is what hides the card. */
const hover = ref<{ x: number; y: number; width: number; height: number } | null>(null);

const hoverComparison = computed(() => timelineComparison(props.series, props.scrubSeconds, labels.value));

const hoverStructures = computed(() =>
  hoverComparison.value.structures.map((event) => ({
    key: event.team + "-" + event.structureType + "-" + event.atSeconds,
    label: structureTypeLabel(event.structureType),
    side: timelineStructureSideLabel(event.team, props.allyTeam),
    color: teamColors.value[event.team],
  })),
);

const hoverLeaderColor = computed(() => {
  const leader = hoverComparison.value.leader;
  return leader === null ? null : teamColors.value[leader];
});

function trackHover(event: PointerEvent) {
  const element = wrap.value;
  if (!element) return;
  const rect = element.getBoundingClientRect();
  hover.value = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function clearHover() {
  hover.value = null;
}

/** Flip to whichever half the cursor is not in, so the card stays inside the
 * panel without measuring itself -- same rule as HeatmapCellTooltip.vue. */
const hoverCardStyle = computed(() => {
  const point = hover.value;
  if (!point) return {};
  const placeLeft = point.x > point.width / 2;
  const placeAbove = point.y > point.height / 2;
  return {
    left: point.x + "px",
    top: point.y + "px",
    transform:
      "translate(" +
      (placeLeft ? "calc(-100% - 14px)" : "14px") +
      ", " +
      (placeAbove ? "calc(-100% - 14px)" : "14px") +
      ")",
  };
});

function secondsAtClientX(clientX: number): number | null {
  const element = svg.value;
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0) return null;
  const x = ((clientX - rect.left) / rect.width) * WIDTH;
  const ratio = (x - TRACK_LEFT) / TRACK_WIDTH;
  return clampSeconds(props.window.startSeconds + ratio * span.value);
}

// One scrub per animation frame: the same value feeds the heatmap tab's
// highlight, and a raw pointermove would redraw it far faster than the browser
// paints.
let pendingScrub: number | null = null;
let scrubFrame: number | null = null;

function emitScrub(seconds: number) {
  if (typeof requestAnimationFrame !== "function") {
    emit("scrub", seconds);
    return;
  }
  pendingScrub = seconds;
  if (scrubFrame !== null) return;
  scrubFrame = requestAnimationFrame(() => {
    scrubFrame = null;
    const value = pendingScrub;
    pendingScrub = null;
    if (value !== null) emit("scrub", value);
  });
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  const seconds = secondsAtClientX(event.clientX);
  if (seconds === null) return;
  (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  drag.value = { startSeconds: seconds, endSeconds: seconds, moved: false };
}

function onPointerMove(event: PointerEvent) {
  const seconds = secondsAtClientX(event.clientX);
  if (seconds === null) return;
  const current = drag.value;
  if (current) {
    clearHover();
    drag.value = {
      ...current,
      endSeconds: seconds,
      moved: current.moved || Math.abs(seconds - current.startSeconds) > 1,
    };
    return;
  }
  trackHover(event);
  emitScrub(seconds);
}

function onPointerUp(event: PointerEvent) {
  const current = drag.value;
  drag.value = null;
  if (!current) return;
  const startSeconds = Math.min(current.startSeconds, current.endSeconds);
  const endSeconds = Math.max(current.startSeconds, current.endSeconds);
  if (current.moved && endSeconds - startSeconds >= MIN_DRAG_SECONDS) {
    emit("zoom-window", { startSeconds, endSeconds });
    return;
  }
  const seconds = secondsAtClientX(event.clientX);
  if (seconds !== null) emit("scrub", seconds);
}

function onWheel(event: WheelEvent) {
  const seconds = secondsAtClientX(event.clientX);
  if (seconds === null) return;
  emit("zoom-around", { anchorSeconds: seconds, factor: event.deltaY > 0 ? 1.25 : 0.8 });
}

const selection = computed(() => {
  const current = drag.value;
  if (!current || !current.moved) return null;
  const startSeconds = Math.min(current.startSeconds, current.endSeconds);
  const endSeconds = Math.max(current.startSeconds, current.endSeconds);
  const x = trackX(startSeconds);
  return { x, width: Math.max(1, trackX(endSeconds) - x) };
});

// --- overview band: drag the window to pan, drag elsewhere to recentre ------

let overviewDrag: { mode: "pan" | "recentre"; lastSeconds: number } | null = null;

function secondsAtOverview(clientX: number): number | null {
  const element = overview.value;
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0) return null;
  const x = ((clientX - rect.left) / rect.width) * WIDTH;
  return clampSeconds((x / WIDTH) * props.durationSeconds);
}

function recentreOn(seconds: number) {
  const half = span.value / 2;
  emit("zoom-window", { startSeconds: seconds - half, endSeconds: seconds + half });
}

function onOverviewDown(event: PointerEvent) {
  const seconds = secondsAtOverview(event.clientX);
  if (seconds === null) return;
  (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  const inside = seconds >= props.window.startSeconds && seconds <= props.window.endSeconds;
  overviewDrag = { mode: inside ? "pan" : "recentre", lastSeconds: seconds };
  if (!inside) recentreOn(seconds);
}

function onOverviewMove(event: PointerEvent) {
  if (!overviewDrag) return;
  const seconds = secondsAtOverview(event.clientX);
  if (seconds === null) return;
  if (overviewDrag.mode === "pan") emit("pan", seconds - overviewDrag.lastSeconds);
  else recentreOn(seconds);
  overviewDrag.lastSeconds = seconds;
}

function onOverviewUp() {
  overviewDrag = null;
}

/** The whole match at a glance, so the overview band shows where the lead went. */
const overviewPoints = computed(() => {
  if (props.series.points.length < 2 || props.durationSeconds <= 0) return "";
  const max = leadMax.value;
  return props.series.points
    .map((point) => overviewX(point.atSeconds) + "," + timelineLeadY(point.lead, max, OVERVIEW_HEIGHT / 2, OVERVIEW_HEIGHT / 2 - 3))
    .join(" ");
});

/** Team death clusters along the overview's own baseline, so the band answers
 * "where were the fights" and not only "who was ahead". */
const overviewClusters = computed(() =>
  props.series.deaths.map((cluster) => ({
    key: cluster.team + "-" + cluster.atSeconds,
    x: overviewX(cluster.atSeconds),
    y: OVERVIEW_HEIGHT - 4,
    radius: Math.min(3.5, deathMarkerRadius(cluster.deaths) / 2.5),
    color: teamColors.value[cluster.team],
  })),
);

const overviewWindow = computed(() => {
  const x = overviewX(props.window.startSeconds);
  return { x, width: Math.max(2, overviewX(props.window.endSeconds) - x) };
});

onBeforeUnmount(() => {
  if (scrubFrame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(scrubFrame);
});
</script>

<template>
  <div ref="wrap" class="relative flex min-h-0 flex-col gap-3">
    <UiStateCard
      v-if="!series.hasLevelData"
      state="empty"
      size="sm"
      message="Données de niveau absentes pour cette partie : la courbe d'avance/retard ne peut pas être tracée (partie analysée avant l'extraction des niveaux, ou niveaux incomplets)."
    />

    <svg
      v-if="showChart"
      ref="svg"
      :viewBox="'0 0 ' + WIDTH + ' ' + HEIGHT"
      class="h-auto w-full touch-pan-y select-none lg:min-h-0 lg:flex-1"
      role="img"
      :aria-label="ariaLabel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="clearHover"
      @dblclick="emit('reset-zoom')"
      @wheel.prevent="onWheel"
    >
      <!-- gridlines, behind everything -->
      <line
        v-for="tick in ticks"
        :key="'grid-' + tick.label"
        :x1="tick.x"
        :y1="LEAD_TOP"
        :x2="tick.x"
        :y2="LANES_BOTTOM"
        class="text-border"
        stroke="currentColor"
        stroke-opacity="0.5"
        stroke-width="1"
      />

      <!-- lead curve -->
      <template v-if="series.hasLevelData">
        <!-- Side bands: the upper half always means team 0 leads, the lower
             half team 1 -- readable without decoding the curve. -->
        <rect x="0" :y="LEAD_TOP" width="6" :height="LEAD_HALF" :fill="teamColors[0]" fill-opacity="0.85" />
        <rect x="0" :y="LEAD_MID" width="6" :height="LEAD_HALF" :fill="teamColors[1]" fill-opacity="0.85" />
        <text x="10" :y="LEAD_TOP + 14" :fill="teamColors[0]" font-size="10" font-weight="600">{{ labels.team0 }}</text>
        <text x="10" :y="LEAD_TOP + 25" class="text-muted" fill="currentColor" font-size="9">en tête</text>
        <text x="10" :y="LEAD_BOTTOM - 15" :fill="teamColors[1]" font-size="10" font-weight="600">{{ labels.team1 }}</text>
        <text x="10" :y="LEAD_BOTTOM - 4" class="text-muted" fill="currentColor" font-size="9">en tête</text>
        <text :x="TRACK_LEFT" :y="LEAD_TOP - 8" class="text-muted" fill="currentColor" font-size="10">
          avance en niveaux
        </text>
        <line
          :x1="TRACK_LEFT"
          :y1="LEAD_MID"
          :x2="TRACK_LEFT + TRACK_WIDTH"
          :y2="LEAD_MID"
          class="text-border"
          stroke="currentColor"
          stroke-width="1"
          stroke-dasharray="4 4"
        />
        <path :d="leadArea" class="text-brand" fill="currentColor" fill-opacity="0.14" />
        <polyline
          v-if="curvePoints.length > 1"
          :points="leadPolyline"
          fill="none"
          class="text-brand"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <circle
          v-else-if="curvePoints.length === 1"
          :cx="curvePoints[0]!.x"
          :cy="curvePoints[0]!.y"
          r="3"
          class="text-brand"
          fill="currentColor"
        />
      </template>

      <!-- lanes: one per player, my own lane first -->
      <g v-for="row in laneRows" :key="'lane-' + row.lane.battletag">
        <rect
          :x="TRACK_LEFT"
          :y="row.y"
          :width="TRACK_WIDTH"
          :height="row.height"
          :fill="teamColors[row.lane.team]"
          :fill-opacity="row.lane.isMe ? 0.1 : 0.04"
        />
        <line
          :x1="TRACK_LEFT"
          :y1="row.y + row.height"
          :x2="TRACK_LEFT + TRACK_WIDTH"
          :y2="row.y + row.height"
          class="text-border"
          stroke="currentColor"
          stroke-opacity="0.35"
          stroke-width="1"
        />
        <text
          x="8"
          :y="row.y + row.height / 2 + 3"
          :font-size="row.height >= 40 ? 12 : row.height >= 13 ? 10 : 7"
          :font-weight="row.lane.isMe ? 600 : 400"
          :fill="teamColors[row.lane.team]"
          :fill-opacity="row.lane.isMe ? 1 : 0.75"
        >
          {{ row.lane.heroName ?? row.lane.battletag }}<tspan v-if="row.lane.isMe"> (moi)</tspan>
        </text>
      </g>

      <!-- deaths -->
      <circle
        v-for="dot in deathDots"
        :key="dot.key"
        :cx="dot.x"
        :cy="dot.y"
        :r="dot.radius"
        :fill="dot.color"
        :fill-opacity="dot.opacity"
        :stroke="dot.focused ? 'currentColor' : 'rgba(0, 0, 0, 0.6)'"
        :stroke-width="dot.focused ? 2 : 1"
        :class="dot.focused ? 'text-foreground' : ''"
      />

      <!-- structures: one row per side, squares so they never read as players -->
      <g>
        <g v-for="row in structureRows" :key="'structure-row-' + row.key">
          <rect
            :x="TRACK_LEFT"
            :y="row.y"
            :width="TRACK_WIDTH"
            :height="row.height"
            :fill="row.color"
            fill-opacity="0.07"
          />
          <line
            :x1="TRACK_LEFT"
            :y1="row.y + row.height"
            :x2="TRACK_LEFT + TRACK_WIDTH"
            :y2="row.y + row.height"
            class="text-border"
            stroke="currentColor"
            stroke-opacity="0.35"
            stroke-width="1"
          />
          <text x="8" :y="row.labelY" font-size="9" font-weight="600" :fill="row.color" fill-opacity="0.9">
            {{ row.label }}
          </text>
          <rect
            v-for="marker in row.markers"
            :key="marker.key"
            :x="marker.x - marker.size / 2"
            :y="marker.y - marker.size / 2"
            :width="marker.size"
            :height="marker.size"
            :fill="marker.color"
            fill-opacity="0.95"
            stroke="rgba(0, 0, 0, 0.55)"
            stroke-width="1"
          >
            <title>{{ marker.typeLabel }} détruit — {{ marker.side }}</title>
          </rect>
        </g>
        <text
          v-if="!hasStructures"
          :x="TRACK_LEFT + 6"
          :y="STRUCTURE_TOP + STRUCTURE_ROW_HEIGHT - 2"
          class="text-muted"
          fill="currentColor"
          font-size="9"
          font-style="italic"
        >
          aucune destruction de structure enregistrée pour cette partie
        </text>
      </g>

      <!-- drag-to-zoom selection -->
      <rect
        v-if="selection"
        :x="selection.x"
        :y="LEAD_TOP"
        :width="selection.width"
        :height="LANES_BOTTOM - LEAD_TOP"
        class="text-brand"
        fill="currentColor"
        fill-opacity="0.16"
        stroke="currentColor"
        stroke-width="1"
      />

      <!-- cursor -->
      <line
        v-if="scrubVisible"
        :x1="scrubX"
        :y1="LEAD_TOP - 4"
        :x2="scrubX"
        :y2="AXIS_Y - 8"
        class="text-foreground"
        stroke="currentColor"
        stroke-width="1"
        stroke-dasharray="3 3"
      />

      <!-- time axis -->
      <line
        :x1="TRACK_LEFT"
        :y1="AXIS_Y - 8"
        :x2="TRACK_LEFT + TRACK_WIDTH"
        :y2="AXIS_Y - 8"
        class="text-border"
        stroke="currentColor"
        stroke-width="1"
      />
      <text
        v-for="tick in ticks"
        :key="'tick-' + tick.label"
        :x="tick.x"
        :y="AXIS_Y + 4"
        class="text-muted"
        fill="currentColor"
        font-size="10"
        text-anchor="middle"
      >
        {{ tick.label }}
      </text>
    </svg>

    <!-- hover card: the level comparison under the cursor -->
    <div
      v-if="showChart && hover"
      class="pointer-events-none absolute z-30 w-60 rounded-md border border-border bg-surface/95 p-2 text-[11px] leading-snug shadow-lg backdrop-blur-sm"
      :style="hoverCardStyle"
    >
      <div class="flex items-baseline justify-between gap-2">
        <span class="font-mono font-semibold text-foreground">{{ formatDuration(scrubSeconds) }}</span>
        <span v-if="!series.hasLevelData" class="text-[10px] text-muted">niveaux indisponibles</span>
      </div>

      <div v-if="series.hasLevelData" class="mt-1.5 space-y-1">
        <div v-for="row in hoverComparison.rows" :key="row.team" class="flex items-center gap-1.5">
          <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: teamColors[row.team] }" />
          <span class="truncate" :style="{ color: teamColors[row.team] }">{{ row.label }}</span>
          <span class="ml-auto font-heading text-sm font-semibold tabular-nums text-foreground">
            {{ row.level === null ? "—" : formatTimelineLevel(row.level) }}
          </span>
        </div>
      </div>

      <div
        v-if="hoverComparison.leadLabel"
        class="mt-1.5 rounded border px-1.5 py-0.5 text-[10px] font-medium"
        :class="hoverLeaderColor ? '' : 'border-border text-muted'"
        :style="hoverLeaderColor ? { borderColor: hoverLeaderColor, color: hoverLeaderColor } : undefined"
      >
        {{ hoverComparison.leadLabel }}
      </div>

      <div
        v-if="hoverStructures.length > 0 || hoverComparison.deaths.length > 0"
        class="mt-1.5 space-y-0.5 border-t border-border pt-1.5"
      >
        <div v-for="row in hoverStructures" :key="row.key" class="flex items-center gap-1.5">
          <span class="inline-block h-2 w-2 shrink-0 rounded-[2px]" :style="{ background: row.color }" />
          <span class="truncate text-foreground">{{ row.label }} détruit</span>
          <span class="ml-auto shrink-0 text-muted">{{ row.side }}</span>
        </div>
        <p v-if="hoverComparison.deaths.length > 0" class="text-muted">
          {{ hoverComparison.deaths.length }} mort{{ hoverComparison.deaths.length > 1 ? "s" : "" }} à cet instant
        </p>
      </div>
    </div>

    <!-- overview band: only while zoomed, since it is the way back out -->
    <svg
      v-if="showChart && isZoomed"
      ref="overview"
      :viewBox="'0 0 ' + WIDTH + ' ' + OVERVIEW_HEIGHT"
      class="h-6 w-full shrink-0 cursor-ew-resize touch-pan-y select-none"
      role="img"
      aria-label="Vue d'ensemble de la partie : courbe d'avance et morts par équipe. Glisser dans la fenêtre pour la déplacer, cliquer ailleurs pour la recentrer."
      @pointerdown="onOverviewDown"
      @pointermove="onOverviewMove"
      @pointerup="onOverviewUp"
      @pointercancel="onOverviewUp"
    >
      <rect x="0" y="0" width="800" :height="OVERVIEW_HEIGHT" class="text-border" fill="currentColor" fill-opacity="0.25" />
      <polyline v-if="overviewPoints" :points="overviewPoints" fill="none" class="text-brand" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.6" />
      <circle
        v-for="cluster in overviewClusters"
        :key="'overview-cluster-' + cluster.key"
        :cx="cluster.x"
        :cy="cluster.y"
        :r="cluster.radius"
        :fill="cluster.color"
        fill-opacity="0.9"
      />
      <rect
        x="0"
        y="0"
        width="800"
        :height="OVERVIEW_HEIGHT"
        fill="#000"
        fill-opacity="0.45"
      />
      <rect
        :x="overviewWindow.x"
        y="0"
        :width="overviewWindow.width"
        :height="OVERVIEW_HEIGHT"
        class="text-brand"
        fill="currentColor"
        fill-opacity="0.22"
        stroke="currentColor"
        stroke-width="1.5"
      />
    </svg>

    <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
      <span class="flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-full" :style="{ background: teamColors[0] }" />
        {{ labels.team0 }}
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-full" :style="{ background: teamColors[1] }" />
        {{ labels.team1 }}
      </span>
      <span v-if="hasMarkers" class="flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-full bg-current opacity-60" />
        une mort, sur la ligne du joueur
      </span>
      <span v-if="hasStructures" class="flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-[2px] bg-current opacity-60" />
        une structure détruite, sur la ligne de son camp
      </span>
      <span v-if="!series.hasLevelData">courbe de niveaux indisponible pour cette partie</span>
      <span class="hidden lg:ml-auto lg:inline">glisser = cadrer · molette = zoom · double-clic = toute la partie</span>
    </div>
  </div>
</template>
