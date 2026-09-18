import { describe, expect, test } from "bun:test";
import { type DeathMapCell, deathCellsToGrid } from "./spatial-grid";

describe("deathCellsToGrid", () => {
  test("turns the wire cells array into a cellIndex -> deaths grid", () => {
    const cells: DeathMapCell[] = [
      { cellIndex: 3, deaths: 2 },
      { cellIndex: 10, deaths: 5 },
    ];
    expect(deathCellsToGrid(cells)).toEqual({ "3": 2, "10": 5 });
  });

  test("adds duplicate cell indices instead of overwriting them", () => {
    const cells: DeathMapCell[] = [
      { cellIndex: 3, deaths: 2 },
      { cellIndex: 3, deaths: 1 },
    ];
    expect(deathCellsToGrid(cells)).toEqual({ "3": 3 });
  });

  test("an empty cells array is an empty grid", () => {
    expect(deathCellsToGrid([])).toEqual({});
  });
});
