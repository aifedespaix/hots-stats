import { describe, expect, test } from "vitest";
import type { TrendPoint } from "@hots-stats/shared-types";
import { summarizeLastSession } from "./sessionSummary";

function point(matchId: string, playedAt: string, winner: boolean): TrendPoint {
  return {
    matchId,
    playedAt,
    winner,
    index: 0,
    rollingWinrate: null,
    rollingKda: null,
    rollingDeathsPer10Min: null,
    gameVersion: null,
  };
}

describe("summarizeLastSession", () => {
  test("returns null with no matches", () => {
    expect(summarizeLastSession([])).toBeNull();
  });

  test("summarises only the most recent cluster", () => {
    const summary = summarizeLastSession([
      point("old-1", "2026-01-01T18:00:00.000Z", true),
      point("old-2", "2026-01-01T18:30:00.000Z", false),
      point("new-1", "2026-01-02T20:00:00.000Z", true),
      point("new-2", "2026-01-02T20:40:00.000Z", true),
      point("new-3", "2026-01-02T21:10:00.000Z", false),
    ]);
    expect(summary).toMatchObject({
      gamesPlayed: 3,
      wins: 2,
      losses: 1,
      winrate: 2 / 3,
      startedAt: "2026-01-02T20:00:00.000Z",
      endedAt: "2026-01-02T21:10:00.000Z",
      lastResult: "loss",
    });
  });

  test("flags a below-threshold sample instead of concluding", () => {
    const summary = summarizeLastSession([point("a", "2026-01-01T20:00:00.000Z", true)]);
    expect(summary?.insufficientSample).toBe(true);
  });

  test("a 20-game session is no longer flagged", () => {
    const points = Array.from({ length: 20 }, (_, i) =>
      point("m" + i, new Date(Date.parse("2026-01-01T20:00:00.000Z") + i * 15 * 60_000).toISOString(), i % 2 === 0),
    );
    expect(summarizeLastSession(points)?.insufficientSample).toBe(false);
  });
});
