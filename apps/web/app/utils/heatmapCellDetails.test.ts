import { describe, expect, it } from "vitest";
import type { MatchTimelineDeath } from "~/types/coach";
import {
  actorLabel,
  buildCellDetail,
  buildDeathCellIndex,
  cellIndexFromRect,
  computeCellTotals,
  formatCellSeconds,
  formatClock,
  isCellDetailEmpty,
  presenceLabelFor,
  type CellPresenceLayer,
  type HeatmapPlayerLabels,
} from "./heatmapCellDetails";

const labels: HeatmapPlayerLabels = {
  "Me#1": { name: "Jaina", side: "me" },
  "Ally#1": { name: "Raynor", side: "ally" },
  "Enemy#1": { name: "Kael'thas", side: "enemy" },
};

function layer(overrides: Partial<CellPresenceLayer> = {}): CellPresenceLayer {
  return { grid: {}, colorRgb: [10, 20, 30], ...overrides };
}

function death(overrides: Partial<MatchTimelineDeath> = {}): MatchTimelineDeath {
  return { battletag: "Enemy#1", team: 1, atSeconds: 100, x: 0.5, y: 0.5, ...overrides };
}

describe("cellIndexFromRect", () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };

  it("flips screen Y back into the grid's bottom-up row 0", () => {
    // Top-left of the image is the map's *top*, i.e. the grid's highest row.
    expect(cellIndexFromRect(5, 5, rect, 10, 10)).toBe(90);
    expect(cellIndexFromRect(95, 95, rect, 10, 10)).toBe(9);
  });

  it("accounts for the rect's own offset", () => {
    expect(cellIndexFromRect(105, 105, { left: 100, top: 100, width: 100, height: 100 }, 10, 10)).toBe(90);
  });

  it("returns null for a not-yet-laid-out image", () => {
    expect(cellIndexFromRect(5, 5, { left: 0, top: 0, width: 0, height: 0 }, 10, 10)).toBeNull();
  });
});

describe("buildDeathCellIndex", () => {
  it("buckets positioned deaths and sorts each bucket by time", () => {
    const index = buildDeathCellIndex(
      [
        death({ battletag: "A", atSeconds: 300, x: 0.9, y: 0.9 }),
        death({ battletag: "B", atSeconds: 100, x: 0.9, y: 0.9 }),
        death({ battletag: "C", atSeconds: 200, x: 0.05, y: 0.05 }),
      ],
      10,
      10,
    );
    expect([...index.keys()].sort((a, b) => a - b)).toEqual([0, 99]);
    expect(index.get(99)!.map((d) => d.battletag)).toEqual(["B", "A"]);
    expect(index.get(0)!.map((d) => d.battletag)).toEqual(["C"]);
  });

  it("ignores deaths with no recorded position", () => {
    const index = buildDeathCellIndex([death({ x: undefined, y: undefined })], 10, 10);
    expect(index.size).toBe(0);
  });
});

describe("actor labels", () => {
  it("names the hero and the side, and says Toi for the viewer", () => {
    expect(actorLabel("Me#1", labels)).toBe("Toi (Jaina)");
    expect(actorLabel("Ally#1", labels)).toBe("Raynor (allié)");
    expect(actorLabel("Enemy#1", labels)).toBe("Kael'thas (ennemi)");
  });

  it("falls back to the raw battletag for an unlabelled player", () => {
    expect(actorLabel("Stranger#9", labels)).toBe("Stranger#9");
  });

  it("decorates presence layer labels the same way", () => {
    expect(presenceLabelFor("Jaina", "me")).toBe("Toi (Jaina)");
    expect(presenceLabelFor("Raynor", "ally")).toBe("Raynor (allié)");
    expect(presenceLabelFor(undefined, undefined)).toBe("Présence");
  });
});

describe("buildCellDetail presence", () => {
  it("keeps only occupied layers, sorted by time, with a share of each layer's own total", () => {
    const layers = [
      layer({ grid: { "5": 6, "6": 4 }, label: "Jaina", side: "me" }),
      layer({ grid: { "5": 2 }, label: "Raynor", side: "ally" }),
    ];
    const totals = computeCellTotals({ layers });
    const detail = buildCellDetail({ cellIndex: 5, layers, totals });

    expect(detail.presence.map((line) => line.label)).toEqual(["Toi (Jaina)", "Raynor (allié)"]);
    expect(detail.presence[0]).toMatchObject({ seconds: 6, share: 0.6, isMe: true });
    expect(detail.totalSeconds).toBe(8);
  });

  it("caps the list and reports how many layers were hidden", () => {
    const layers = Array.from({ length: 6 }, (_, i) => layer({ grid: { "5": 1 }, label: "H" + i }));
    const totals = computeCellTotals({ layers });
    const detail = buildCellDetail({ cellIndex: 5, layers, totals, maxPresenceLines: 2 });
    expect(detail.presence).toHaveLength(2);
    expect(detail.presenceHidden).toBe(4);
  });
});

