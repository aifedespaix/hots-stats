import type { Grid } from "@hots-stats/shared-types";
import { cellIndexForPosition, incrementCell, mergeGrid } from "@hots-stats/shared-types";
// Explicit (not relying on Nuxt's auto-import) so this composable's pure
// logic is testable with plain `vitest` -- see `useHeatmapSync.test.ts`,
// the first frontend test file in this repo. Harmless under Nuxt itself:
// an explicit import simply takes precedence over the auto-import.
import { type ComputedRef, computed, ref } from "vue";
import type { MatchTimelineDeath, MatchTimelineLevelSnapshot, MatchTimelineStructureEvent } from "~/types/coach";
import type { MatchHeroTrajectory } from "~/types/spatial";
import { firstObjectiveSpawnSeconds } from "~/utils/objectiveTimers";

export type HeatmapPhase = "early" | "mid" | "late";
export type HeatmapEventType = "death" | "structure" | "objective";
export type HeatmapSyncMode = "progress" | "gameTime";
export type HeatmapWindowMode = "cumulative" | "phase" | "event";

/** Everything `useHeatmapSync` needs from one game -- deliberately decoupled
 * from `MatchDetailResponse`'s wire shape (the component maps it), so this
 * composable stays testable/reusable without a fetch in the loop. */
export interface HeatmapGameData {
  mapId: string;
  durationSeconds: number;
  trajectories: MatchHeroTrajectory[];
  levelSnapshots: MatchTimelineLevelSnapshot[];
  deaths: MatchTimelineDeath[];
  structureEvents: MatchTimelineStructureEvent[];
}

export interface HeatmapPathPoint {
  atSeconds: number;
  x: number;
  y: number;
}

export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const DEFAULT_GRID_COLS = 128;
const DEFAULT_GRID_ROWS = 128;
const MIN_SCALE = 1;
const MAX_SCALE = 8;

// HotS talent tiers double as the early/mid/late phase boundaries a pro
// player actually thinks in: level 10 (first heroic) and level 16 (last
// talent tier before 20) are the two inflection points that change how a
// team plays, far more than an arbitrary time cutoff would.
const PHASE_START_LEVEL: Record<HeatmapPhase, number> = { early: 1, mid: 10, late: 16 };
const PHASE_ORDER: HeatmapPhase[] = ["early", "mid", "late"];

function levelReachedAtSeconds(game: HeatmapGameData, battletag: string | null, level: number): number | null {
  if (level <= 1) return 0;
  const snapshot = game.levelSnapshots
    .filter((s) => battletag == null || s.battletag === battletag)
    .find((s) => s.level === level);
  return snapshot?.atSeconds ?? null;
}

/** `[start, end]` in seconds for `phase`, derived from `battletag`'s own
 * level-up timestamps (HotS levels are shared team-wide, so any teammate's
 * snapshots would agree -- using the tracked hero's own keeps this correct
 * even if `battletag` is ever null for a Slot with mixed heroes). Falls
 * back to `durationSeconds` for a boundary the match never reached (e.g. a
 * short game that ended before level 16), which naturally yields an empty
 * window for a phase that never happened rather than a bogus one. */
function phaseBounds(game: HeatmapGameData, battletag: string | null, phase: HeatmapPhase): [number, number] {
  const index = PHASE_ORDER.indexOf(phase);
  const nextPhase = PHASE_ORDER[index + 1];
  const start = levelReachedAtSeconds(game, battletag, PHASE_START_LEVEL[phase]) ?? game.durationSeconds;
  const end = nextPhase
    ? (levelReachedAtSeconds(game, battletag, PHASE_START_LEVEL[nextPhase]) ?? game.durationSeconds)
    : game.durationSeconds;
  return [Math.min(start, game.durationSeconds), Math.min(Math.max(end, start), game.durationSeconds)];
}

/** Every occurrence (in seconds) of `type` in `game`. `"objective"` has at
 * most one entry -- see `objectiveTimers.ts`'s own doc comment for why only
 * the first spawn is available, not a repeating schedule. */
