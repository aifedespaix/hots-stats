import { describe, expect, test } from "bun:test";
import { PROGRESSION_MIN_MATCHES } from "@hots-stats/shared-types";
import { buildSessionRecap, type SessionMatchInput } from "./session-recap";

function match(
  overrides: Partial<SessionMatchInput> & { matchId: string; playedAt: string },
): SessionMatchInput {
  return {
    winner: true,
    durationSeconds: 1200,
    kills: 5,
    deaths: 1,
    assists: 3,
    experienceContribution: 10000,
    gameVersion: "2.55.0",
    heroId: "li-ming",
    heroName: "Li-Ming",
    mapId: "cursed-hollow",
    mapName: "Bois maudit",
    ...overrides,
  };
}

/** n matches 15 minutes apart, all inside a single session. */
function block(startIso: string, count: number, prefix: string, winner = true): SessionMatchInput[] {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, index) =>
    match({
      matchId: prefix + index,
      playedAt: new Date(start + index * 15 * 60_000).toISOString(),
      winner,
    }),
  );
}

describe("buildSessionRecap", () => {
  test("uses the shared 90-minute clustering: 89 minutes apart is one session", () => {
    const recap = buildSessionRecap([
      match({ matchId: "a", playedAt: "2026-09-01T20:00:00.000Z" }),
      match({ matchId: "b", playedAt: "2026-09-01T21:29:00.000Z" }),
    ]);
    expect(recap.session?.matches.map((entry) => entry.matchId)).toEqual(["a", "b"]);
  });

  test("uses the shared 90-minute clustering: 91 minutes apart is two sessions", () => {
    const recap = buildSessionRecap([
      match({ matchId: "a", playedAt: "2026-09-01T20:00:00.000Z" }),
      match({ matchId: "b", playedAt: "2026-09-01T21:31:00.000Z" }),
    ]);
    expect(recap.session?.matches.map((entry) => entry.matchId)).toEqual(["b"]);
  });

  test("returns a null session with no match", () => {
    const recap = buildSessionRecap([]);
    expect(recap.session).toBeNull();
    expect(recap.baseline).toBeNull();
    expect(recap.baselineDelta).toBeNull();
    expect(recap.insufficientSample).toBe(true);
  });

  test("selects the last session starting at or before at", () => {
    const recap = buildSessionRecap(
      [
        match({ matchId: "a", playedAt: "2026-09-01T20:00:00.000Z" }),
        match({ matchId: "b", playedAt: "2026-09-02T20:00:00.000Z" }),
      ],
      "2026-09-01T22:00:00.000Z",
    );
    expect(recap.session?.matches.map((entry) => entry.matchId)).toEqual(["a"]);
  });

  test("a timestamp before the first match selects no session", () => {
    const recap = buildSessionRecap(
      [match({ matchId: "a", playedAt: "2026-09-01T20:00:00.000Z" })],
      "2026-08-01T00:00:00.000Z",
    );
    expect(recap.session).toBeNull();
  });

  test("a one-match session renders without division by zero and without a trend claim", () => {
    const recap = buildSessionRecap([
      match({ matchId: "solo", playedAt: "2026-09-01T20:00:00.000Z", winner: false, deaths: 0 }),
    ]);
    expect(recap.session?.stats).toMatchObject({
      gamesPlayed: 1,
      wins: 0,
      losses: 1,
      winrate: 0,
      kda: null,
    });
    expect(recap.baselineDelta).toBeNull();
    expect(recap.insufficientSample).toBe(true);
  });

  test("the baseline excludes the session's own matches", () => {
    const baseline = block("2026-09-01T10:00:00.000Z", 4, "b");
    const session = block("2026-09-02T20:00:00.000Z", 2, "s");
    const recap = buildSessionRecap([...baseline, ...session]);
    expect(recap.session?.matches).toHaveLength(2);
    expect(recap.baseline).toMatchObject({ gamesPlayed: 4, wins: 4 });
  });

  test("baselineDelta is null below PROGRESSION_MIN_MATCHES on either side", () => {
    const baseline = block("2026-09-01T10:00:00.000Z", PROGRESSION_MIN_MATCHES, "b");
    const session = block("2026-09-02T20:00:00.000Z", PROGRESSION_MIN_MATCHES - 1, "s");
    const recap = buildSessionRecap([...baseline, ...session]);
    expect(recap.insufficientSample).toBe(true);
    expect(recap.baselineDelta).toBeNull();
  });

  test("baselineDelta is exposed once both sides clear the gate", () => {
    const baseline = block("2026-09-01T10:00:00.000Z", PROGRESSION_MIN_MATCHES, "b", false);
    const session = block("2026-09-02T20:00:00.000Z", PROGRESSION_MIN_MATCHES, "s", true);
    const recap = buildSessionRecap([...baseline, ...session]);
    expect(recap.insufficientSample).toBe(false);
    expect(recap.baselineDelta?.winrate).toBeCloseTo(1);
  });

  test("kda delta is null when either side has no death", () => {
    const baseline = block("2026-09-01T10:00:00.000Z", PROGRESSION_MIN_MATCHES, "b").map((entry) => ({
      ...entry,
      deaths: 0,
    }));
    const session = block("2026-09-02T20:00:00.000Z", PROGRESSION_MIN_MATCHES, "s").map((entry) => ({
      ...entry,
      deaths: 2,
    }));
    const recap = buildSessionRecap([...baseline, ...session]);
    expect(recap.session?.stats.kda).not.toBeNull();
    expect(recap.baseline?.kda).toBeNull();
    expect(recap.baselineDelta?.kda).toBeNull();
  });

  test("lists every session most recent first, with its record", () => {
    const recap = buildSessionRecap([
      ...block("2026-09-01T20:00:00.000Z", 2, "older"),
      ...block("2026-09-02T20:00:00.000Z", 3, "newer", false),
    ]);
    expect(recap.sessions.map((entry) => entry.gamesPlayed)).toEqual([3, 2]);
    expect(recap.sessions[0]).toMatchObject({
      startedAt: "2026-09-02T20:00:00.000Z",
      endedAt: "2026-09-02T20:30:00.000Z",
      gamesPlayed: 3,
      wins: 0,
      losses: 3,
    });
    expect(recap.sessions[1]).toMatchObject({
      startedAt: "2026-09-01T20:00:00.000Z",
      endedAt: "2026-09-01T20:15:00.000Z",
      gamesPlayed: 2,
      wins: 2,
      losses: 0,
    });
    // The default recap is the one the picker shows first.
    expect(recap.session?.startedAt).toBe(recap.sessions[0]?.startedAt);
  });

  test("still lists every session when at selects an older one", () => {
    const recap = buildSessionRecap(
      [
        ...block("2026-09-01T20:00:00.000Z", 2, "older"),
        ...block("2026-09-02T20:00:00.000Z", 2, "newer"),
      ],
      "2026-09-01T22:00:00.000Z",
    );
    expect(recap.session?.startedAt).toBe("2026-09-01T20:00:00.000Z");
    expect(recap.sessions.map((entry) => entry.startedAt)).toEqual([
      "2026-09-02T20:00:00.000Z",
      "2026-09-01T20:00:00.000Z",
    ]);
  });

  test("lists no session at all with no match", () => {
    expect(buildSessionRecap([]).sessions).toEqual([]);
  });
});
