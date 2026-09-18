import { describe, expect, it } from "vitest";
import type { MatchTimelineData } from "~/types/coach";
import { buildMatchTimelineSeries, type MatchTimelineInput } from "./useMatchTimelineSeries";

function timeline(overrides: Partial<MatchTimelineData> = {}): MatchTimelineData {
  return { deaths: [], levelSnapshots: [], ...overrides };
}

function input(overrides: Partial<MatchTimelineInput> = {}): MatchTimelineInput {
  return {
    timeline: timeline(),
    players: [
      { battletag: "A#1", team: 0 },
      { battletag: "A#2", team: 0 },
      { battletag: "B#1", team: 1 },
    ],
    durationSeconds: 300,
    ...overrides,
  };
}

describe("buildMatchTimelineSeries lead curve", () => {
  it("has no level data when the match has no timeline", () => {
    const series = buildMatchTimelineSeries(input({ timeline: null }));
    expect(series.hasLevelData).toBe(false);
    expect(series.points).toEqual([]);
    expect(series.finalLead).toBeNull();
    expect(series.deaths).toEqual([]);
    expect(series.structures).toEqual([]);
  });

  it("has no level data when neither team has a level snapshot", () => {
    const series = buildMatchTimelineSeries(input());
    expect(series.hasLevelData).toBe(false);
  });

  it("carries each team's last known level forward between snapshots", () => {
    const series = buildMatchTimelineSeries(
      input({
        timeline: timeline({
          levelSnapshots: [
            { battletag: "A#1", atSeconds: 60, level: 2 },
            { battletag: "A#1", atSeconds: 120, level: 3 },
            { battletag: "B#1", atSeconds: 90, level: 2 },
            { battletag: "B#1", atSeconds: 150, level: 4 },
          ],
        }),
      }),
    );
    // t=60 has no team-1 level yet -> no point; t=90/120/150 both known.
    expect(series.points).toEqual([
      { atSeconds: 90, team0Level: 2, team1Level: 2, lead: 0 },
      { atSeconds: 120, team0Level: 3, team1Level: 2, lead: 1 },
      { atSeconds: 150, team0Level: 3, team1Level: 4, lead: -1 },
    ]);
    expect(series.finalLead).toBe(-1);
    expect(series.hasLevelData).toBe(true);
  });

  it("averages several snapshots from the same team at one timestamp", () => {
    const series = buildMatchTimelineSeries(
      input({
        timeline: timeline({
          levelSnapshots: [
            { battletag: "A#1", atSeconds: 60, level: 2 },
            { battletag: "A#2", atSeconds: 60, level: 4 },
            { battletag: "B#1", atSeconds: 60, level: 3 },
          ],
        }),
      }),
    );
    expect(series.points).toEqual([{ atSeconds: 60, team0Level: 3, team1Level: 3, lead: 0 }]);
  });

  it("ignores snapshots from battletags that are not in the match", () => {
    const series = buildMatchTimelineSeries(
      input({
        timeline: timeline({ levelSnapshots: [{ battletag: "Ghost#9", atSeconds: 10, level: 5 }] }),
      }),
    );
    expect(series.points).toEqual([]);
    expect(series.hasLevelData).toBe(false);
  });
});

describe("buildMatchTimelineSeries markers", () => {
  it("clusters each team's deaths by time and sizes the marker by the cluster", () => {
    const series = buildMatchTimelineSeries(
      input({
        timeline: timeline({
          deaths: [
            { battletag: "A#1", team: 0, atSeconds: 100 },
            { battletag: "A#2", team: 0, atSeconds: 104 },
            { battletag: "A#1", team: 0, atSeconds: 300 },
            { battletag: "B#1", team: 1, atSeconds: 150 },
          ],
        }),
      }),
    );
    expect(series.deaths).toEqual([
      { team: 0, atSeconds: 102, deaths: 2 },
      { team: 1, atSeconds: 150, deaths: 1 },
      { team: 0, atSeconds: 300, deaths: 1 },
    ]);
    expect(series.hasLevelData).toBe(false);
  });

  it("keeps structure events sorted by time, best-effort as ingested", () => {
    const series = buildMatchTimelineSeries(
      input({
        timeline: timeline({
          structureEvents: [
            { team: 1, atSeconds: 60, structureType: "fort" },
            { team: 0, atSeconds: 30, structureType: "keep" },
          ],
        }),
      }),
    );
    expect(series.structures).toEqual([
      { team: 0, atSeconds: 30, structureType: "keep" },
      { team: 1, atSeconds: 60, structureType: "fort" },
    ]);
  });
});
