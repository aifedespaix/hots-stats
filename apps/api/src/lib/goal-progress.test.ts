import { describe, expect, test } from "bun:test";
import { PROGRESSION_MIN_MATCHES } from "@hots-stats/shared-types";
import type { DriverMatchInput } from "./driver-analysis";
import { computeGoalProgress } from "./goal-progress";

const CREATED = new Date("2026-09-01T00:00:00.000Z");
const BEFORE = "2026-08-31T23:59:59.000Z";
const AFTER = "2026-09-01T00:00:01.000Z";

function match(overrides: Partial<DriverMatchInput> = {}): DriverMatchInput {
  return {
    matchId: "m",
    playedAt: AFTER,
    winner: true,
    durationSeconds: 1200,
    kills: 5,
    deaths: 2,
    assists: 5,
    heroDamage: 30_000,
    experienceContribution: 12_000,
    teamKills: 20,
    earlyDeaths: 0,
    firstDeath: false,
    outnumberedDeaths: 0,
    levelAt10Min: 10,
    ...overrides,
  };
}

describe("computeGoalProgress", () => {
  test("averages the metric over every match played after creation", () => {
    const progress = computeGoalProgress(
      { metricKey: "earlyDeaths", targetValue: 1, direction: "atMost", createdAt: CREATED },
      [match({ earlyDeaths: 0 }), match({ earlyDeaths: 2 })],
    );
    expect(progress.currentValue).toBe(1);
    expect(progress.sampleSize).toBe(2);
    expect(progress.matchesSinceCreated).toBe(2);
    expect(progress.achieved).toBe(true);
  });

  test("AC2: ignores matches played at or before creation", () => {
    const progress = computeGoalProgress(
      { metricKey: "earlyDeaths", targetValue: 0, direction: "atMost", createdAt: CREATED },
      [match({ playedAt: BEFORE, earlyDeaths: 5 }), match({ earlyDeaths: 0 })],
    );
    expect(progress.matchesSinceCreated).toBe(1);
    expect(progress.currentValue).toBe(0);
  });

  test("an unreadable sample is null, never a fabricated 0", () => {
    const progress = computeGoalProgress(
      { metricKey: "avgHeroLevelAt10Min", targetValue: 12, direction: "atLeast", createdAt: CREATED },
      [match({ levelAt10Min: null }), match({ levelAt10Min: null })],
    );
    expect(progress.currentValue).toBeNull();
    expect(progress.sampleSize).toBe(0);
    expect(progress.matchesSinceCreated).toBe(2);
    expect(progress.achieved).toBe(false);
    expect(progress.ratio).toBeNull();
  });

  test("an unknown metric key can never claim a value", () => {
    const progress = computeGoalProgress(
      { metricKey: "mmr", targetValue: 1, direction: "atLeast", createdAt: CREATED },
      [match()],
    );
    expect(progress.currentValue).toBeNull();
    expect(progress.sampleSize).toBe(0);
  });

  test("direction decides whether the target is a floor or a ceiling", () => {
    const matches = [match({ durationSeconds: 600, experienceContribution: 5000 })]; // 500 xp/min
    const floor = computeGoalProgress(
      { metricKey: "xpPerMinute", targetValue: 400, direction: "atLeast", createdAt: CREATED },
      matches,
    );
    expect(floor.achieved).toBe(true);
    expect(floor.ratio).toBe(1);
    const ceiling = computeGoalProgress(
      { metricKey: "xpPerMinute", targetValue: 400, direction: "atMost", createdAt: CREATED },
      matches,
    );
    expect(ceiling.achieved).toBe(false);
    expect(ceiling.ratio).toBeCloseTo(0.8, 10);
  });

  test("a zero 'atMost' ceiling is binary and never divides by zero", () => {
    const atZero = computeGoalProgress(
      { metricKey: "earlyDeaths", targetValue: 0, direction: "atMost", createdAt: CREATED },
      [match({ earlyDeaths: 0 })],
    );
    expect(atZero.achieved).toBe(true);
    expect(atZero.ratio).toBe(1);
    const aboveZero = computeGoalProgress(
      { metricKey: "earlyDeaths", targetValue: 0, direction: "atMost", createdAt: CREATED },
      [match({ earlyDeaths: 1 })],
    );
    expect(aboveZero.achieved).toBe(false);
    expect(aboveZero.ratio).toBe(0);
  });

  test("marks the sample reliable only at the shared PROGRESSION_MIN_MATCHES gate", () => {
    const matches = (n: number) => Array.from({ length: n }, (_, i) => match({ matchId: "m" + i }));
    expect(
      computeGoalProgress(
        { metricKey: "earlyDeaths", targetValue: 1, direction: "atMost", createdAt: CREATED },
        matches(PROGRESSION_MIN_MATCHES - 1),
      ).reliable,
    ).toBe(false);
    expect(
      computeGoalProgress(
        { metricKey: "earlyDeaths", targetValue: 1, direction: "atMost", createdAt: CREATED },
        matches(PROGRESSION_MIN_MATCHES),
      ).reliable,
    ).toBe(true);
  });
});
