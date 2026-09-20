import { describe, expect, it } from "vitest";
import type { MatchTimelineData, MatchTimelineSeries } from "~/types/coach";
import {
  buildMatchTimelineSeries,
  buildMatchTimelineSummary,
  deathMarkerRadius,
  formatTimelineLevel,
  timelineLeadMax,
  timelineLeadY,
  timelineTeamLabels,
  timelineX,
  type MatchTimelineInput,
} from "./useMatchTimelineSeries";

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

function series(overrides: Partial<MatchTimelineSeries> = {}): MatchTimelineSeries {
  return {
    hasLevelData: true,
    points: [],
    finalLead: null,
    teamLevels: [[], []],
    deaths: [],
    structures: [],
    objectives: [],
    lanes: [],
    allDeaths: [],
    events: [],
    ...overrides,
  };
}

describe("timelineTeamLabels", () => {
  it("names the viewer's own team when it is known", () => {
    expect(timelineTeamLabels(0)).toEqual({ team0: "mon équipe", team1: "les adversaires" });
    expect(timelineTeamLabels(1)).toEqual({ team0: "les adversaires", team1: "mon équipe" });
  });

  it("falls back to neutral team numbers when the viewer is not in the match", () => {
    expect(timelineTeamLabels(null)).toEqual({ team0: "l'équipe 1", team1: "l'équipe 2" });
  });
});

describe("buildMatchTimelineSummary", () => {
  const labels = { team0: "mon équipe", team1: "les adversaires" };

  it("summarises a lead", () => {
    const summary = buildMatchTimelineSummary(
      series({ finalLead: 2, points: [{ atSeconds: 200, team0Level: 12, team1Level: 10, lead: 2 }] }),
      labels,
    );
    expect(summary).toBe("Niveau final : 12 – 10, mon équipe devant les adversaires (avance de 2 niveaux).");
  });

  it("summarises a deficit from the other side's point of view", () => {
    const summary = buildMatchTimelineSummary(
      series({ finalLead: -1, points: [{ atSeconds: 200, team0Level: 10, team1Level: 11, lead: -1 }] }),
      labels,
    );
    expect(summary).toBe("Niveau final : 11 – 10, les adversaires devant mon équipe (avance de 1 niveau).");
  });

  it("summarises an even game", () => {
    const summary = buildMatchTimelineSummary(
      series({ finalLead: 0, points: [{ atSeconds: 200, team0Level: 12, team1Level: 12, lead: 0 }] }),
      labels,
    );
    expect(summary).toBe("Niveau final : égalité 12 – 12.");
  });

  it("says so when there is no comparable point", () => {
    expect(buildMatchTimelineSummary(series({ points: [], finalLead: null }), labels)).toBe(
      "Chronologie indisponible : aucune donnée de niveau comparable.",
    );
  });
});

describe("formatTimelineLevel", () => {
  it("keeps a half level rather than rounding the difference away", () => {
    expect(formatTimelineLevel(12)).toBe("12");
    expect(formatTimelineLevel(12.5)).toBe("12.5");
  });
});

describe("timeline geometry", () => {
  it("maps a timestamp onto the width and clamps outside the match", () => {
    expect(timelineX(60, 120, 800)).toBe(400);
    expect(timelineX(200, 120, 800)).toBe(800);
    expect(timelineX(-10, 120, 800)).toBe(0);
  });

  it("maps everything to 0 when the match has no duration", () => {
    expect(timelineX(60, 0, 800)).toBe(0);
  });

  it("keeps a symmetric lead domain with a 1-level floor", () => {
    expect(timelineLeadMax([])).toBe(1);
    expect(timelineLeadMax([{ atSeconds: 0, team0Level: 1, team1Level: 1.5, lead: -0.5 }])).toBe(1);
    expect(
      timelineLeadMax([
        { atSeconds: 0, team0Level: 4, team1Level: 0, lead: 4 },
        { atSeconds: 1, team0Level: 0, team1Level: 2, lead: -2 },
      ]),
    ).toBe(4);
  });

  it("centres 0 and clamps leads to the domain", () => {
    expect(timelineLeadY(0, 4, 78, 62)).toBe(78);
    expect(timelineLeadY(4, 4, 78, 62)).toBe(16);
    expect(timelineLeadY(-4, 4, 78, 62)).toBe(140);
    expect(timelineLeadY(10, 4, 78, 62)).toBe(16);
  });

  it("sizes a death marker by its cluster, with a cap", () => {
    expect(deathMarkerRadius(1)).toBe(3);
    expect(deathMarkerRadius(2)).toBe(4.5);
    expect(deathMarkerRadius(100)).toBe(10);
  });
});

import { computed } from "vue";
import { useMatchTimelineSeries } from "./useMatchTimelineSeries";

describe("useMatchTimelineSeries", () => {
  it("starts at the end of the match and converts a scrubbed second back to a percent", () => {
    const source = computed(() => input({ durationSeconds: 200 }));
    const { scrubPercent, scrubSeconds, durationSeconds } = useMatchTimelineSeries(source);
    expect(durationSeconds.value).toBe(200);
    expect(scrubSeconds.value).toBe(200);

    scrubSeconds.value = 50;
    expect(scrubPercent.value).toBe(25);
    expect(scrubSeconds.value).toBe(50);
  });

  it("clamps the scrub position to the match's bounds", () => {
    const source = computed(() => input({ durationSeconds: 200 }));
    const { scrubSeconds } = useMatchTimelineSeries(source);
    scrubSeconds.value = 500;
    expect(scrubSeconds.value).toBe(200);
    scrubSeconds.value = -50;
    expect(scrubSeconds.value).toBe(0);
  });

  it("stays at 0 for a match with no duration", () => {
    const source = computed(() => input({ durationSeconds: 0 }));
    const { scrubSeconds } = useMatchTimelineSeries(source);
    scrubSeconds.value = 30;
    expect(scrubSeconds.value).toBe(0);
  });
});