function eventOccurrences(game: HeatmapGameData, type: HeatmapEventType): number[] {
  if (type === "death") return game.deaths.map((d) => d.atSeconds);
  if (type === "structure") return game.structureEvents.map((e) => e.atSeconds);
  const spawn = firstObjectiveSpawnSeconds(game.mapId, game.durationSeconds);
  return spawn === null ? [] : [spawn];
}

/** `[start, end]` windows, `before`/`after` seconds around every occurrence
 * of `type` -- e.g. "the 15s before and 5s after every death this game". */
function eventWindows(game: HeatmapGameData, type: HeatmapEventType, before: number, after: number): [number, number][] {
  return eventOccurrences(game, type).map(
    (t): [number, number] => [Math.max(0, t - before), Math.min(game.durationSeconds, t + after)],
  );
}

function samplesInWindows(trajectory: MatchHeroTrajectory | null, windows: [number, number][]): HeatmapPathPoint[] {
  if (!trajectory || windows.length === 0) return [];
  const points: HeatmapPathPoint[] = [];
  for (let i = 0; i < trajectory.atSeconds.length; i++) {
    const atSeconds = trajectory.atSeconds[i]!;
    if (windows.some(([start, end]) => atSeconds >= start && atSeconds <= end)) {
      points.push({ atSeconds, x: trajectory.x[i]!, y: trajectory.y[i]! });
    }
  }
  return points;
}

function buildDensityGrid(points: HeatmapPathPoint[], cols: number, rows: number): Grid {
  const grid: Grid = {};
  for (const point of points) {
    incrementCell(grid, cellIndexForPosition(point.x, point.y, cols, rows));
  }
  return grid;
}

function selectTrajectory(game: HeatmapGameData | null, battletag: string | null): MatchHeroTrajectory | null {
  if (!game) return null;
  if (battletag) return game.trajectories.find((t) => t.battletag === battletag) ?? null;
  return game.trajectories[0] ?? null;
}

export interface UseHeatmapSyncOptions {
  gridCols?: number;
  gridRows?: number;
}

/**
 * Drives the Pro Comparison View: time-slicing (phase/cumulative), event
 * anchoring, per-hero pathing, density grids (including the A-minus-B delta),
 * and a single shared pan/zoom `viewTransform` both canvases read from --
 * that shared ref *is* the sync mechanism `ProComparisonView.vue`'s two
 * `<canvas>` panes rely on to stay in lockstep.
 *
 * `gameA`/`gameB` are refs so the caller can swap in freshly-fetched match
 * data without re-creating this composable's state (filters/viewport
 * survive a match change, same as leaving zoom/pan in place while swapping
 * which two replays are being compared).
 */
