import { describe, expect, test } from "vitest";
import { buildWinrateSparkline } from "./sparkline";

describe("buildWinrateSparkline", () => {
  test("maps 0..1 onto a fixed 0..1 y-domain", () => {
    expect(buildWinrateSparkline([0, 1], 100, 20)).toEqual({
      segments: ["2,18 98,2"],
      last: { x: 98, y: 2 },
    });
  });

  test("breaks the line on null values", () => {
    expect(buildWinrateSparkline([0.5, null, 0.5], 100, 20)).toEqual({
      segments: ["2,10", "98,10"],
      last: { x: 98, y: 10 },
    });
  });

  test("clamps values outside 0..1 instead of drawing off-tile", () => {
    expect(buildWinrateSparkline([2, -1], 100, 20).segments).toEqual(["2,2 98,18"]);
  });

  test("plots a single value at the left edge", () => {
    expect(buildWinrateSparkline([0.5], 100, 20)).toEqual({
      segments: ["2,10"],
      last: { x: 2, y: 10 },
    });
  });

  test("returns nothing to plot for an empty or all-null series", () => {
    expect(buildWinrateSparkline([], 100, 20)).toEqual({ segments: [], last: null });
    expect(buildWinrateSparkline([null, null], 100, 20)).toEqual({ segments: [], last: null });
  });
});
