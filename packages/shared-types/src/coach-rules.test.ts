import { describe, expect, test } from "bun:test";
import {
  EARLY_DEATH_BEFORE_SECONDS,
  buildFightClusters,
  earlyDeathsCount,
  firstDeathCount,
  levelAt,
  outnumberedDeaths,
  outnumberedDeathsCount,
  staggeredDeathEvents,
  staggeredDeathsCount,
  talentDelayFightEvents,
  talentDelayFightsCount,
  talentTierForLevel,
  type RuleDeath,
  type RuleLevelSnapshot,
  type RuleSubject,
} from "./coach-rules";

/** Seven-death fixture reused across the rule tests. Team 0: subject A plus
 * B/C/D; team 1: E. Meant to exercise every branch (single death, cross-team
 * fight, multi-teammate collapse). */
const richDeaths: RuleDeath[] = [
  { battletag: "A#1", team: 0, atSeconds: 100 },
  { battletag: "B#1", team: 0, atSeconds: 300 },
  { battletag: "E#1", team: 1, atSeconds: 305 },
  { battletag: "A#1", team: 0, atSeconds: 315 },
  { battletag: "C#1", team: 0, atSeconds: 585 },
  { battletag: "D#1", team: 0, atSeconds: 590 },
  { battletag: "A#1", team: 0, atSeconds: 600 },
];

const subject: RuleSubject = { battletag: "A#1", team: 0, kills: 5, deaths: 3, assists: 6 };
const enemyBattletags = ["E#1", "F#1", "G#1", "H#1", "I#1"];

describe("talentTierForLevel", () => {
  test("returns the highest tier reached, 0 before the first", () => {
    expect(talentTierForLevel(0)).toBe(0);
    expect(talentTierForLevel(1)).toBe(1);
    expect(talentTierForLevel(3)).toBe(1);
    expect(talentTierForLevel(4)).toBe(4);
    expect(talentTierForLevel(6)).toBe(4);
    expect(talentTierForLevel(7)).toBe(7);
    expect(talentTierForLevel(20)).toBe(20);
    expect(talentTierForLevel(25)).toBe(20);
  });
});

describe("buildFightClusters", () => {
  test("groups deaths chain-wise with a 15s gap and sorts them first", () => {
    const input = [25, 0, 60, 10, 61].map((atSeconds) => ({ atSeconds }));
    const clusters = buildFightClusters(input).map((c) => c.map((d) => d.atSeconds));
    expect(clusters).toEqual([
      [0, 10, 25],
      [60, 61],
    ]);
  });

  test("a gap of exactly 16s starts a new cluster", () => {
    const clusters = buildFightClusters([{ atSeconds: 0 }, { atSeconds: 16 }]).map((c) => c.length);
    expect(clusters).toEqual([1, 1]);
  });

  test("empty input yields no cluster", () => {
    expect(buildFightClusters([])).toEqual([]);
  });
});

describe("levelAt", () => {
  const snapshots: RuleLevelSnapshot[] = [
    { battletag: "A#1", atSeconds: 0, level: 1 },
    { battletag: "A#1", atSeconds: 100, level: 3 },
    { battletag: "A#1", atSeconds: 200, level: 5 },
    { battletag: "B#1", atSeconds: 150, level: 4 },
  ];

  test("returns the latest snapshot at or before the target", () => {
    expect(levelAt(snapshots, "A#1", 150)).toBe(3);
    expect(levelAt(snapshots, "A#1", 100)).toBe(3);
    expect(levelAt(snapshots, "A#1", 99)).toBe(1);
  });

  test("returns null with no snapshot that early or for another battletag", () => {
    expect(levelAt(snapshots, "A#1", -1)).toBe(null);
    expect(levelAt(snapshots, "C#1", 500)).toBe(null);
  });
});

describe("firstDeathCount", () => {
  test("no death at all is not a first death", () => {
    expect(firstDeathCount([], subject)).toEqual({ isFirst: false, atSeconds: null });
  });

  test("subject earliest of all 10", () => {
    expect(firstDeathCount(richDeaths, subject)).toEqual({ isFirst: true, atSeconds: 100 });
  });

  test("an enemy dying first is not a subject first death", () => {
    const deaths: RuleDeath[] = [
      { battletag: "A#1", team: 0, atSeconds: 100 },
      { battletag: "E#1", team: 1, atSeconds: 50 },
    ];
    expect(firstDeathCount(deaths, subject)).toEqual({ isFirst: false, atSeconds: 50 });
  });
});

