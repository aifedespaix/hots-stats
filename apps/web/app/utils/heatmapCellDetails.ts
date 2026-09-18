import type { Grid } from "@hots-stats/shared-types";
import { cellIndexForPosition } from "@hots-stats/shared-types";
import type { MatchTimelineDeath } from "~/types/coach";

/**
 * Pure per-cell "inspector" math behind the hover panel every spatial heatmap
 * shows (see `SpatialHeatmapView.vue` and its `HeatmapCellTooltip.vue`).
 *
 * Kept out of the components because the interesting rules -- who counts as
 * "Toi", which deaths are relevant to the currently selected heroes, how a
 * cell's seconds/kills translate into a share of the whole view, and how the
 * panel's lists are capped -- are worth unit-testing on their own, and because
 * presence layers and kill/death grids otherwise drift into two code paths.
 */

/** How a battletag is presented in the hover panel. "unknown" is used when the caller gave no label (e.g. an aggregate view with no per-player data). */
export type PlayerSide = "me" | "ally" | "enemy" | "unknown";

/** Display info for one battletag, built by the caller from the match scoreboard. */
export interface HeatmapPlayerInfo {
  /** Hero name when known; the raw BattleTag otherwise. */
  name: string;
  side: PlayerSide;
}

/** Battletag -> info, looked up case-insensitively (see `playerInfoFor`). */
export type HeatmapPlayerLabels = Record<string, HeatmapPlayerInfo>;

/** The subset of a presence layer the hover panel needs -- deliberately not
 * `SpatialPresenceLayer` itself, so this module stays free of component imports. */
export interface CellPresenceLayer {
  grid: Grid;
  label?: string;
  colorRgb: [number, number, number];
  /** Set only when the layer is one known player; omitted for a merged ("Mon
   * équipe"/"Adversaires") or single-hero aggregate layer, which then renders
   * under its plain label. */
  side?: PlayerSide;
}

export interface CellPresenceLine {
  /** Already decorated for display: "Toi (Jaina)", "Raynor (allié)", "Adversaires". */
  label: string;
  colorRgb: [number, number, number];
  seconds: number;
  /** This cell's seconds as a share (0..1) of that layer's whole-map total. */
  share: number;
  isMe: boolean;
}

export interface CellEventLine {
  atSeconds: number;
  /** A whole sentence: "Toi (Jaina) a tué Kael'thas (ennemi)". */
  text: string;
  /** True when the viewer's own hero is the victim or one of the killers. */
  isMe: boolean;
}

export interface HeatmapCellDetail {
  presence: CellPresenceLine[];
  /** Presence lines dropped by the cap ("+N autre(s)"). */
  presenceHidden: number;
  /** Sum of the lines actually kept, in seconds. */
  totalSeconds: number;
  events: CellEventLine[];
  /** Event lines dropped by the cap. */
  eventsHidden: number;
  kills: number;
  deaths: number;
  /** This cell's share (0..1) of the whole view's kills/deaths; null when the view has none at all. */
  killsShare: number | null;
  deathsShare: number | null;
}

/** Whole-map totals for one view, parallel to the layers it was built from. */
export interface HeatmapCellTotals {
  /** Total seconds per presence layer, same order as the `layers` argument. */
  layers: number[];
  kills: number;
  deaths: number;
}

/** A structural subset of DOMRect, so this module stays testable without a DOM. */
export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const DEFAULT_MAX_PRESENCE_LINES = 4;
export const DEFAULT_MAX_EVENT_LINES = 5;

function sumGrid(grid: Grid | undefined): number {
  if (!grid) return 0;
  let total = 0;
  for (const value of Object.values(grid)) total += value;
  return total;
}

/** Grid keys are stringified cell indices (see shared-types/spatial-grid.ts) -- never index a Grid with a number. */
function cellValue(grid: Grid | undefined, cellIndex: number): number {
  return grid?.[String(cellIndex)] ?? 0;
}

/** Case-insensitive membership, with a linear fallback so a caller that passes
 * raw (non-lowercased) BattleTags still matches. An absent set means "count
 * every participant". */
function isSelected(set: ReadonlySet<string> | undefined, battletag: string): boolean {
  if (!set) return true;
  if (set.has(battletag)) return true;
  const lower = battletag.toLowerCase();
  if (set.has(lower)) return true;
  for (const entry of set) {
    if (entry.toLowerCase() === lower) return true;
  }
  return false;
}

