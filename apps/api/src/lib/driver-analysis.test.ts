import { describe, expect, test } from "bun:test";
import { PROGRESSION_MIN_PER_SIDE } from "@hots-stats/shared-types";
import { buildDriversResponse, cohensD, computeDrivers, type DriverMatchInput } from "./driver-analysis";

describe("cohensD", () => {
  test("standardizes the win-minus-loss mean difference by the pooled deviation", () => {
    // wins mean 3 (var 2), losses mean 1 (var 2) -> pooled sd sqrt(2).
    expect(cohensD([2, 4], [0, 2])).toBeCloseTo(Math.SQRT2, 10);
  });

  test("returns 0 when both sides hold the same single value", () => {
    expect(cohensD([1, 1, 1], [1, 1, 1])).toBe(0);
  });

  test("keeps the direction of a perfectly separated zero-variance split", () => {
    expect(cohensD([0, 0, 0], [2, 2, 2])).toBeLessThan(0);
    expect(cohensD([2, 2, 2], [0, 0, 0])).toBeGreaterThan(0);
  });

  test("returns 0 when one side is empty", () => {
    expect(cohensD([1, 2, 3], [])).toBe(0);
    expect(cohensD([], [1, 2, 3])).toBe(0);
  });
});

function match(overrides: Partial<DriverMatchInput> = {}): DriverMatchInput {
  return {
    matchId: "m",
    playedAt: "2026-01-01T00:00:00.000Z",
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

function series(count: number, overrides: Partial<DriverMatchInput>): DriverMatchInput[] {
  return Array.from({ length: count }, (_, i) => match({ matchId: "m" + i, ...overrides }));
}

describe("computeDrivers", () => {
  test("AC1: a clean early-death split is a negative effect for a lower-is-better metric", () => {
    const matches = [
      ...series(12, { winner: true, earlyDeaths: 0 }),
      ...series(12, { winner: false, earlyDeaths: 2 }),
    ];
    const earlyDeaths = computeDrivers(matches).find((d) => d.key === "earlyDeaths");
    expect(earlyDeaths).toBeDefined();
    expect(earlyDeaths!.betterWhen).toBe("lower");
    expect(earlyDeaths!.effectSize).toBeLessThan(0);
    expect(earlyDeaths!.meanInWins).toBe(0);
    expect(earlyDeaths!.meanInLosses).toBe(2);
  });

  test("AC2: a thin sample is flagged unreliable but still returned with its counts", () => {
    const matches = [...series(5, { winner: true }), ...series(5, { winner: false })];
    const earlyDeaths = computeDrivers(matches).find((d) => d.key === "earlyDeaths");
    expect(earlyDeaths!.reliable).toBe(false);
    expect(earlyDeaths!.winsSample).toBe(5);
    expect(earlyDeaths!.lossesSample).toBe(5);
  });

  test("AC3: an identical distribution on both sides reads 0, never NaN or Infinity", () => {
    const matches = [
      ...series(10, { winner: true, earlyDeaths: 1 }),
      ...series(10, { winner: false, earlyDeaths: 1 }),
    ];
    const drivers = computeDrivers(matches);
    for (const driver of drivers) expect(Number.isFinite(driver.effectSize)).toBe(true);
    expect(drivers.find((d) => d.key === "earlyDeaths")!.effectSize).toBe(0);
  });

  test("AC5: a metric whose source data is absent is omitted, the others stay", () => {
    const matches = series(20, {
      levelAt10Min: null,
      earlyDeaths: null,
      firstDeath: null,
      outnumberedDeaths: null,
    });
    const keys = computeDrivers(matches).map((d) => d.key);
    expect(keys).not.toContain("avgHeroLevelAt10Min");
    expect(keys).not.toContain("earlyDeaths");
    expect(keys).not.toContain("firstDeath");
    expect(keys).not.toContain("outnumberedDeaths");
    expect(keys).toContain("deathsPer10Min");
  });

  test("sorts reliable entries before unreliable ones", () => {
    const matches = [
      ...series(10, { winner: true, earlyDeaths: 1, levelAt10Min: null }),
      ...series(10, { winner: false, earlyDeaths: 1, levelAt10Min: null }),
      ...series(3, { winner: true, earlyDeaths: 1, levelAt10Min: 20 }),
      ...series(3, { winner: false, earlyDeaths: 1, levelAt10Min: 5 }),
    ];
    const keys = computeDrivers(matches).map((d) => d.key);
    expect(keys.indexOf("earlyDeaths")).toBeLessThan(keys.indexOf("avgHeroLevelAt10Min"));
  });

  test("omits kill participation when no team kill total was recorded", () => {
    const matches = [
      ...series(5, { winner: true, teamKills: 0 }),
      ...series(5, { winner: false, teamKills: 0 }),
    ];
    expect(computeDrivers(matches).map((d) => d.key)).not.toContain("killParticipation");
  });

  test("returns no drivers for an empty scope", () => {
    expect(computeDrivers([])).toEqual([]);
  });

  test("never emits NaN or Infinity on zero-duration matches", () => {
    const matches = [
      ...series(2, { winner: true, durationSeconds: 0 }),
      ...series(2, { winner: false, durationSeconds: 0 }),
    ];
    for (const driver of computeDrivers(matches)) expect(Number.isFinite(driver.effectSize)).toBe(true);
  });
});

describe("buildDriversResponse", () => {
  test("AC4: methodology names Cohen's d and the minimum sample, and counts the matches", () => {
    const response = buildDriversResponse(series(3, {}), "personal");
    expect(response.scope).toBe("personal");
    expect(response.matches).toBe(3);
    expect(response.methodology).toContain("Cohen");
    expect(response.methodology).toContain(String(PROGRESSION_MIN_PER_SIDE));
  });
});
