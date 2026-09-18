import { describe, expect, test } from "vitest";
import { rankSelectorOptions } from "./talentSelectors";

interface Option {
  value: string;
  label: string;
  gamesPlayed: number;
}

function option(label: string, gamesPlayed: number): Option {
  return { value: label.toLowerCase(), label, gamesPlayed };
}

describe("rankSelectorOptions", () => {
  test("orders the most-played entries first", () => {
    const ranked = rankSelectorOptions([option("A", 3), option("B", 12), option("C", 7)], { hideUnplayed: false });
    expect(ranked.map((entry) => entry.label)).toEqual(["B", "C", "A"]);
  });

  test("breaks ties alphabetically", () => {
    const ranked = rankSelectorOptions([option("Zeratul", 5), option("Ana", 5)], { hideUnplayed: false });
    expect(ranked.map((entry) => entry.label)).toEqual(["Ana", "Zeratul"]);
  });

  test("hides entries with no games once the other select is chosen", () => {
    const ranked = rankSelectorOptions([option("A", 0), option("B", 4), option("C", 0)], { hideUnplayed: true });
    expect(ranked.map((entry) => entry.label)).toEqual(["B"]);
  });

  test("keeps unplayed entries -- last -- when nothing narrows the list", () => {
    const ranked = rankSelectorOptions([option("A", 0), option("B", 4), option("C", 0)], { hideUnplayed: false });
    expect(ranked.map((entry) => entry.label)).toEqual(["B", "A", "C"]);
  });

  test("leaves the input array untouched", () => {
    const input = [option("A", 1), option("B", 9)];
    rankSelectorOptions(input, { hideUnplayed: false });
    expect(input.map((entry) => entry.label)).toEqual(["A", "B"]);
  });
});
