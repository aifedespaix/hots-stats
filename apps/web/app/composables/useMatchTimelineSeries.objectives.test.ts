import { describe, expect, test } from "vitest";
import { buildMatchTimelineSeries, type MatchTimelineInput } from "./useMatchTimelineSeries";

function input(timeline: MatchTimelineInput["timeline"]): MatchTimelineInput {
  return { timeline, players: [], durationSeconds: 600 };
}

describe("buildMatchTimelineSeries objectives", () => {
  test("carries objective events through, time-ordered", () => {
    const series = buildMatchTimelineSeries(
      input({
        deaths: [],
        levelSnapshots: [],
        objectives: [
          { kind: "tribute", team: 0, atSeconds: 120, detail: null },
          { kind: "mercenaryCamp", team: 1, atSeconds: 60, detail: "Siege Camp" },
        ],
      }),
    );

    expect(series.objectives.map((objective) => objective.atSeconds)).toEqual([60, 120]);
    expect(series.objectives[0]).toEqual({
      kind: "mercenaryCamp",
      team: 1,
      atSeconds: 60,
      detail: "Siege Camp",
    });
  });

  test("defaults objectives to an empty array without a timeline", () => {
    expect(buildMatchTimelineSeries(input(null)).objectives).toEqual([]);
  });

  test("keeps an empty array when the timeline carries no objectives", () => {
    expect(buildMatchTimelineSeries(input({ deaths: [], levelSnapshots: [] })).objectives).toEqual([]);
  });
});
