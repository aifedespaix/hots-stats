// Explicit vue import (not Nuxt auto-import) so the pure logic is testable
// with plain vitest -- see useHeatmapSync.ts's own comment, the repo's
// precedent for this split.
import { computed, type ComputedRef, type Ref, type WritableComputedRef, ref } from "vue";
import type {
  MatchTimelineData,
  MatchTimelineDeathMarker,
  MatchTimelineLeadPoint,
  MatchTimelineSeries,
  MatchTimelineStructureEvent,
  MatchTimelineTeamLabels,
} from "~/types/coach";
import { CLUSTER_TIME_WINDOW_SECONDS } from "~/utils/deathClustering";

export interface MatchTimelinePlayer {
  battletag: string;
  team: number;
}

/** Everything the chronology needs from one match -- kept decoupled from
 * MatchDetailResponse's wire shape so the derivation stays testable
 * without a fetch. */
export interface MatchTimelineInput {
  timeline: MatchTimelineData | null;
  players: MatchTimelinePlayer[];
  durationSeconds: number;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** One team's mean level per distinct snapshot timestamp, ascending. */
function levelSteps(snapshots: { atSeconds: number; level: number }[]): { atSeconds: number; level: number }[] {
  const levelsByTime = new Map<number, number[]>();
  for (const snapshot of snapshots) {
    const levels = levelsByTime.get(snapshot.atSeconds);
    if (levels) levels.push(snapshot.level);
    else levelsByTime.set(snapshot.atSeconds, [snapshot.level]);
  }
  return [...levelsByTime.entries()]
    .map(([atSeconds, levels]) => ({ atSeconds, level: mean(levels) }))
    .sort((a, b) => a.atSeconds - b.atSeconds);
}

/**
 * Clusters one team's death timestamps. The spatial clustering
 * (utils/deathClustering.ts) needs coordinates; the chronology does not, so
 * this is time-only. Single-linkage in 1D is a contiguous run whose
 * consecutive gap stays within the window, so a sorted scan is exact.
 */
function clusterDeathTimes(atSeconds: number[]): { atSeconds: number; deaths: number }[] {
  const sorted = [...atSeconds].sort((a, b) => a - b);
  const clusters: { atSeconds: number; deaths: number }[] = [];
  let members: number[] = [];
  for (const time of sorted) {
    if (members.length > 0 && time - members[members.length - 1]! > CLUSTER_TIME_WINDOW_SECONDS) {
      clusters.push({ atSeconds: mean(members), deaths: members.length });
      members = [];
    }
    members.push(time);
  }
  if (members.length > 0) clusters.push({ atSeconds: mean(members), deaths: members.length });
  return clusters;
}

/**
 * Pure C2 derivation. The lead curve is the two teams' mean snapshot level
 * over time, each team's last known level carried forward between its own
 * level-ups -- never an interpolated or invented point. A point exists only
 * once both teams have a known level, and hasLevelData is true only when at
 * least one such point exists (acceptance criterion 1).
 */
export function buildMatchTimelineSeries(input: MatchTimelineInput): MatchTimelineSeries {
  const timeline = input.timeline;
  if (!timeline) {
    return { hasLevelData: false, points: [], finalLead: null, deaths: [], structures: [] };
  }

  const teamByBattletag = new Map(input.players.map((player) => [player.battletag, player.team]));
  const snapshotsByTeam: { atSeconds: number; level: number }[][] = [[], []];
  for (const snapshot of timeline.levelSnapshots) {
    const team = teamByBattletag.get(snapshot.battletag);
    if (team !== 0 && team !== 1) continue;
    snapshotsByTeam[team]!.push({ atSeconds: snapshot.atSeconds, level: snapshot.level });
  }
  const steps = [levelSteps(snapshotsByTeam[0]!), levelSteps(snapshotsByTeam[1]!)];

  const timestamps = [
    ...new Set([...steps[0]!.map((step) => step.atSeconds), ...steps[1]!.map((step) => step.atSeconds)]),
  ].sort((a, b) => a - b);

  const points: MatchTimelineLeadPoint[] = [];
  const cursors = [0, 0];
  const latest: (number | null)[] = [null, null];
  for (const atSeconds of timestamps) {
    for (const team of [0, 1] as const) {
      const teamSteps = steps[team]!;
      while (cursors[team]! < teamSteps.length && teamSteps[cursors[team]!]!.atSeconds <= atSeconds) {
        latest[team] = teamSteps[cursors[team]!]!.level;
        cursors[team]! += 1;
      }
    }
    if (latest[0] === null || latest[0] === undefined || latest[1] === null || latest[1] === undefined) continue;
    points.push({ atSeconds, team0Level: latest[0], team1Level: latest[1], lead: latest[0] - latest[1] });
  }

  const deaths: MatchTimelineDeathMarker[] = [];
  for (const team of [0, 1] as const) {
    for (const cluster of clusterDeathTimes(
      timeline.deaths.filter((death) => death.team === team).map((death) => death.atSeconds),
    )) {
      deaths.push({ team, atSeconds: cluster.atSeconds, deaths: cluster.deaths });
    }
  }
  deaths.sort((a, b) => a.atSeconds - b.atSeconds);

  const structures: MatchTimelineStructureEvent[] = [...(timeline.structureEvents ?? [])].sort(
    (a, b) => a.atSeconds - b.atSeconds,
  );

  return {
    hasLevelData: points.length > 0,
    points,
    finalLead: points.length > 0 ? points[points.length - 1]!.lead : null,
    deaths,
    structures,
  };
}

/**
 * French labels for the two sides. The viewer's own team is only knowable
 * when the match page resolved it (the viewer is in the match); otherwise
 * neutral team numbers avoid pretending to know whose side each is.
 */
export function timelineTeamLabels(allyTeam: 0 | 1 | null): MatchTimelineTeamLabels {
  if (allyTeam === 0) return { team0: "mon équipe", team1: "les adversaires" };
  if (allyTeam === 1) return { team0: "les adversaires", team1: "mon équipe" };
  return { team0: "l'équipe 1", team1: "l'équipe 2" };
}

/** Levels are integers in practice, but the mean of several snapshots at one
 * timestamp can land on .5 -- show it rather than round a real difference away. */
export function formatTimelineLevel(level: number): string {
  return Number.isInteger(level) ? String(level) : level.toFixed(1);
}

/**
 * The chart's text alternative (acceptance criterion 3): it names the side
 * ahead and by how much at the last shared snapshot. Deliberately avoids
 * verb agreement traps ("mon équipe" / "les adversaires" cannot both take
 * the same verb), so it stays correct whichever side leads.
 */
export function buildMatchTimelineSummary(series: MatchTimelineSeries, labels: MatchTimelineTeamLabels): string {
  if (series.points.length === 0 || series.finalLead === null) {
    return "Chronologie indisponible : aucune donnée de niveau comparable.";
  }
  const last = series.points[series.points.length - 1]!;
  const level0 = formatTimelineLevel(last.team0Level);
  const level1 = formatTimelineLevel(last.team1Level);
  const lead = series.finalLead;
  if (lead > 0) {
    return (
      "Niveau final : " + level0 + " – " + level1 + ", " + labels.team0 + " devant " + labels.team1 +
      " (avance de " + formatTimelineLevel(lead) + (lead > 1 ? " niveaux)." : " niveau).")
    );
  }
  if (lead < 0) {
    const gap = Math.abs(lead);
    return (
      "Niveau final : " + level1 + " – " + level0 + ", " + labels.team1 + " devant " + labels.team0 +
      " (avance de " + formatTimelineLevel(gap) + (gap > 1 ? " niveaux)." : " niveau).")
    );
  }
  return "Niveau final : égalité " + level0 + " – " + level1 + ".";
}

/** Maps atSeconds onto [0, width], clamped -- a duration of 0 maps everything to 0. */
export function timelineX(atSeconds: number, durationSeconds: number, width: number): number {
  if (durationSeconds <= 0) return 0;
  return Math.min(width, Math.max(0, (atSeconds / durationSeconds) * width));
}

/** Symmetric lead domain from the series, with a 1-level floor so a 0.5 lead is not stretched. */
export function timelineLeadMax(points: MatchTimelineLeadPoint[]): number {
  return Math.max(1, ...points.map((point) => Math.abs(point.lead)));
}

/** Maps a lead onto a symmetric y domain: 0 -> midY, +/-leadMax -> topY/bottomY, clamped. */
export function timelineLeadY(lead: number, leadMax: number, midY: number, halfHeight: number): number {
  if (leadMax <= 0) return midY;
  const clamped = Math.min(leadMax, Math.max(-leadMax, lead));
  return midY - (clamped / leadMax) * halfHeight;
}

const DEATH_MARKER_BASE_RADIUS = 3;
const DEATH_MARKER_RADIUS_STEP = 1.5;
const DEATH_MARKER_MAX_RADIUS = 10;

/** Death-marker radius: one step per extra death in the cluster, capped so a huge teamfight stays on its track. */
export function deathMarkerRadius(deaths: number): number {
  return Math.min(DEATH_MARKER_MAX_RADIUS, DEATH_MARKER_BASE_RADIUS + Math.max(0, deaths - 1) * DEATH_MARKER_RADIUS_STEP);
}

export interface UseMatchTimelineSeriesResult {
  series: ComputedRef<MatchTimelineSeries>;
  durationSeconds: ComputedRef<number>;
  /** 0-100, the scrubber's own scale (a native range input's value). */
  scrubPercent: Ref<number>;
  /** Writable: the page shares this with the heatmap tab's highlightAtSeconds. */
  scrubSeconds: WritableComputedRef<number>;
}

/**
 * Reactive wrapper around the pure derivation plus the C2 scrubber state.
 * scrubSeconds is writable so the match page can bind it with
 * v-model:scrub-seconds and pass the same value to the heatmap tab.
 */
export function useMatchTimelineSeries(input: ComputedRef<MatchTimelineInput>): UseMatchTimelineSeriesResult {
  const series = computed(() => buildMatchTimelineSeries(input.value));
  const scrubPercent = ref(100);
  const durationSeconds = computed(() => Math.max(0, input.value.durationSeconds));
  const scrubSeconds = computed({
    get: () => (scrubPercent.value / 100) * durationSeconds.value,
    set: (value: number) => {
      scrubPercent.value =
        durationSeconds.value > 0 ? Math.min(100, Math.max(0, (value / durationSeconds.value) * 100)) : 0;
    },
  });
  return { series, durationSeconds, scrubPercent, scrubSeconds };
}
