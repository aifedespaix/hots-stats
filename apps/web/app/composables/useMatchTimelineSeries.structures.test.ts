import { describe, expect, it } from "vitest";
import type { MatchTimelineData, MatchTimelineTeamLabels } from "~/types/coach";
import {
  buildMatchTimelineSeries,
  timelineComparison,
  timelineLeadLabel,
  timelineStructureLanes,
  timelineStructureMarkers,
  timelineStructureSideLabel,
  type MatchTimelineInput,
} from "./useMatchTimelineSeries";

const labels: MatchTimelineTeamLabels = { team0: "mon équipe", team1: "les adversaires" };
const neutralLabels: MatchTimelineTeamLabels = { team0: "l'équipe 1", team1: "l'équipe 2" };

function timeline(overrides: Partial<MatchTimelineData> = {}): MatchTimelineData {
  return { deaths: [], levelSnapshots: [], ...overrides };
}

function input(overrides: Partial<MatchTimelineInput> = {}): MatchTimelineInput {
  return {
    timeline: timeline(),
    players: [
      { battletag: "Me#1", team: 0, heroName: "Muradin" },
      { battletag: "Foe#1", team: 1, heroName: "Rexxar" },
    ],
    durationSeconds: 600,
    myBattletags: ["Me#1"],
    ...overrides,
  };
}

describe("timelineLeadLabel", () => {
  it("names the side ahead and the gap", () => {
    expect(timelineLeadLabel(2, labels)).toBe("mon équipe devant de 2 niveaux");
  });

  it("uses the singular for a one-level lead", () => {
    expect(timelineLeadLabel(-1, labels)).toBe("les adversaires devant de 1 niveau");
  });

  it("says égalité on a tie", () => {
    expect(timelineLeadLabel(0, labels)).toBe("égalité");
  });

  it("returns null when the lead is unknown", () => {
    expect(timelineLeadLabel(null, labels)).toBeNull();
  });
});

describe("timelineStructureLanes", () => {
  it("puts my team's row first and labels both rows by side", () => {
    expect(timelineStructureLanes(1, labels)).toEqual([
      { team: 1, side: "ally", label: "nos structures" },
      { team: 0, side: "enemy", label: "leurs structures" },
    ]);
  });

  it("keeps my team first when I am on team 0", () => {
    expect(timelineStructureLanes(0, labels).map((lane) => lane.team)).toEqual([0, 1]);
  });

  it("falls back to neutral team names when the viewer is not in the match", () => {
    expect(timelineStructureLanes(null, neutralLabels)).toEqual([
      { team: 0, side: "ally", label: "l'équipe 1" },
      { team: 1, side: "enemy", label: "l'équipe 2" },
    ]);
  });
});

describe("timelineStructureSideLabel", () => {
  it("calls a structure ours or theirs from the viewer's side", () => {
    expect(timelineStructureSideLabel(0, 0)).toBe("notre structure");
    expect(timelineStructureSideLabel(1, 0)).toBe("leur structure");
  });

  it("stays neutral without a viewer team", () => {
    expect(timelineStructureSideLabel(0, null)).toBe("équipe 1");
    expect(timelineStructureSideLabel(1, null)).toBe("équipe 2");
  });
});

describe("timelineStructureMarkers", () => {
  const structures = [
    { team: 0 as const, atSeconds: 100, structureType: "fort" as const },
    { team: 1 as const, atSeconds: 200, structureType: "keep" as const },
    { team: 0 as const, atSeconds: 300, structureType: "wall" as const },
  ];

  it("returns every structure when no window is given", () => {
    expect(timelineStructureMarkers(structures)).toHaveLength(3);
  });

  it("keeps only the structures inside the window", () => {
    const markers = timelineStructureMarkers(structures, { startSeconds: 150, endSeconds: 250 });
    expect(markers.map((marker) => marker.atSeconds)).toEqual([200]);
  });

  it("leaves a lone destruction on the centre slot", () => {
    expect(timelineStructureMarkers([structures[0]!]).map((marker) => marker.slot)).toEqual([0]);
  });

  it("spreads simultaneous destructions onto distinct symmetric slots", () => {
    const simultaneous = [
      { team: 0 as const, atSeconds: 100, structureType: "wall" as const },
      { team: 0 as const, atSeconds: 100, structureType: "wall" as const },
      { team: 0 as const, atSeconds: 100, structureType: "keep" as const },
    ];
    expect(timelineStructureMarkers(simultaneous).map((marker) => marker.slot)).toEqual([-1, 0, 1]);
  });

  it("slots each team separately at the same second", () => {
    const markers = timelineStructureMarkers([
      { team: 0, atSeconds: 100, structureType: "wall" },
      { team: 1, atSeconds: 100, structureType: "wall" },
    ]);
    expect(markers.map((marker) => marker.slot)).toEqual([0, 0]);
  });

  it("gives every event a unique key even when team, type and second collide", () => {
    const markers = timelineStructureMarkers([
      { team: 0, atSeconds: 100, structureType: "wall" },
      { team: 0, atSeconds: 100, structureType: "wall" },
    ]);
    expect(new Set(markers.map((marker) => marker.key)).size).toBe(2);
  });
});

describe("timelineComparison", () => {
  function series() {
    return buildMatchTimelineSeries(
      input({
        timeline: timeline({
          levelSnapshots: [
            { battletag: "Me#1", atSeconds: 60, level: 5 },
            { battletag: "Foe#1", atSeconds: 60, level: 3 },
            { battletag: "Foe#1", atSeconds: 120, level: 8 },
          ],
          deaths: [{ battletag: "Me#1", team: 0, atSeconds: 200 }],
          structureEvents: [{ team: 1, atSeconds: 200, structureType: "fort" }],
        }),
      }),
    );
  }

  it("labels both rows and names the leader at one instant", () => {
    const comparison = timelineComparison(series(), 90, labels);
    expect(comparison.rows).toEqual([
      { team: 0, label: "mon équipe", level: 5 },
      { team: 1, label: "les adversaires", level: 3 },
    ]);
    expect(comparison.leader).toBe(0);
    expect(comparison.lead).toBe(2);
    expect(comparison.leadLabel).toBe("mon équipe devant de 2 niveaux");
  });

  it("leaves the leader unknown before both teams have a level", () => {
    const early = buildMatchTimelineSeries(
      input({
        timeline: timeline({
          levelSnapshots: [{ battletag: "Me#1", atSeconds: 60, level: 5 }],
        }),
      }),
    );
    const comparison = timelineComparison(early, 90, labels);
    expect(comparison.lead).toBeNull();
    expect(comparison.leader).toBeNull();
    expect(comparison.leadLabel).toBeNull();
  });

  it("names team 1 as the leader on a negative lead", () => {
    const comparison = timelineComparison(series(), 190, { team0: "mon équipe", team1: "les adversaires" });
    expect(comparison.leader).toBe(1);
  });

  it("carries the structures and deaths inside the clustering window", () => {
    const comparison = timelineComparison(series(), 200, labels);
    expect(comparison.structures.map((event) => event.structureType)).toEqual(["fort"]);
    expect(comparison.deaths.map((death) => death.battletag)).toEqual(["Me#1"]);
  });

  it("reports nothing for deaths and structures far from the instant", () => {
    const comparison = timelineComparison(series(), 500, labels);
    expect(comparison.structures).toEqual([]);
    expect(comparison.deaths).toEqual([]);
  });
});
