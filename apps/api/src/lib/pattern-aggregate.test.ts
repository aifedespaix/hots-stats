import { describe, expect, test } from "bun:test";
import { PROGRESSION_MIN_MATCHES } from "@hots-stats/shared-types";
import {
  aggregatePatterns,
  resolveSubject,
  type PatternMatchInput,
  type RosterPlayer,
} from "./pattern-aggregate";

const subjectA = { battletag: "A#1", team: 0 as const, kills: 5, deaths: 1, assists: 3 };

function match(over: Partial<PatternMatchInput> & { matchId: string }): PatternMatchInput {
  return {
    playedAt: "2026-09-01T10:00:00.000Z",
    durationSeconds: 1200,
    winner: true,
    subject: { battletag: "A#1", team: 0, kills: 0, deaths: 0, assists: 0 },
    deaths: [],
    levelSnapshots: [],
    enemyBattletags: [],
    hasTimeline: false,
    hasPositions: false,
    ...over,
  };
}

describe("resolveSubject", () => {
  const roster: RosterPlayer[] = [
    { battletag: "ABUSER#9", team: 1, kills: 0, deaths: 0, assists: 0, winner: false },
    { battletag: "Me#1111", team: 0, kills: 1, deaths: 0, assists: 0, winner: true },
    { battletag: "Other#2222", team: 0, kills: 2, deaths: 0, assists: 0, winner: true },
  ];

  test("picks the scope's first account, case-insensitively", () => {
    expect(resolveSubject(roster, ["other#2222", "ME#1111"])?.battletag).toBe("Other#2222");
    expect(resolveSubject(roster, ["me#1111"])?.battletag).toBe("Me#1111");
  });

  test("returns null when no scoped account played the match", () => {
    expect(resolveSubject(roster, ["Stranger#3"])).toBe(null);
  });
});

describe("aggregatePatterns", () => {
  test("sums the rules and never counts a timeline-less match as a first death", () => {
    const m1 = match({
      matchId: "m1",
      winner: true,
      durationSeconds: 1200,
      subject: subjectA,
      deaths: [
        { battletag: "A#1", team: 0, atSeconds: 100 },
        { battletag: "B#1", team: 1, atSeconds: 300 },
      ],
      enemyBattletags: ["B#1"],
      hasTimeline: true,
    });
    const m2 = match({
      matchId: "m2",
      playedAt: "2026-09-01T11:00:00.000Z",
      winner: false,
      durationSeconds: 900,
      subject: { battletag: "A#1", team: 0, kills: 2, deaths: 1, assists: 1 },
    });
    const m3 = match({
      matchId: "m3",
      playedAt: "2026-09-01T12:00:00.000Z",
      winner: true,
      durationSeconds: 1800,
      subject: { battletag: "A#1", team: 0, kills: 0, deaths: 0, assists: 2 },
      levelSnapshots: [
        { battletag: "A#1", atSeconds: 0, level: 4 },
        { battletag: "B#1", atSeconds: 0, level: 7 },
      ],
      enemyBattletags: ["B#1"],
      hasTimeline: true,
    });

    const aggregate = aggregatePatterns([m1, m2, m3]);

    expect(aggregate.matches).toBe(3);
    expect(aggregate.insufficientSample).toBe(true);
    // m2 has no timeline rows: it must not dilute the first-death denominator.
    expect(aggregate.firstDeathRate).toBe(1);
    expect(aggregate.earlyDeathRate).toBe(1);
    expect(aggregate.outnumberedDeathRate).toBe(0);
    expect(aggregate.outnumberedDeaths).toBe(0);
    expect(aggregate.staggeredDeathRate).toBe(0);
    expect(aggregate.talentDelayRate).toBe(0);
    expect(aggregate.talentDelayFights).toBe(0);
    expect(aggregate.timeDeadShare).toBeCloseTo(50 / 3900, 10);
    expect(aggregate.deathsPer10Min).toBeCloseTo(2 / (3900 / 600), 10);
    expect(aggregate.coverage).toEqual({ withTimeline: 2, withLevelSnapshots: 1, withPositions: 0 });

    expect(aggregate.perMatch.map((p) => p.matchId)).toEqual(["m1", "m2", "m3"]);
    expect(aggregate.perMatch[0]).toMatchObject({
      deaths: 1,
      isFirstDeath: true,
      earlyDeaths: 1,
      outnumberedDeaths: 0,
      staggeredDeaths: 0,
      talentDelayFights: 0,
    });
    expect(aggregate.perMatch[1]).toMatchObject({ deaths: 1, isFirstDeath: false, earlyDeaths: 0 });
    expect(aggregate.perMatch[2]).toMatchObject({ deaths: 0, isFirstDeath: false, earlyDeaths: 0 });
  });

  test("returns the zeroed aggregate for an empty scope", () => {
    const aggregate = aggregatePatterns([]);
    expect(aggregate.matches).toBe(0);
    expect(aggregate.insufficientSample).toBe(true);
    expect(aggregate.perMatch).toEqual([]);
    expect(aggregate.coverage).toEqual({ withTimeline: 0, withLevelSnapshots: 0, withPositions: 0 });
    expect(aggregate.timeDeadShare).toBe(0);
    expect(aggregate.deathsPer10Min).toBe(0);
  });

  test("clears insufficientSample at the shared match threshold", () => {
    const below = Array.from({ length: PROGRESSION_MIN_MATCHES - 1 }, (_, i) => match({ matchId: "m" + i }));
    const at = Array.from({ length: PROGRESSION_MIN_MATCHES }, (_, i) => match({ matchId: "m" + i }));
    expect(aggregatePatterns(below).insufficientSample).toBe(true);
    expect(aggregatePatterns(at).insufficientSample).toBe(false);
  });

  test("keeps a short match out of the early-death denominator", () => {
    const shortMatch = match({
      matchId: "short",
      durationSeconds: 120,
      subject: subjectA,
      deaths: [{ battletag: "A#1", team: 0, atSeconds: 60 }],
      hasTimeline: true,
    });
    const aggregate = aggregatePatterns([shortMatch]);
    expect(aggregate.earlyDeathRate).toBe(0);
    expect(aggregate.perMatch[0]!.earlyDeaths).toBe(0);
  });
});