/**
 * Screen point -> grid cell, using the map image's own bounding rect (which
 * already folds in any CSS pan/zoom transform, so this works unchanged for the
 * plain and the transformed panes).
 *
 * Grid row 0 is the calibration's world-Y *minimum*, i.e. the bottom of the map
 * (see `SpatialCanvasLayer.vue`), so a screen-space Y has to be flipped back
 * before bucketing. Returns null for a degenerate rect (image not loaded yet).
 */
export function cellIndexFromRect(
  clientX: number,
  clientY: number,
  rect: ClientRectLike,
  cols: number,
  rows: number,
): number | null {
  if (rect.width <= 0 || rect.height <= 0 || cols <= 0 || rows <= 0) return null;
  const xn = (clientX - rect.left) / rect.width;
  const ynFromTop = (clientY - rect.top) / rect.height;
  return cellIndexForPosition(xn, 1 - ynFromTop, cols, rows);
}

/** Buckets every positioned death into its grid cell, time-ordered inside each
 * bucket. Built once per data change and read on every hover, so hovering the
 * map never scans the match's whole death list. */
export function buildDeathCellIndex(
  deaths: readonly MatchTimelineDeath[],
  cols: number,
  rows: number,
): Map<number, MatchTimelineDeath[]> {
  const index = new Map<number, MatchTimelineDeath[]>();
  for (const death of deaths) {
    if (death.x === undefined || death.y === undefined) continue;
    const cellIndex = cellIndexForPosition(death.x, death.y, cols, rows);
    const bucket = index.get(cellIndex);
    if (bucket) bucket.push(death);
    else index.set(cellIndex, [death]);
  }
  for (const bucket of index.values()) bucket.sort((a, b) => a.atSeconds - b.atSeconds);
  return index;
}

/**
 * Whole-view totals the hover panel uses as denominators. Deaths win over the
 * grids when both are available: a "Cette partie" view has the raw events (so
 * its totals are exactly the ones the per-cell counters are drawn from), while
 * an aggregate/history view only ever has pre-summed grids.
 */
export function computeCellTotals(opts: {
  layers: readonly CellPresenceLayer[];
  killsGrid?: Grid;
  deathsGrid?: Grid;
  deaths?: readonly MatchTimelineDeath[];
  activeBattletags?: ReadonlySet<string>;
}): HeatmapCellTotals {
  const layers = opts.layers.map((layer) => sumGrid(layer.grid));
  if (opts.deaths) {
    let kills = 0;
    let deaths = 0;
    for (const death of opts.deaths) {
      if (isSelected(opts.activeBattletags, death.battletag)) deaths++;
      for (const killer of death.killers ?? []) {
        if (isSelected(opts.activeBattletags, killer)) kills++;
      }
    }
    return { layers, kills, deaths };
  }
  return { layers, kills: sumGrid(opts.killsGrid), deaths: sumGrid(opts.deathsGrid) };
}

export function playerInfoFor(battletag: string, labels?: HeatmapPlayerLabels): HeatmapPlayerInfo {
  return labels?.[battletag] ?? labels?.[battletag.toLowerCase()] ?? { name: battletag, side: "unknown" };
}

/** "Toi (Jaina)" / "Raynor (allié)" / "Kael'thas (ennemi)" / plain name for an
 * unlabelled battletag. Always names the hero, so "Toi" alone is never
 * ambiguous about which hero is being read. */
export function actorLabel(battletag: string, labels?: HeatmapPlayerLabels): string {
  const info = playerInfoFor(battletag, labels);
  if (info.side === "me") return `Toi (${info.name})`;
  if (info.side === "ally") return `${info.name} (allié)`;
  if (info.side === "enemy") return `${info.name} (ennemi)`;
  return info.name;
}

/** Same decorating rules as `actorLabel`, for a presence layer's own label. */
export function presenceLabelFor(label: string | undefined, side?: PlayerSide): string {
  const base = label ?? "Présence";
  if (side === "me") return `Toi (${base})`;
  if (side === "ally") return `${base} (allié)`;
  if (side === "enemy") return `${base} (ennemi)`;
  return base;
}

/** M:SS, for a death's game clock. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Seconds spent in one cell, kept readable below 10s (sub-second precision
 * there is meaningful: one presence sample is one second). */
