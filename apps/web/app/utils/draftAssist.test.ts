import { DRAFT_MIN_RANKED_GAMES_FOR_RANKING } from "@hots-stats/shared-types";
import { describe, expect, test } from "vitest";
import {
  DRAFT_ASSIST_CONTESTED_ROLE_PENALTY,
  rankBanSuggestions,
  rankPickSuggestions,
  summarizeComposition,
} from "./draftAssist";
import { wilsonLowerBound } from "./wilson";

function team(roles: Array<string | null>) {
  return roles.map((heroRole) => ({ heroRole }));
}

describe("summarizeComposition", () => {
  test("counts resolved roles, most frequent first", () => {
    const summary = summarizeComposition(team(["Tank", "Healer", "RangedAssassin", "RangedAssassin", "Bruiser"]));
    expect(summary.resolved).toBe(5);
    expect(summary.total).toBe(5);
    expect(summary.counts).toEqual([
      { role: "RangedAssassin", count: 2 },
      { role: "Bruiser", count: 1 },
      { role: "Healer", count: 1 },
      { role: "Tank", count: 1 },
    ]);
    expect(summary.warnings).toEqual([]);
    expect(summary.partial).toBe(false);
  });

  test("warns when a fully resolved team has no healer", () => {
    const summary = summarizeComposition(team(["Tank", "Bruiser", "RangedAssassin", "MeleeAssassin", "RangedAssassin"]));
    expect(summary.healerCount).toBe(0);
    expect(summary.warnings.map((warning) => warning.kind)).toEqual(["noHealer", "manyAssassins"]);
  });

  test("does not claim a missing healer while a slot is unresolved", () => {
    const summary = summarizeComposition(team(["Tank", "Bruiser", "RangedAssassin", null, null]));
    expect(summary.resolved).toBe(3);
    expect(summary.partial).toBe(true);
    expect(summary.warnings.map((warning) => warning.kind)).not.toContain("noHealer");
  });

  test("warns at exactly three assassins, not two", () => {
    const two = summarizeComposition(team(["Tank", "Healer", "RangedAssassin", "MeleeAssassin", "Bruiser"]));
    expect(two.warnings).toEqual([]);

    const three = summarizeComposition(team(["Tank", "Healer", "RangedAssassin", "MeleeAssassin", "RangedAssassin"]));
    expect(three.assassinCount).toBe(3);
    expect(three.warnings.map((warning) => warning.kind)).toEqual(["manyAssassins"]);
  });

  test("warns when a fully resolved team has no tank", () => {
    const summary = summarizeComposition(team(["Healer", "Bruiser", "RangedAssassin", "MeleeAssassin", "Support"]));
    expect(summary.tankCount).toBe(0);
    expect(summary.warnings.map((warning) => warning.kind)).toEqual(["noTank"]);
  });

  test("returns nothing to warn about for an empty team", () => {
    const summary = summarizeComposition([]);
    expect(summary).toMatchObject({ resolved: 0, total: 0, warnings: [], partial: false });
  });
});

function candidate(overrides: Partial<Parameters<typeof rankPickSuggestions>[0][number]>) {
  return {
    heroId: "h",
    heroName: "Hero",
    heroRole: "RangedAssassin",
    gamesPlayed: 20,
    wins: 10,
    winrate: 0.5,
    ...overrides,
  };
}