describe("earlyDeathsCount", () => {
  const deaths: RuleDeath[] = [
    { battletag: "A#1", team: 0, atSeconds: 100 },
    { battletag: "A#1", team: 0, atSeconds: 350 },
    { battletag: "B#1", team: 0, atSeconds: 200 },
  ];

  test("counts only the subject deaths before the window", () => {
    expect(earlyDeathsCount(deaths, subject, EARLY_DEATH_BEFORE_SECONDS, 1200)).toEqual({
      occurrences: 1,
      evaluated: 1,
    });
  });

  test("a match that ended before the window is not evaluable", () => {
    expect(earlyDeathsCount(deaths, subject, EARLY_DEATH_BEFORE_SECONDS, 200)).toEqual({
      occurrences: 0,
      evaluated: 0,
    });
  });

  test("a match with no death log is not evaluable", () => {
    expect(earlyDeathsCount([], subject, EARLY_DEATH_BEFORE_SECONDS, 1200)).toEqual({
      occurrences: 0,
      evaluated: 0,
    });
  });
});

describe("outnumberedDeathsCount", () => {
  test("flags the collapse death and keeps both present estimates", () => {
    const count = outnumberedDeathsCount(richDeaths, subject);
    expect(count).toEqual({ occurrences: 1, evaluated: 3 });

    const events = outnumberedDeaths(richDeaths, subject);
    expect(events).toHaveLength(1);
    expect(events[0]!.atSeconds).toBe(600);
    expect(events[0]!.myTeamPresent).toBe(3);
    expect(events[0]!.enemyPresent).toBe(5);
  });
});

describe("staggeredDeathsCount", () => {
  test("counts the two deaths isolated after the first teammate", () => {
    expect(staggeredDeathsCount(richDeaths, subject)).toEqual({ occurrences: 2, evaluated: 2 });

    const { events } = staggeredDeathEvents(richDeaths, subject);
    expect(events.map((e) => e.atSeconds)).toEqual([315, 600]);
    expect(events.map((e) => e.delaySeconds)).toEqual([15, 15]);
  });

  test("a lone death has no teammate to be staggered against", () => {
    const deaths: RuleDeath[] = [{ battletag: "A#1", team: 0, atSeconds: 100 }];
    expect(staggeredDeathsCount(deaths, subject)).toEqual({ occurrences: 0, evaluated: 0 });
  });
});

describe("talentDelayFightsCount", () => {
  test("flags the cross-team fight when the subject is a tier behind", () => {
    const snapshots: RuleLevelSnapshot[] = [
      { battletag: "A#1", atSeconds: 0, level: 4 },
      ...enemyBattletags.map((battletag) => ({ battletag, atSeconds: 0, level: 7 })),
    ];
    expect(talentDelayFightsCount(richDeaths, snapshots, subject, enemyBattletags)).toEqual({
      occurrences: 1,
      evaluated: 1,
    });

    const { events } = talentDelayFightEvents(richDeaths, snapshots, subject, enemyBattletags);
    expect(events[0]!.atSeconds).toBe(300);
    expect(events[0]!.myTier).toBe(4);
    expect(events[0]!.enemyTier).toBe(7);
  });

  test("evaluates but does not flag a fight where the subject is ahead", () => {
    const snapshots: RuleLevelSnapshot[] = [
      { battletag: "A#1", atSeconds: 0, level: 7 },
      ...enemyBattletags.map((battletag) => ({ battletag, atSeconds: 0, level: 4 })),
    ];
    expect(talentDelayFightsCount(richDeaths, snapshots, subject, enemyBattletags)).toEqual({
      occurrences: 0,
      evaluated: 1,
    });
  });

  test("level-unknown fights are not evaluated", () => {
    expect(talentDelayFightsCount(richDeaths, [], subject, enemyBattletags)).toEqual({
      occurrences: 0,
      evaluated: 0,
    });
  });
});
