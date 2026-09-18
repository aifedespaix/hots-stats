import type { DriverMetric } from "@hots-stats/shared-types";
import { describe, expect, test } from "vitest";
import { rankedModeQuery, selectWorkAxes } from "./useProgression";

function driver(overrides: Partial<DriverMetric>): DriverMetric {
  return {
    key: "k",
    label: "L",
    betterWhen: "lower",
    meanInWins: 0,
    meanInLosses: 0,
    effectSize: 0,
    winsSample: 20,
    lossesSample: 20,
    reliable: true,
    ...overrides,
  };
}

describe("selectWorkAxes", () => {
  test("keeps only reliable drivers", () => {
    const result = selectWorkAxes([
      driver({ key: "a", effectSize: 2, reliable: true }),
      driver({ key: "b", effectSize: 3, reliable: false }),
    ]);
    expect(result.map((entry) => entry.key)).toEqual(["a"]);
  });

  test("sorts reliable drivers by absolute effect size", () => {
    const result = selectWorkAxes([
      driver({ key: "a", effectSize: 0.5 }),
      driver({ key: "b", effectSize: -1.8 }),
      driver({ key: "c", effectSize: 1.2 }),
    ]);
    expect(result.map((entry) => entry.key)).toEqual(["b", "c", "a"]);
  });

  test("caps at three axes", () => {
    const result = selectWorkAxes(["a", "b", "c", "d"].map((key, i) => driver({ key, effectSize: i + 1 })));
    expect(result.map((entry) => entry.key)).toEqual(["d", "c", "b"]);
  });

  test("returns an empty list when nothing is reliable", () => {
    expect(selectWorkAxes([driver({ key: "a", reliable: false })])).toEqual([]);
  });
});

describe("rankedModeQuery", () => {
  test("covers exactly the ranked draft modes and no casual one", () => {
    const modes = rankedModeQuery().mode.split(",");
    expect(modes).toEqual(["UnrankedDraft", "HeroLeague", "TeamLeague", "StormLeague"]);
    expect(modes).not.toContain("QuickMatch");
    expect(modes).not.toContain("ARAM");
    expect(modes).not.toContain("Brawl");
    expect(modes).not.toContain("Custom");
  });
});
