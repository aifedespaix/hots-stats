import { describe, expect, test } from "bun:test";
import { SPATIAL_GRID_COLS, SPATIAL_GRID_ROWS } from "@hots-stats/shared-types";
import type { Scope } from "./account-selection";
import { buildDeathMapResponse, normalizeLayer, rowInScope, type DeathMapRow } from "./death-map-aggregate";

const personal: Scope = { mode: "personal", battletags: ["Me#1"] };
const global: Scope = { mode: "global" };

function row(over: Partial<DeathMapRow> & { matchId: string }): DeathMapRow {
  return { battletag: "Me#1", layer: null, x: 0.5, y: 0.5, killType: "hero", ...over };
}

function build(rows: DeathMapRow[], over: Partial<Parameters<typeof buildDeathMapResponse>[0]> = {}) {
  return buildDeathMapResponse({
    mapId: "tomb",
    layer: null,
    calibrated: true,
    scope: personal,
    rows,
    gridCols: SPATIAL_GRID_COLS,
    gridRows: SPATIAL_GRID_ROWS,
    ...over,
  });
}

describe("normalizeLayer", () => {
  test("treats the db default-layer sentinel and absent layer as the same null layer", () => {
    expect(normalizeLayer("")).toBe(null);
    expect(normalizeLayer(null)).toBe(null);
    expect(normalizeLayer(undefined)).toBe(null);
    expect(normalizeLayer("bottom")).toBe("bottom");
  });
});

describe("rowInScope", () => {
  test("global accepts every row", () => {
    expect(rowInScope("Stranger#9", global)).toBe(true);
  });

  test("personal matches case-insensitively and rejects other players", () => {
    expect(rowInScope("me#1", personal)).toBe(true);
    expect(rowInScope("Other#2", personal)).toBe(false);
  });

  test("an empty personal scope accepts nobody", () => {
    expect(rowInScope("Me#1", { mode: "personal", battletags: [] })).toBe(false);
  });
});

describe("buildDeathMapResponse", () => {
  test("positionedDeaths <= totalDeaths and cells sum to positionedDeaths", () => {
    const result = build([
      row({ matchId: "m1", x: 0.1, y: 0.1 }),
      row({ matchId: "m1", x: 0.1, y: 0.1 }),
      row({ matchId: "m2", x: null, y: null }),
    ]);
    expect(result.totalDeaths).toBe(3);
    expect(result.positionedDeaths).toBe(2);
    expect(result.positionedDeaths).toBeLessThanOrEqual(result.totalDeaths);
    expect(result.cells.reduce((sum, c) => sum + c.deaths, 0)).toBe(result.positionedDeaths);
  });

  test("drops deaths that are not in the caller's scope, even if the sql did not", () => {
    const result = build([
      row({ matchId: "m1", battletag: "Me#1" }),
      row({ matchId: "m1", battletag: "Other#2" }),
      row({ matchId: "m2", battletag: "Other#3" }),
    ]);
    expect(result.totalDeaths).toBe(1);
    expect(result.matches).toBe(1);
  });

  test("keeps a global-scope death map unfiltered", () => {
    const result = build(
      [
        row({ matchId: "m1", battletag: "Me#1" }),
        row({ matchId: "m1", battletag: "Other#2" }),
      ],
      { scope: global },
    );
    expect(result.totalDeaths).toBe(2);
    expect(result.matches).toBe(1);
  });

  test("excludes deaths whose layer differs from the requested layer", () => {
    const result = build(
      [
        row({ matchId: "m1", layer: null }),
        row({ matchId: "m1", layer: "" }),
        row({ matchId: "m2", layer: "bottom" }),
      ],
      { layer: null },
    );
    expect(result.totalDeaths).toBe(2);
    const bottom = build(
      [
        row({ matchId: "m1", layer: null }),
        row({ matchId: "m2", layer: "bottom" }),
      ],
      { layer: "bottom" },
    );
    expect(bottom.totalDeaths).toBe(1);
    expect(bottom.layer).toBe("bottom");
  });

  test("an uncalibrated map is calibrated:false with empty cells and no positioned deaths", () => {
    const result = build([row({ matchId: "m1", x: 0.1, y: 0.1 }), row({ matchId: "m2" })], {
      calibrated: false,
    });
    expect(result.calibrated).toBe(false);
    expect(result.cells).toEqual([]);
    expect(result.clusters).toEqual([]);
    expect(result.positionedDeaths).toBe(0);
    expect(result.totalDeaths).toBe(2);
    expect(result.matches).toBe(2);
  });

  test("counts distinct matches and only known kill types", () => {
    const result = build([
      row({ matchId: "m1", killType: "hero" }),
      row({ matchId: "m1", killType: "other" }),
      row({ matchId: "m2", killType: null }),
    ]);
    expect(result.matches).toBe(2);
    expect(result.totalDeaths).toBe(3);
    expect(result.killTypeSplit).toEqual({ hero: 1, other: 1 });
  });

  test("groups adjacent cells into one cluster whose centroid is the densest cell", () => {
    const far = SPATIAL_GRID_ROWS * SPATIAL_GRID_COLS - 1;
    const result = build([
      row({ matchId: "m1", x: 0.001, y: 0.001 }),
      row({ matchId: "m1", x: 0.001, y: 0.001 }),
      row({ matchId: "m1", x: 0.001, y: 0.001 }),
      row({ matchId: "m1", x: 0.01, y: 0.001 }),
      row({ matchId: "m1", x: 0.999, y: 0.999 }),
    ]);
    expect(result.positionedDeaths).toBe(5);
    expect(result.cells).toEqual([
      { cellIndex: 0, deaths: 3 },
      { cellIndex: 1, deaths: 1 },
      { cellIndex: far, deaths: 1 },
    ]);
    expect(result.clusters[0]).toEqual({ cellIndex: 0, deaths: 4, share: 0.8 });
    expect(result.clusters[1]).toEqual({ cellIndex: far, deaths: 1, share: 0.2 });
  });

  test("returns the zeroed shape for an empty scope", () => {
    const result = build([]);
    expect(result.totalDeaths).toBe(0);
    expect(result.matches).toBe(0);
    expect(result.positionedDeaths).toBe(0);
    expect(result.cells).toEqual([]);
    expect(result.clusters).toEqual([]);
    expect(result.killTypeSplit).toEqual({ hero: 0, other: 0 });
    expect(result.grid).toEqual({ cols: SPATIAL_GRID_COLS, rows: SPATIAL_GRID_ROWS });
  });
});
