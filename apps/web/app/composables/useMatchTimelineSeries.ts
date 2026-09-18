import type {
  MatchTimelineData,
  MatchTimelineDeathMarker,
  MatchTimelineLeadPoint,
  MatchTimelineSeries,
  MatchTimelineStructureEvent,
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
    if (latest[0] === null || latest[1] === null) continue;
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
