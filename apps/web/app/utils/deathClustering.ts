import type { MatchTimelineDeath } from "~/types/coach";

export interface SpatialEventPoint {
  kind: "kill" | "death";
  /** Victim's battletag for a "death" point, credited killer's for a "kill" point. */
  battletag: string;
  atSeconds: number;
  x: number;
  y: number;
  layer: string | null;
}

export interface SpatialEventCluster {
  kind: "kill" | "death";
  /** Centroid of the cluster's members, in the same normalized `[0,1]` space as the source points. */
  x: number;
  y: number;
  /** Mean timestamp of the cluster's members. */
  atSeconds: number;
  points: SpatialEventPoint[];
}

// A teamfight's deaths land within a handful of seconds of each other and in
// the same pocket of the map -- both defaults are deliberately generous
// (8s, ~6% of map width) since under-clustering (a teamfight rendered as 5
// separate markers) is the failure this exists to avoid, and a false-merge
// of two genuinely unrelated deaths is comparatively harmless (still reads
// as "something died here around this time").
export const CLUSTER_TIME_WINDOW_SECONDS = 8;
export const CLUSTER_DISTANCE_NORMALIZED = 0.06;

/** One `kind`-appropriate `SpatialEventPoint` for the death itself, plus one per credited killer (fanned out to the same position/timestamp -- kills have no coordinates of their own, only the death they caused does). */
export function buildSpatialEventPoints(deaths: MatchTimelineDeath[]): SpatialEventPoint[] {
  const points: SpatialEventPoint[] = [];
  for (const death of deaths) {
    if (death.x === undefined || death.y === undefined) continue;
    const layer = death.layer ?? null;
    points.push({ kind: "death", battletag: death.battletag, atSeconds: death.atSeconds, x: death.x, y: death.y, layer });
    for (const killer of death.killers ?? []) {
      points.push({ kind: "kill", battletag: killer, atSeconds: death.atSeconds, x: death.x, y: death.y, layer });
    }
  }
  return points;
}

function distance(a: SpatialEventPoint, b: SpatialEventPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Single-linkage clustering of same-`kind` points that are close in both
 * time and space (union-find over pairs within `timeWindowSeconds` /
 * `distanceThreshold`) -- a chain of nearby events can end up in one
 * cluster even if its two ends individually exceed the threshold, which is
 * the intended "teamfight blob" behavior, not a bug.
 */
export function clusterSpatialEvents(
  points: SpatialEventPoint[],
  timeWindowSeconds = CLUSTER_TIME_WINDOW_SECONDS,
  distanceThreshold = CLUSTER_DISTANCE_NORMALIZED,
): SpatialEventCluster[] {
  const parent = points.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  }
  function union(a: number, b: number) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootA] = rootB;
  }

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!;
      const b = points[j]!;
      if (a.kind !== b.kind) continue;
      if (Math.abs(a.atSeconds - b.atSeconds) > timeWindowSeconds) continue;
      if (distance(a, b) > distanceThreshold) continue;
      union(i, j);
    }
  }

  const groups = new Map<number, SpatialEventPoint[]>();
  points.forEach((point, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(point);
    else groups.set(root, [point]);
  });

  return Array.from(groups.values()).map((members): SpatialEventCluster => ({
    kind: members[0]!.kind,
    x: members.reduce((sum, p) => sum + p.x, 0) / members.length,
    y: members.reduce((sum, p) => sum + p.y, 0) / members.length,
    atSeconds: members.reduce((sum, p) => sum + p.atSeconds, 0) / members.length,
    points: members,
  }));
}

/** How close (seconds) a cluster's mean timestamp must be to the chronology
 * scrub position for the heatmap to highlight it -- the same 8s window the
 * clustering itself uses, so a highlighted blob is a real cluster, not a
 * coincidental neighbour. */
export const HIGHLIGHT_WINDOW_SECONDS = CLUSTER_TIME_WINDOW_SECONDS;

/**
 * True when `cluster` happened within `HIGHLIGHT_WINDOW_SECONDS` of the
 * timeline's scrub position. A null/absent position highlights nothing.
 */
export function isClusterHighlighted(
  cluster: SpatialEventCluster,
  atSeconds: number | null | undefined,
): boolean {
  if (atSeconds === null || atSeconds === undefined || !Number.isFinite(atSeconds)) return false;
  return Math.abs(cluster.atSeconds - atSeconds) <= HIGHLIGHT_WINDOW_SECONDS;
}

/** The deaths a cluster stands for, so a marker can open the full recap of what
 * it plots: a "death" point names its own victim, a "kill" point names the
 * killer and matches every death they were credited for at that instant. */
export function deathsForCluster(
  cluster: SpatialEventCluster,
  deaths: readonly MatchTimelineDeath[],
): MatchTimelineDeath[] {
  const matched: MatchTimelineDeath[] = [];

  for (const point of cluster.points) {
    for (const death of deaths) {
      if (death.atSeconds !== point.atSeconds) continue;
      const isVictim = point.kind === "death" && death.battletag === point.battletag;
      const isKiller = point.kind === "kill" && (death.killers ?? []).includes(point.battletag);
      if ((!isVictim && !isKiller) || matched.includes(death)) continue;
      matched.push(death);
    }
  }

  return matched;
}
