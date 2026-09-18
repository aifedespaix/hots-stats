import { describe, expect, test } from "bun:test";
import {
  buildTrendResponse,
  buildTrendSeries,
  buildVersionChanges,
  computePeriodStats,
  type TrendMatchInput,
} from "./trend-series";

function match(
  overrides: Partial<TrendMatchInput> & { matchId: string; playedAt: string },
): TrendMatchInput {
  return {
    winner: false,
    durationSeconds: 1200,
    kills: 0,
    deaths: 0,
    assists: 0,
    experienceContribution: 0,
    gameVersion: "2.55.0.1",
    ...overrides,
  };
}

/** 25 chronological matches: 1..10 wins, 11..25 losses. */
function winThenLossSeries(): TrendMatchInput[] {
  return Array.from({ length: 25 }, (_, i) => {
    const index = i + 1;
    return match({
      matchId: "m" + String(index).padStart(2, "0"),
      playedAt: new Date(Date.UTC(2026, 0, index)).toISOString(),
      winner: index <= 10,
      kills: 4,
      deaths: 2,
      assists: 6,
    });
  });
}

describe("buildTrendSeries", () => {
  test("leaves rolling metrics null until the window fills, then uses the exact trailing window", () => {
    const points = buildTrendSeries(winThenLossSeries(), 20);
    expect(points).toHaveLength(25);
    for (let i = 0; i < 19; i++) {
      expect(points[i]!.rollingWinrate).toBeNull();
      expect(points[i]!.rollingKda).toBeNull();
      expect(points[i]!.rollingDeathsPer10Min).toBeNull();
    }
    // Point 20: trailing window = games 1..20 -> 10 wins / 20 = 0.5.
    expect(points[19]!.rollingWinrate).toBe(0.5);
    expect(points[19]!.rollingKda).toBe(5);
    expect(points[19]!.rollingDeathsPer10Min).toBe(1);
    // Point 25: trailing window = games 6..25 -> wins 6..10 = 5 / 20 = 0.25.
    expect(points[24]!.rollingWinrate).toBe(0.25);
  });

  test("numbers points 1-based and contiguous in chronological order even when input is shuffled", () => {
    const series = winThenLossSeries();
    const shuffled = [series[4]!, series[0]!, series[24]!, ...series.slice(1, 4), ...series.slice(5, 24)];
    const points = buildTrendSeries(shuffled, 20);
    expect(points.map((p) => p.index)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(points.map((p) => p.matchId)).toEqual(series.map((m) => m.matchId));
  });

  test("returns an empty series for no matches", () => {
    expect(buildTrendSeries([], 20)).toEqual([]);
  });

  test("a full window with zero deaths reports null KDA, never Infinity", () => {
    const series = Array.from({ length: 20 }, (_, i) =>
      match({ matchId: "m" + i, playedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString() }),
    );
    const points = buildTrendSeries(series, 20);
    expect(points[19]!.rollingKda).toBeNull();
    expect(points[19]!.rollingWinrate).toBe(0);
    expect(points[19]!.rollingDeathsPer10Min).toBe(0);
  });
});

describe("computePeriodStats", () => {
  test("weights per-minute rates by summed duration, not per-match ratios", () => {
    const stats = computePeriodStats([
      match({ matchId: "a", playedAt: "2026-01-01T00:00:00.000Z", durationSeconds: 600, experienceContribution: 10 }),
      match({ matchId: "b", playedAt: "2026-01-02T00:00:00.000Z", durationSeconds: 1800, experienceContribution: 30 }),
    ]);
    expect(stats.gamesPlayed).toBe(2);
    expect(stats.xpPerMinute).toBe(1);
    expect(stats.deathsPer10Min).toBe(0);
  });

  test("reports null KDA with no death and zero rates for zero duration", () => {
    const stats = computePeriodStats([
      match({ matchId: "a", playedAt: "2026-01-01T00:00:00.000Z", durationSeconds: 0, kills: 5, assists: 5 }),
    ]);
    expect(stats.kda).toBeNull();
    expect(stats.deathsPer10Min).toBe(0);
    expect(stats.xpPerMinute).toBe(0);
  });

  test("reads zeroes for an empty period", () => {
    expect(computePeriodStats([])).toEqual({
      gamesPlayed: 0,
      winrate: 0,
      kda: null,
      deathsPer10Min: 0,
      xpPerMinute: 0,
    });
  });
});

describe("buildVersionChanges", () => {
  test("emits one marker per known version change at the first match of the new version", () => {
    const points = buildTrendSeries(
      [
        match({ matchId: "m1", playedAt: "2026-01-01T00:00:00.000Z", gameVersion: "2.55.0" }),
        match({ matchId: "m2", playedAt: "2026-01-02T00:00:00.000Z", gameVersion: "2.55.0" }),
        match({ matchId: "m3", playedAt: "2026-01-03T00:00:00.000Z", gameVersion: "2.55.1" }),
        match({ matchId: "m4", playedAt: "2026-01-04T00:00:00.000Z", gameVersion: null }),
        match({ matchId: "m5", playedAt: "2026-01-05T00:00:00.000Z", gameVersion: "2.55.1" }),
        match({ matchId: "m6", playedAt: "2026-01-06T00:00:00.000Z", gameVersion: "2.56.0" }),
      ],
      20,
    );
    expect(buildVersionChanges(points)).toEqual([
      { atIndex: 3, gameVersion: "2.55.1", playedAt: "2026-01-03T00:00:00.000Z" },
      { atIndex: 6, gameVersion: "2.56.0", playedAt: "2026-01-06T00:00:00.000Z" },
    ]);
  });

  test("does not emit for a single known version nor duplicate one across an unknown gap", () => {
    const points = buildTrendSeries(
      [
        match({ matchId: "m1", playedAt: "2026-01-01T00:00:00.000Z", gameVersion: null }),
        match({ matchId: "m2", playedAt: "2026-01-02T00:00:00.000Z", gameVersion: "2.55.0" }),
        match({ matchId: "m3", playedAt: "2026-01-03T00:00:00.000Z", gameVersion: "2.55.0" }),
      ],
      20,
    );
    expect(buildVersionChanges(points)).toEqual([]);
  });
});

describe("buildTrendResponse", () => {
  test("omits comparison unless compareTo is passed", () => {
    const response = buildTrendResponse(winThenLossSeries(), { window: 20 });
    expect(response.window).toBe(20);
    expect(response.points).toHaveLength(25);
    expect(response.comparison).toBeUndefined();
  });

  test("splits at compareTo and computes each period over its own matches only", () => {
    const series = Array.from({ length: 10 }, (_, i) => {
      const index = i + 1;
      return match({
        matchId: "m" + index,
        playedAt: new Date(Date.UTC(2026, 0, index)).toISOString(),
        winner: index <= 5,
        durationSeconds: 600,
        experienceContribution: index <= 5 ? 10 : 20,
      });
    });
    const response = buildTrendResponse(series, { window: 20, compareTo: "2026-01-06T00:00:00.000Z" });
    expect(response.comparison).toHaveLength(2);
    const [previous, current] = response.comparison!;
    expect(previous).toEqual({
      label: "Période précédente",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-06T00:00:00.000Z",
      stats: { gamesPlayed: 5, winrate: 1, kda: null, deathsPer10Min: 0, xpPerMinute: 1 },
    });
    expect(current).toEqual({
      label: "Période actuelle",
      from: "2026-01-06T00:00:00.000Z",
      to: "2026-01-10T00:00:00.000Z",
      stats: { gamesPlayed: 5, winrate: 0, kda: null, deathsPer10Min: 0, xpPerMinute: 2 },
    });
  });
});
