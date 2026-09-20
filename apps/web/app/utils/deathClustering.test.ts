import { describe, expect, it } from "vitest";
import type { MatchTimelineDeath } from "~/types/coach";
import {
  buildSpatialEventPoints,
  clusterSpatialEvents,
  deathsForCluster,
  isClusterHighlighted,
  type SpatialEventCluster,
  type SpatialEventPoint,
} from "./deathClustering";

function point(overrides: Partial<SpatialEventPoint> = {}): SpatialEventPoint {
  return { kind: "death", battletag: "Foo#1111", atSeconds: 0, x: 0.5, y: 0.5, layer: null, ...overrides };
}

describe("buildSpatialEventPoints", () => {
  it("emits one death point plus one kill point per credited killer", () => {
    const deaths: MatchTimelineDeath[] = [
      { battletag: "Victim#1", team: 0, atSeconds: 100, x: 0.2, y: 0.3, killers: ["Killer#1", "Killer#2"] },
    ];
    const points = buildSpatialEventPoints(deaths);
    expect(points).toEqual([
      { kind: "death", battletag: "Victim#1", atSeconds: 100, x: 0.2, y: 0.3, layer: null },
      { kind: "kill", battletag: "Killer#1", atSeconds: 100, x: 0.2, y: 0.3, layer: null },
      { kind: "kill", battletag: "Killer#2", atSeconds: 100, x: 0.2, y: 0.3, layer: null },
    ]);
  });

  it("skips deaths with no recorded position", () => {
    const deaths: MatchTimelineDeath[] = [{ battletag: "Victim#1", team: 0, atSeconds: 100 }];
    expect(buildSpatialEventPoints(deaths)).toEqual([]);
  });

  it("emits a death point with no kill points when there are no credited killers", () => {
    const deaths: MatchTimelineDeath[] = [{ battletag: "Victim#1", team: 0, atSeconds: 100, x: 0.2, y: 0.3, killers: [] }];
    expect(buildSpatialEventPoints(deaths)).toEqual([{ kind: "death", battletag: "Victim#1", atSeconds: 100, x: 0.2, y: 0.3, layer: null }]);
  });
});

describe("clusterSpatialEvents", () => {
  it("merges points close in both time and space into one cluster", () => {
    const points = [
      point({ atSeconds: 100, x: 0.5, y: 0.5 }),
      point({ atSeconds: 103, x: 0.52, y: 0.51 }),
      point({ atSeconds: 106, x: 0.49, y: 0.5 }),
    ];
    const clusters = clusterSpatialEvents(points);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.points).toHaveLength(3);
  });

  it("keeps points in separate clusters when far apart in time", () => {
    const points = [point({ atSeconds: 0 }), point({ atSeconds: 100 })];
    const clusters = clusterSpatialEvents(points);
    expect(clusters).toHaveLength(2);
  });

  it("keeps points in separate clusters when far apart in space", () => {
    const points = [point({ x: 0.1, y: 0.1 }), point({ x: 0.9, y: 0.9 })];
    const clusters = clusterSpatialEvents(points);
    expect(clusters).toHaveLength(2);
  });

  it("never merges a kill point with a death point even at the same place and time", () => {
    const points = [point({ kind: "death" }), point({ kind: "kill" })];
    const clusters = clusterSpatialEvents(points);
    expect(clusters).toHaveLength(2);
  });

  it("chains a group of points into one cluster even when the two ends individually exceed the threshold", () => {
    const points = [point({ x: 0.1 }), point({ x: 0.14 }), point({ x: 0.18 })];
    // 0.1 <-> 0.18 alone (0.08) would exceed the 0.06 default threshold, but the middle point bridges them.
    const clusters = clusterSpatialEvents(points);
    expect(clusters).toHaveLength(1);
  });

  it("uses the member points' centroid and mean timestamp", () => {
    const points = [point({ atSeconds: 100, x: 0.4, y: 0.4 }), point({ atSeconds: 104, x: 0.44, y: 0.44 })];
    const clusters = clusterSpatialEvents(points);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.atSeconds).toBeCloseTo(102);
    expect(clusters[0]!.x).toBeCloseTo(0.42);
    expect(clusters[0]!.y).toBeCloseTo(0.42);
  });
});

describe("isClusterHighlighted", () => {
  const cluster = { kind: "death" as const, x: 0.5, y: 0.5, atSeconds: 100, points: [point({ atSeconds: 100 })] };

  it("highlights a cluster within the window of the scrubbed time", () => {
    expect(isClusterHighlighted(cluster, 100)).toBe(true);
    expect(isClusterHighlighted(cluster, 108)).toBe(true);
  });

  it("does not highlight a cluster outside the window", () => {
    expect(isClusterHighlighted(cluster, 109)).toBe(false);
    expect(isClusterHighlighted(cluster, 50)).toBe(false);
  });

  it("highlights nothing while the scrubber has no position", () => {
    expect(isClusterHighlighted(cluster, null)).toBe(false);
    expect(isClusterHighlighted(cluster, undefined)).toBe(false);
  });
});

describe("deathsForCluster", () => {
  const deaths: MatchTimelineDeath[] = [
    { battletag: "Victim#1", team: 0, atSeconds: 100, x: 0.2, y: 0.3, killers: ["Killer#1"] },
    { battletag: "Victim#2", team: 1, atSeconds: 100, x: 0.21, y: 0.3, killers: ["Killer#1", "Killer#2"] },
    { battletag: "Victim#3", team: 0, atSeconds: 400, x: 0.2, y: 0.3, killers: ["Killer#1"] },
  ];

  function cluster(overrides: Partial<SpatialEventCluster>): SpatialEventCluster {
    return { kind: "death", x: 0.2, y: 0.3, atSeconds: 100, points: [], ...overrides };
  }

  it("maps a death cluster back to the victims it plots", () => {
    const result = deathsForCluster(
      cluster({
        points: [
          { kind: "death", battletag: "Victim#1", atSeconds: 100, x: 0.2, y: 0.3, layer: null },
          { kind: "death", battletag: "Victim#2", atSeconds: 100, x: 0.21, y: 0.3, layer: null },
        ],
      }),
      deaths,
    );
    expect(result.map((d) => d.battletag)).toEqual(["Victim#1", "Victim#2"]);
  });

  it("maps a kill cluster back to every death the killer was credited for, at that instant", () => {
    const result = deathsForCluster(
      cluster({ kind: "kill", points: [{ kind: "kill", battletag: "Killer#1", atSeconds: 100, x: 0.2, y: 0.3, layer: null }] }),
      deaths,
    );
    expect(result.map((d) => d.battletag)).toEqual(["Victim#1", "Victim#2"]);
  });

  it("never repeats a death shared by several of the cluster's points", () => {
    const result = deathsForCluster(
      cluster({
        kind: "kill",
        points: [
          { kind: "kill", battletag: "Killer#1", atSeconds: 100, x: 0.2, y: 0.3, layer: null },
          { kind: "kill", battletag: "Killer#2", atSeconds: 100, x: 0.21, y: 0.3, layer: null },
        ],
      }),
      deaths,
    );
    expect(result).toHaveLength(2);
  });
});
