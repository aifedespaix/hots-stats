import { describe, expect, it } from "vitest";
import type { MatchTimelineDeath } from "~/types/coach";
import { buildSpatialEventPoints, clusterSpatialEvents, type SpatialEventPoint } from "./deathClustering";

function point(overrides: Partial<SpatialEventPoint> = {}): SpatialEventPoint {
  return { kind: "death", battletag: "Foo#1111", atSeconds: 0, x: 0.5, y: 0.5, ...overrides };
}

describe("buildSpatialEventPoints", () => {
  it("emits one death point plus one kill point per credited killer", () => {
    const deaths: MatchTimelineDeath[] = [
      { battletag: "Victim#1", team: 0, atSeconds: 100, x: 0.2, y: 0.3, killers: ["Killer#1", "Killer#2"] },
    ];
    const points = buildSpatialEventPoints(deaths);
    expect(points).toEqual([
      { kind: "death", battletag: "Victim#1", atSeconds: 100, x: 0.2, y: 0.3 },
      { kind: "kill", battletag: "Killer#1", atSeconds: 100, x: 0.2, y: 0.3 },
      { kind: "kill", battletag: "Killer#2", atSeconds: 100, x: 0.2, y: 0.3 },
    ]);
  });

  it("skips deaths with no recorded position", () => {
    const deaths: MatchTimelineDeath[] = [{ battletag: "Victim#1", team: 0, atSeconds: 100 }];
    expect(buildSpatialEventPoints(deaths)).toEqual([]);
  });

  it("emits a death point with no kill points when there are no credited killers", () => {
    const deaths: MatchTimelineDeath[] = [{ battletag: "Victim#1", team: 0, atSeconds: 100, x: 0.2, y: 0.3, killers: [] }];
    expect(buildSpatialEventPoints(deaths)).toEqual([{ kind: "death", battletag: "Victim#1", atSeconds: 100, x: 0.2, y: 0.3 }]);
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