export function useHeatmapSync(
  // `ComputedRef` (not `Ref`) so a caller deriving game data from a fetch
  // response (`computed(() => toHeatmapGameData(response.value))`) can pass
  // it directly -- a plain `ref()` satisfies this too, since a mutable
  // `.value` is always assignable where a readonly one is expected.
  gameA: ComputedRef<HeatmapGameData | null>,
  gameB: ComputedRef<HeatmapGameData | null>,
  options: UseHeatmapSyncOptions = {},
) {
  const gridCols = options.gridCols ?? DEFAULT_GRID_COLS;
  const gridRows = options.gridRows ?? DEFAULT_GRID_ROWS;

  const syncMode = ref<HeatmapSyncMode>("progress");
  // 0-100. In "progress" mode this is each game's own % of its own
  // durationSeconds; in "gameTime" mode it's % of the shorter game's
  // duration, applied as an absolute clock to both (see currentSecondsFor).
  const sliderPercent = ref(100);

  const windowMode = ref<HeatmapWindowMode>("cumulative");
  const selectedPhase = ref<HeatmapPhase>("early");
  const selectedEventType = ref<HeatmapEventType>("death");
  const eventWindowBeforeSeconds = ref(15);
  const eventWindowAfterSeconds = ref(5);

  const selectedBattletagA = ref<string | null>(null);
  const selectedBattletagB = ref<string | null>(null);

  const deltaMode = ref(false);

  const viewTransform = ref<ViewTransform>({ scale: 1, offsetX: 0, offsetY: 0 });

  function currentSecondsFor(game: HeatmapGameData | null): number {
    if (!game) return 0;
    if (syncMode.value === "gameTime") {
      const durations = [gameA.value?.durationSeconds, gameB.value?.durationSeconds].filter(
        (d): d is number => d !== undefined,
      );
      const sharedCap = durations.length > 0 ? Math.min(...durations) : game.durationSeconds;
      return Math.min((sliderPercent.value / 100) * sharedCap, game.durationSeconds);
    }
    return (sliderPercent.value / 100) * game.durationSeconds;
  }

  const currentSecondsA = computed(() => currentSecondsFor(gameA.value));
  const currentSecondsB = computed(() => currentSecondsFor(gameB.value));

  function activeWindowsFor(
    game: HeatmapGameData | null,
    battletag: string | null,
    currentSeconds: number,
  ): [number, number][] {
    if (!game) return [];
    let windows: [number, number][];
    if (windowMode.value === "phase") {
      windows = [phaseBounds(game, battletag, selectedPhase.value)];
    } else if (windowMode.value === "event") {
      windows = eventWindows(game, selectedEventType.value, eventWindowBeforeSeconds.value, eventWindowAfterSeconds.value);
    } else {
      windows = [[0, game.durationSeconds]];
    }
    return windows
      .map(([start, end]): [number, number] => [start, Math.min(end, currentSeconds)])
      .filter(([start, end]) => end > start);
  }

  const trajectoryA = computed(() => selectTrajectory(gameA.value, selectedBattletagA.value));
  const trajectoryB = computed(() => selectTrajectory(gameB.value, selectedBattletagB.value));

  /** Time-ordered path points for the currently-active window(s) -- directly
   * consumable as polyline points for literal rotation pathing. */
  const pathPointsA = computed(() =>
    samplesInWindows(trajectoryA.value, activeWindowsFor(gameA.value, selectedBattletagA.value, currentSecondsA.value)),
  );
  const pathPointsB = computed(() =>
    samplesInWindows(trajectoryB.value, activeWindowsFor(gameB.value, selectedBattletagB.value, currentSecondsB.value)),
  );

  const gridA = computed<Grid>(() => buildDensityGrid(pathPointsA.value, gridCols, gridRows));
  const gridB = computed<Grid>(() => buildDensityGrid(pathPointsB.value, gridCols, gridRows));
  /** A-minus-B: positive cells are "A went here, B didn't"; negative cells
   * are the reverse (see `heatmapRenderer.ts`'s diverging delta palette). */
  const deltaGrid = computed<Grid>(() => mergeGrid(gridA.value, gridB.value, -1));

  function panBy(dx: number, dy: number) {
    viewTransform.value = {
      ...viewTransform.value,
      offsetX: viewTransform.value.offsetX + dx,
      offsetY: viewTransform.value.offsetY + dy,
    };
  }

  /** Zooms by `factor` (>1 in, <1 out), anchored at the pane's own center
   * (CSS `transform-origin: center`, set once on the pane wrapper) rather
   * than the cursor position -- simpler and bug-free to keep exactly in
   * sync between panes than re-deriving a cursor-anchored offset on every
   * wheel tick, at the cost of not zooming exactly under the pointer. */
  function zoomBy(factor: number) {
    const current = viewTransform.value;
    viewTransform.value = { ...current, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor)) };
  }

  function resetViewTransform() {
    viewTransform.value = { scale: 1, offsetX: 0, offsetY: 0 };
  }

  return {
    gridCols,
    gridRows,
    syncMode,
    sliderPercent,
    windowMode,
    selectedPhase,
    selectedEventType,
    eventWindowBeforeSeconds,
    eventWindowAfterSeconds,
    selectedBattletagA,
    selectedBattletagB,
    deltaMode,
    viewTransform,
    currentSecondsA,
    currentSecondsB,
    trajectoryA,
    trajectoryB,
    pathPointsA,
    pathPointsB,
    gridA,
    gridB,
    deltaGrid,
    panBy,
    zoomBy,
    resetViewTransform,
  };
}
