import { describe, expect, test } from "vitest";
import { summarizeComposition } from "./draftAssist";

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
