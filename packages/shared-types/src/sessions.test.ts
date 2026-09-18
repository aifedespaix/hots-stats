import { describe, expect, test } from "bun:test";
import { CONTEXT_SESSION_GAP_MINUTES } from "./stats";
import { clusterSessions, sessionizeMatches, type SessionizableMatch } from "./sessions";

function m(matchId: string, playedAt: string): SessionizableMatch {
  return { matchId, playedAt };
}

describe("clusterSessions", () => {
  test("splits on a gap strictly greater than the shared threshold", () => {
    const sessions = clusterSessions([
      m("a", "2026-01-01T20:00:00.000Z"),
      m("b", "2026-01-01T21:29:00.000Z"),
      m("c", "2026-01-01T23:00:00.000Z"),
    ]);
    expect(sessions.map((session) => session.map((entry) => entry.matchId))).toEqual([["a", "b"], ["c"]]);
  });

  test("orders sessions oldest-first regardless of input order", () => {
    const sessions = clusterSessions([
      m("c", "2026-01-02T20:00:00.000Z"),
      m("a", "2026-01-01T20:00:00.000Z"),
      m("b", "2026-01-01T20:30:00.000Z"),
    ]);
    expect(sessions.map((session) => session.map((entry) => entry.matchId))).toEqual([["a", "b"], ["c"]]);
  });

  test("keeps the matches themselves, not only their ids", () => {
    const sessions = clusterSessions([{ ...m("a", "2026-01-01T20:00:00.000Z"), winner: true }]);
    expect(sessions[0]?.[0]?.winner).toBe(true);
  });

  test("returns no session for no matches", () => {
    expect(clusterSessions([])).toEqual([]);
  });
});

describe("sessionizeMatches", () => {
  test("groups matches 89 minutes apart and splits at 91", () => {
    const placements = sessionizeMatches([
      m("a", "2026-01-01T20:00:00.000Z"),
      m("b", "2026-01-01T21:29:00.000Z"),
      m("c", "2026-01-01T23:00:00.000Z"),
    ]);
    expect(placements.get("a")).toEqual({ position: 1, size: 2 });
    expect(placements.get("b")).toEqual({ position: 2, size: 2 });
    expect(placements.get("c")).toEqual({ position: 1, size: 1 });
  });

  test("is deterministic regardless of input order", () => {
    const a = m("a", "2026-01-01T20:00:00.000Z");
    const b = m("b", "2026-01-01T20:30:00.000Z");
    expect(sessionizeMatches([a, b]).get("b")).toEqual(sessionizeMatches([b, a]).get("b"));
  });

  test("uses the shared 90-minute gap constant by default", () => {
    expect(CONTEXT_SESSION_GAP_MINUTES).toBe(90);
  });

  test("returns an empty map for no matches", () => {
    expect(sessionizeMatches([]).size).toBe(0);
  });
});