export function formatCellSeconds(seconds: number): string {
  if (seconds >= 10) return `${Math.round(seconds)} s`;
  return `${(Math.round(seconds * 10) / 10).toFixed(1).replace(".", ",")} s`;
}

function eventText(death: MatchTimelineDeath, labels?: HeatmapPlayerLabels): string {
  const victim = actorLabel(death.battletag, labels);
  const killers = (death.killers ?? []).map((killer) => actorLabel(killer, labels));
  if (killers.length === 0) return death.killType === "other" ? `${victim} est mort (cause non-héroïque)` : `${victim} est mort`;
  if (killers.length === 1) return `${killers[0]} a tué ${victim}`;
  return `${killers.join(" + ")} ont tué ${victim}`;
}

/** Builds everything the hover panel shows for one cell. `cellDeaths` must
 * come from `buildDeathCellIndex` (already restricted to this cell). */
export function buildCellDetail(opts: {
  cellIndex: number;
  layers: readonly CellPresenceLayer[];
  totals: HeatmapCellTotals;
  killsGrid?: Grid;
  deathsGrid?: Grid;
  cellDeaths?: readonly MatchTimelineDeath[];
  playerLabels?: HeatmapPlayerLabels;
  activeBattletags?: ReadonlySet<string>;
  maxPresenceLines?: number;
  maxEventLines?: number;
}): HeatmapCellDetail {
  const { cellIndex, layers, totals } = opts;

  const allPresence: CellPresenceLine[] = [];
  layers.forEach((layer, i) => {
    const seconds = cellValue(layer.grid, cellIndex);
    if (seconds <= 0) return;
    const total = totals.layers[i] ?? 0;
    allPresence.push({
      label: presenceLabelFor(layer.label, layer.side),
      colorRgb: layer.colorRgb,
      seconds,
      share: total > 0 ? seconds / total : 0,
      isMe: layer.side === "me",
    });
  });
  allPresence.sort((a, b) => b.seconds - a.seconds);

  const maxPresenceLines = opts.maxPresenceLines ?? DEFAULT_MAX_PRESENCE_LINES;
  const presenceHidden = Math.max(0, allPresence.length - maxPresenceLines);
  const presence = allPresence.slice(0, maxPresenceLines);
  const totalSeconds = presence.reduce((sum, line) => sum + line.seconds, 0);

  let kills: number;
  let deaths: number;
  let allEvents: CellEventLine[] = [];
  if (opts.cellDeaths) {
    kills = 0;
    deaths = 0;
    for (const death of opts.cellDeaths) {
      if (isSelected(opts.activeBattletags, death.battletag)) deaths++;
      for (const killer of death.killers ?? []) {
        if (isSelected(opts.activeBattletags, killer)) kills++;
      }
    }
    allEvents = opts.cellDeaths
      .map((death) => ({
        atSeconds: death.atSeconds,
        text: eventText(death, opts.playerLabels),
        isMe:
          playerInfoFor(death.battletag, opts.playerLabels).side === "me" ||
          (death.killers ?? []).some((killer) => playerInfoFor(killer, opts.playerLabels).side === "me"),
      }))
      // Chronological, and independent of the caller's ordering: a cell with
      // more events than the cap keeps its *earliest* few, which reads as a
      // fight unfolding rather than an arbitrary slice.
      .sort((a, b) => a.atSeconds - b.atSeconds);
  } else {
    kills = cellValue(opts.killsGrid, cellIndex);
    deaths = cellValue(opts.deathsGrid, cellIndex);
  }

  const maxEventLines = opts.maxEventLines ?? DEFAULT_MAX_EVENT_LINES;
  const eventsHidden = Math.max(0, allEvents.length - maxEventLines);

  return {
    presence,
    presenceHidden,
    totalSeconds,
    events: allEvents.slice(0, maxEventLines),
    eventsHidden,
    kills,
    deaths,
    killsShare: totals.kills > 0 ? kills / totals.kills : null,
    deathsShare: totals.deaths > 0 ? deaths / totals.deaths : null,
  };
}

/** Nothing meaningful to show for this cell -- the caller skips the panel entirely. */
export function isCellDetailEmpty(detail: HeatmapCellDetail): boolean {
  return (
    detail.presence.length === 0 &&
    detail.events.length === 0 &&
    detail.kills <= 0 &&
    detail.deaths <= 0
  );
}
