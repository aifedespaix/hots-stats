import { describe, expect, test } from "bun:test";
import type { DriverMetric } from "@hots-stats/shared-types";
import type { DriverMatchInput } from "./driver-analysis";
import {
  type GoalSuggestionInput,
  type GoalSuggestionScope,
  buildGoalSuggestions,
  suggestedTarget,
  suggestionBaseline,
} from "./goal-suggestions";

function match(overrides: Partial<DriverMatchInput> = {}): DriverMatchInput {
  return {
    matchId: "m",
    playedAt: "2026-09-10T00:00:00.000Z",
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

const TWELVE = Array.from({ length: 12 }, (_, index) =>
  match({ matchId: `m${index}`, winner: index % 2 === 0 }),
);

function scope(overrides: Partial<GoalSuggestionScope> = {}): GoalSuggestionScope {
  return { group: "global", heroId: null, heroName: null, ...overrides };
}

function driver(overrides: Partial<DriverMetric> = {}): DriverMetric {
  return {
    key: "xpPerMinute",
    label: "XP / min",
    betterWhen: "higher",
    meanInWins: 500,
    meanInLosses: 400,
    effectSize: 0.5,
    winsSample: 5,
    lossesSample: 5,
    reliable: false,
    ...overrides,
  };
}

describe("suggestedTarget", () => {
  test("moves a floor metric up 10% and a ceiling metric down 10%", () => {
    expect(suggestedTarget("higher", 100)).toBe(110);
    expect(suggestedTarget("lower", 100)).toBe(90);
  });

  test("rounds to 2 decimals", () => {
    expect(suggestedTarget("higher", 33.333)).toBe(36.67);
    expect(suggestedTarget("lower", 1.239)).toBe(1.12);
  });
});

describe("suggestionBaseline", () => {
  test("reconstructs the overall mean from the two conditional means", () => {
    expect(suggestionBaseline(driver({ meanInWins: 10, winsSample: 3, meanInLosses: 4, lossesSample: 1 }))).toBe(8.5);
  });

  test("returns null with no readable sample", () => {
    expect(suggestionBaseline(driver({ winsSample: 0, lossesSample: 0 }))).toBeNull();
  });
});

describe("buildGoalSuggestions", () => {
  test("takes at most two axes per scope", () => {
    const suggestions = buildGoalSuggestions([{ scope: scope(), matches: TWELVE }]);
    expect(suggestions.length).toBe(2);
  });

  test("derives each target 10% past the displayed baseline, in the good direction", () => {
    const suggestions = buildGoalSuggestions([{ scope: scope(), matches: TWELVE }]);
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(suggestion.baselineValue).not.toBeNull();
      const betterWhen = suggestion.direction === "atLeast" ? "higher" : "lower";
      expect(suggestion.targetValue).toBe(suggestedTarget(betterWhen, suggestion.baselineValue as number));
      expect(suggestion.targetValue).toBeGreaterThan(0);
    }
  });

  test("carries the scope group and hero through to every suggestion", () => {
    const suggestions = buildGoalSuggestions([
      { scope: scope({ group: "topHero", heroId: "valla", heroName: "Valla" }), matches: TWELVE },
    ]);
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(suggestion.group).toBe("topHero");
      expect(suggestion.heroId).toBe("valla");
      expect(suggestion.heroName).toBe("Valla");
      expect(suggestion.rationale).toContain("Valla");
    }
  });

  test("returns nothing for a scope with no match", () => {
    expect(buildGoalSuggestions([{ scope: scope(), matches: [] }])).toEqual([]);
  });

  test("caps each scope independently across the three groups", () => {
    const inputs: GoalSuggestionInput[] = [
      { scope: scope(), matches: TWELVE },
      { scope: scope({ group: "topHero", heroId: "valla", heroName: "Valla" }), matches: TWELVE },
      { scope: scope({ group: "secondHero", heroId: "diablo", heroName: "Diablo" }), matches: TWELVE },
    ];
    const suggestions = buildGoalSuggestions(inputs);
    expect(suggestions.length).toBe(6);
    expect(suggestions.filter((s) => s.group === "global")).toHaveLength(2);
    expect(suggestions.filter((s) => s.group === "topHero")).toHaveLength(2);
    expect(suggestions.filter((s) => s.group === "secondHero")).toHaveLength(2);
  });
});
