import { describe, expect, test } from "bun:test";
import type { ReplayPayload, ReplayPlayer, TalentPick } from "@hots-stats/shared-types";
import { checkReplayPlausibility, isAllZeroCombat } from "./replay-plausibility";

const NO_TALENTS: TalentPick[] = [];

function player(overrides: Partial<ReplayPlayer>): ReplayPlayer {
  return {
    battletag: "Player#1111",
    heroId: "Hero",
    team: 0,
    winner: true,
    kills: 0,
    deaths: 0,
    assists: 0,
    heroDamage: 0,
    siegeDamage: 0,
    healing: 0,
    selfHealing: 0,
    damageTaken: 0,
    experienceContribution: 0,
    talents: NO_TALENTS,
    ...overrides,
  };
}

function payload(overrides: Partial<ReplayPayload>): ReplayPayload {
  return {
    replayHash: "a".repeat(32),
    parserVersion: "1.14",
    map: "Cursed Hollow",
    gameMode: "QuickMatch",
    region: "eu",
    gameVersion: "2.55.15.96477",
    playedAt: new Date().toISOString(),
    durationSeconds: 1200,
    players: [],
    ...overrides,
  };
}

describe("isAllZeroCombat", () => {
  test("flags every player at 0 on every combat stat in a long enough match", () => {
    const players = [player({ battletag: "A#1" }), player({ battletag: "B#2" })];
    expect(isAllZeroCombat(players, 600)).toBe(true);
  });

  test("does not flag a short match (plausible early abandon)", () => {
    const players = [player({ battletag: "A#1" }), player({ battletag: "B#2" })];
    expect(isAllZeroCombat(players, 60)).toBe(false);
  });

  test("does not flag a match where at least one stat is non-zero", () => {
    const players = [player({ battletag: "A#1", kills: 1 }), player({ battletag: "B#2" })];
    expect(isAllZeroCombat(players, 600)).toBe(false);
  });
});

describe("checkReplayPlausibility", () => {
  test("rejects a match where every player is 0 on every combat stat", () => {
    const p = payload({
      durationSeconds: 600,
      players: [player({ battletag: "A#1" }), player({ battletag: "B#2" })],
    });
    expect(checkReplayPlausibility(p)).toContain("0 on every combat stat");
  });

  test("rejects 5 players sharing the exact same heroDamage regardless of kill count", () => {
    const players = Array.from({ length: 5 }, (_, i) =>
      player({ battletag: `P${i}#1`, heroDamage: 12345, kills: 0 }),
    );
    const p = payload({ players });
    expect(checkReplayPlausibility(p)).toContain("heroDamage");
  });

  test("does not reject a low-kill match where 5 players legitimately tie on experienceContribution", () => {
    // Regression: a team's sole takedown for the whole match, with the other
    // four teammates all assisting on it, legitimately ties experienceContribution
    // across all five -- see the comment above `_MIN_TOTAL_KILLS_FOR_EXPERIENCE_CONTRIBUTION_DUPLICATE_CHECK`.
    const players = [
      player({ battletag: "P0#1", kills: 1, heroDamage: 10000, experienceContribution: 500 }),
      player({ battletag: "P1#1", kills: 0, heroDamage: 8000, experienceContribution: 500 }),
      player({ battletag: "P2#1", kills: 0, heroDamage: 6000, experienceContribution: 500 }),
      player({ battletag: "P3#1", kills: 0, heroDamage: 4000, experienceContribution: 500 }),
      player({ battletag: "P4#1", kills: 0, heroDamage: 2000, experienceContribution: 500 }),
    ];
    const p = payload({ players });
    expect(checkReplayPlausibility(p)).toBeNull();
  });

  test("still rejects 5 players sharing the exact same experienceContribution in a high-kill match", () => {
    const players = Array.from({ length: 5 }, (_, i) =>
      player({ battletag: `P${i}#1`, kills: 1, heroDamage: 1000 + i, experienceContribution: 777 }),
    );
    const p = payload({ players });
    expect(checkReplayPlausibility(p)).toContain("experienceContribution");
  });

  test("returns null for a normal, well-differentiated match", () => {
    const players = [
      player({ battletag: "A#1", kills: 5, heroDamage: 40000, experienceContribution: 8000 }),
      player({ battletag: "B#2", kills: 3, heroDamage: 30000, experienceContribution: 7500 }),
      player({ battletag: "C#3", kills: 2, heroDamage: 20000, experienceContribution: 7000 }),
      player({ battletag: "D#4", kills: 1, heroDamage: 15000, experienceContribution: 6500 }),
      player({ battletag: "E#5", kills: 0, heroDamage: 10000, experienceContribution: 6000 }),
    ];
    const p = payload({ players });
    expect(checkReplayPlausibility(p)).toBeNull();
  });
});