describe("rankPickSuggestions", () => {
  test("keeps confident records ahead of a three-game fluke", () => {
    const suggestions = rankPickSuggestions(
      [
        candidate({ heroId: "lucky", gamesPlayed: 3, wins: 3, winrate: 1 }),
        candidate({ heroId: "solid", gamesPlayed: 40, wins: 24, winrate: 0.6 }),
      ],
      [],
    );
    expect(suggestions.map((entry) => entry.heroId)).toEqual(["solid", "lucky"]);
    expect(suggestions[0]?.score).toBeCloseTo(wilsonLowerBound(24, 40));
  });

  test("orders confident heroes by their Wilson lower bound", () => {
    const suggestions = rankPickSuggestions(
      [
        candidate({ heroId: "low", gamesPlayed: 20, wins: 8 }),
        candidate({ heroId: "high", gamesPlayed: 20, wins: 14 }),
      ],
      [],
    );
    expect(suggestions.map((entry) => entry.heroId)).toEqual(["high", "low"]);
  });

  test("down-weights a role the team already picked", () => {
    const suggestions = rankPickSuggestions(
      [
        candidate({ heroId: "healer", heroName: "Healer", heroRole: "Healer", gamesPlayed: 20, wins: 11, winrate: 0.55 }),
        candidate({ heroId: "tank", heroName: "Tank", heroRole: "Tank", gamesPlayed: 20, wins: 10, winrate: 0.5 }),
      ],
      ["Healer"],
    );
    expect(suggestions.map((entry) => entry.heroId)).toEqual(["tank", "healer"]);
    expect(suggestions[1]?.score).toBeCloseTo(wilsonLowerBound(11, 20) - DRAFT_ASSIST_CONTESTED_ROLE_PENALTY);
  });

  test("flags a thin sample while keeping its game count", () => {
    const below = rankPickSuggestions([candidate({ gamesPlayed: DRAFT_MIN_RANKED_GAMES_FOR_RANKING - 1 })], []);
    expect(below[0]).toMatchObject({ gamesPlayed: DRAFT_MIN_RANKED_GAMES_FOR_RANKING - 1, smallSample: true });

    const atFloor = rankPickSuggestions([candidate({ gamesPlayed: DRAFT_MIN_RANKED_GAMES_FOR_RANKING })], []);
    expect(atFloor[0]?.smallSample).toBe(false);
  });

  test("caps the list at the requested limit", () => {
    const candidates = ["a", "b", "c", "d"].map((id) => candidate({ heroId: id }));
    expect(rankPickSuggestions(candidates, [], 2)).toHaveLength(2);
  });
});

function matchup(overrides: Partial<Parameters<typeof rankBanSuggestions>[0][number]["worstMatchups"][number]>) {
  return {
    heroId: "opp",
    heroName: "Opponent",
    heroRole: "RangedAssassin",
    gamesPlayed: 20,
    winrate: 0.4,
    deltaWinrate: -0.1,
    smallSample: false,
    ...overrides,
  };
}

describe("rankBanSuggestions", () => {
  test("bans the opponent with the most negative winrate delta", () => {
    const bans = rankBanSuggestions([
      {
        heroId: "likely",
        heroName: "Mon héros",
        worstMatchups: [
          matchup({ heroId: "x", heroName: "X", deltaWinrate: -0.1 }),
          matchup({ heroId: "y", heroName: "Y", deltaWinrate: -0.25 }),
        ],
      },
    ]);
    expect(bans.map((ban) => ban.heroId)).toEqual(["y", "x"]);
    expect(bans[0]).toMatchObject({ heroId: "y", counteredHeroId: "likely", counteredHeroName: "Mon héros" });
  });

  test("prefers a confident entry over a noisier, more negative one", () => {
    const bans = rankBanSuggestions([
      {
        heroId: "likely",
        heroName: "Mon héros",
        worstMatchups: [
          matchup({ heroId: "noisy", deltaWinrate: -0.5, smallSample: true }),
          matchup({ heroId: "solid", deltaWinrate: -0.1, smallSample: false }),
        ],
      },
    ]);
    expect(bans[0]?.heroId).toBe("solid");
  });

  test("collapses the same opponent seen through several likely heroes to its worst entry", () => {
    const bans = rankBanSuggestions([
      { heroId: "a", heroName: "A", worstMatchups: [matchup({ heroId: "x", deltaWinrate: -0.05, gamesPlayed: 30 })] },
      { heroId: "b", heroName: "B", worstMatchups: [matchup({ heroId: "x", deltaWinrate: -0.3, gamesPlayed: 8 })] },
    ]);
    expect(bans).toHaveLength(1);
    expect(bans[0]).toMatchObject({ heroId: "x", deltaWinrate: -0.3, gamesPlayed: 8, counteredHeroId: "b" });
  });

  test("caps the list at the requested limit", () => {
    const group = {
      heroId: "a",
      heroName: "A",
      worstMatchups: [matchup({ heroId: "x" }), matchup({ heroId: "y" }), matchup({ heroId: "z" })],
    };
    expect(rankBanSuggestions([group], 2)).toHaveLength(2);
  });
});
