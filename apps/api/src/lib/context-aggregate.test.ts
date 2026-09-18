import { describe, expect, test } from "bun:test";
import { CONTEXT_SESSION_GAP_MINUTES, PROGRESSION_MIN_MATCHES } from "@hots-stats/shared-types";
import { buildContextResponse, sessionizeMatches, type ContextMatchInput } from "./context-aggregate";

function match(
  overrides: Partial<ContextMatchInput> & { matchId: string; playedAt: string },
): ContextMatchInput {
  return { winner: false, gameVersion: "2.55.0", teamRoleCounts: { Tank: 1 }, ...overrides };
}

function breakdown(response: ReturnType<typeof buildContextResponse>, dimension: string) {
  const found = response.breakdowns.find((entry) => entry.dimension === dimension);
  if (!found) throw new Error("missing breakdown " + dimension);
  return found;
}

describe("sessionizeMatches", () => {
  test("groups matches 89 minutes apart and splits at 91", () => {
    const placements = sessionizeMatches([
      match({ matchId: "a", playedAt: "2026-01-01T20:00:00.000Z" }),
      match({ matchId: "b", playedAt: "2026-01-01T21:29:00.000Z" }),
      match({ matchId: "c", playedAt: "2026-01-01T23:00:00.000Z" }),
    ]);
    expect(placements.get("a")).toEqual({ position: 1, size: 2 });
    expect(placements.get("b")).toEqual({ position: 2, size: 2 });
    expect(placements.get("c")).toEqual({ position: 1, size: 1 });
  });

  test("is deterministic regardless of input order", () => {
    const a = match({ matchId: "a", playedAt: "2026-01-01T20:00:00.000Z" });
    const b = match({ matchId: "b", playedAt: "2026-01-01T20:30:00.000Z" });
    expect(sessionizeMatches([a, b]).get("b")).toEqual(sessionizeMatches([b, a]).get("b"));
  });

  test("uses the shared 90-minute gap constant by default", () => {
    expect(CONTEXT_SESSION_GAP_MINUTES).toBe(90);
  });

  test("returns an empty map for no matches", () => {
    expect(sessionizeMatches([]).size).toBe(0);
  });
});

describe("buildContextResponse", () => {
  test("buckets the hour in the caller timezone offset", () => {
    const response = buildContextResponse(
      [match({ matchId: "a", playedAt: "2026-01-01T23:30:00.000Z", winner: true })],
      "personal",
      -120,
    );
    const hour = breakdown(response, "hour");
    expect(hour.buckets).toHaveLength(24);
    expect(hour.buckets[21]).toMatchObject({ gamesPlayed: 1, wins: 1, winrate: 1 });
    expect(hour.buckets[23]).toMatchObject({ gamesPlayed: 0, winrate: 0 });
  });

  test("buckets the weekday from the local date, Monday first", () => {
    // 2026-01-05 is a Monday.
    const response = buildContextResponse(
      [match({ matchId: "a", playedAt: "2026-01-05T12:00:00.000Z" })],
      "personal",
      0,
    );
    const weekday = breakdown(response, "weekday");
    expect(weekday.buckets).toHaveLength(7);
    expect(weekday.buckets[0]).toMatchObject({ key: "1", label: "Lundi", gamesPlayed: 1 });
  });

  test("buckets session position and size from the cluster placement", () => {
    const response = buildContextResponse(
      [
        match({ matchId: "a", playedAt: "2026-01-01T20:00:00.000Z" }),
        match({ matchId: "b", playedAt: "2026-01-01T20:30:00.000Z" }),
        match({ matchId: "c", playedAt: "2026-01-01T23:00:00.000Z" }),
      ],
      "personal",
      0,
    );
    expect(breakdown(response, "sessionPosition").buckets.map((b) => [b.key, b.gamesPlayed])).toEqual([
      ["1", 2],
      ["2", 1],
    ]);
    expect(breakdown(response, "sessionSize").buckets.map((b) => [b.key, b.gamesPlayed])).toEqual([
      ["1", 1],
      ["2", 2],
    ]);
  });

  test("adds an explicit unknown patch bucket for null versions", () => {
    const response = buildContextResponse(
      [
        match({ matchId: "a", playedAt: "2026-01-01T20:00:00.000Z", gameVersion: "2.55.0" }),
        match({ matchId: "b", playedAt: "2026-01-01T20:30:00.000Z", gameVersion: null }),
      ],
      "personal",
      0,
    );
    expect(breakdown(response, "patch").buckets).toEqual([
      expect.objectContaining({ key: "2.55.0", gamesPlayed: 1 }),
      expect.objectContaining({ key: "unknown", label: "Version inconnue", gamesPlayed: 1 }),
    ]);
  });

  test("buckets team compositions from the supplied role counts", () => {
    const response = buildContextResponse(
      [
        match({
          matchId: "a",
          playedAt: "2026-01-01T20:00:00.000Z",
          teamRoleCounts: { Tank: 1, Healer: 1, RangedAssassin: 3 },
        }),
        match({
          matchId: "b",
          playedAt: "2026-01-01T20:30:00.000Z",
          teamRoleCounts: { Tank: 1, Healer: 1, RangedAssassin: 3 },
        }),
      ],
      "personal",
      0,
    );
    const composition = breakdown(response, "teamComposition");
    expect(composition.buckets).toHaveLength(1);
    expect(composition.buckets[0]).toMatchObject({
      gamesPlayed: 2,
      label: "1× Tank · 3× Assassin à distance · 1× Soigneur",
    });
  });

  test("flags every bucket below the shared gate instead of hiding it", () => {
    const response = buildContextResponse(
      [match({ matchId: "a", playedAt: "2026-01-01T20:00:00.000Z" })],
      "personal",
      0,
    );
    const hour = breakdown(response, "hour");
    expect(hour.buckets[20]).toMatchObject({ gamesPlayed: 1, insufficientSample: true });
    expect(response.matches).toBe(1);
    expect(PROGRESSION_MIN_MATCHES).toBe(20);
  });

  test("returns zeroed breakdowns for an empty match set", () => {
    const response = buildContextResponse([], "personal", 120);
    expect(response.matches).toBe(0);
    expect(response.tzOffsetMinutes).toBe(120);
    expect(response.breakdowns.map((entry) => entry.dimension)).toEqual([
      "hour",
      "weekday",
      "sessionPosition",
      "sessionSize",
      "patch",
      "teamComposition",
    ]);
    expect(breakdown(response, "hour").buckets).toHaveLength(24);
    expect(breakdown(response, "weekday").buckets).toHaveLength(7);
    expect(breakdown(response, "sessionPosition").buckets).toEqual([]);
    expect(breakdown(response, "teamComposition").buckets).toEqual([]);
  });
});