describe("buildCellDetail events", () => {
  it("writes who killed whom, marking the viewer's own hero", () => {
    const cellDeaths = [
      death({ battletag: "Enemy#1", atSeconds: 312, killers: ["Me#1"], killType: "hero" }),
      death({ battletag: "Me#1", team: 0, atSeconds: 100, killers: ["Enemy#1"], killType: "hero" }),
    ];
    const totals = computeCellTotals({ layers: [], deaths: cellDeaths, activeBattletags: new Set(["Me#1"]) });
    const detail = buildCellDetail({
      cellIndex: 5,
      layers: [],
      totals,
      cellDeaths,
      playerLabels: labels,
      activeBattletags: new Set(["Me#1"]),
    });

    expect(detail.events).toEqual([
      { atSeconds: 100, text: "Kael'thas (ennemi) a tué Toi (Jaina)", isMe: true },
      { atSeconds: 312, text: "Toi (Jaina) a tué Kael'thas (ennemi)", isMe: true },
    ]);
    expect(detail.eventsHidden).toBe(0);
    expect([detail.kills, detail.deaths]).toEqual([1, 1]);
  });

  it("counts a kill per credited killer, and only for the selected heroes", () => {
    const cellDeaths = [death({ battletag: "Me#1", team: 0, killers: ["Ally#1", "Enemy#1"] })];
    const mineOnly = computeCellTotals({ layers: [], deaths: cellDeaths, activeBattletags: new Set(["Me#1"]) });
    const wholeTeam = computeCellTotals({ layers: [], deaths: cellDeaths, activeBattletags: new Set(["Me#1", "Ally#1"]) });

    expect(mineOnly).toMatchObject({ kills: 0, deaths: 1 });
    expect(wholeTeam).toMatchObject({ kills: 1, deaths: 1 });
  });

  it("describes a kill with several credited killers and a non-hero death", () => {
    const detail = buildCellDetail({
      cellIndex: 5,
      layers: [],
      totals: { layers: [], kills: 0, deaths: 0 },
      cellDeaths: [
        death({ battletag: "Enemy#1", atSeconds: 20, killers: ["Ally#1", "Me#1"] }),
        death({ battletag: "Enemy#1", atSeconds: 40, killers: [], killType: "other" }),
      ],
      playerLabels: labels,
    });
    expect(detail.events.map((e) => e.text)).toEqual([
      "Raynor (allié) + Toi (Jaina) ont tué Kael'thas (ennemi)",
      "Kael'thas (ennemi) est mort (cause non-héroïque)",
    ]);
  });

  it("caps the event list", () => {
    const cellDeaths = Array.from({ length: 7 }, (_, i) => death({ atSeconds: i, killers: ["Me#1"] }));
    const detail = buildCellDetail({
      cellIndex: 5,
      layers: [],
      totals: { layers: [], kills: 7, deaths: 0 },
      cellDeaths,
      playerLabels: labels,
      maxEventLines: 3,
    });
    expect(detail.events).toHaveLength(3);
    expect(detail.eventsHidden).toBe(4);
  });
});

describe("buildCellDetail aggregate", () => {
  it("reads kills/deaths from the summed grids and shares them against the view totals", () => {
    const detail = buildCellDetail({
      cellIndex: 5,
      layers: [layer({ grid: { "5": 30 }, label: "Jaina", side: "me" })],
      totals: { layers: [120], kills: 10, deaths: 4 },
      killsGrid: { "5": 3, "6": 7 },
      deathsGrid: { "5": 1 },
    });

    expect([detail.kills, detail.deaths]).toEqual([3, 1]);
    expect(detail.killsShare).toBeCloseTo(0.3);
    expect(detail.deathsShare).toBeCloseTo(0.25);
    expect(detail.events).toEqual([]);
    expect(detail.presence[0]).toMatchObject({ seconds: 30, share: 0.25 });
  });

  it("reports a null share when the view has no kills or deaths at all", () => {
    const detail = buildCellDetail({ cellIndex: 5, layers: [], totals: { layers: [], kills: 0, deaths: 0 } });
    expect([detail.killsShare, detail.deathsShare]).toEqual([null, null]);
    expect(isCellDetailEmpty(detail)).toBe(true);
  });
});

describe("formatting", () => {
  it("formats a game clock and a cell's seconds", () => {
    expect(formatClock(312)).toBe("5:12");
    expect(formatClock(59)).toBe("0:59");
    expect(formatCellSeconds(12.4)).toBe("12 s");
    expect(formatCellSeconds(1.25)).toBe("1,3 s");
  });
});
