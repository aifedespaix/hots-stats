import { computed, ref } from "vue";
import { describe, expect, it } from "vitest";
import type { HeatmapGameData } from "./useHeatmapSync";
import { useHeatmapSync } from "./useHeatmapSync";

function game(overrides: Partial<HeatmapGameData> = {}): HeatmapGameData {
  return {
    mapId: "cursed-hollow",
    durationSeconds: 200,
    trajectories: [
      {
        matchPlayerId: "p1",
        battletag: "Foo#1111",
        heroId: "li-ming",
        team: 0,
        atSeconds: [0, 50, 100, 150, 200],
        x: [0.1, 0.3, 0.5, 0.7, 0.9],
        y: [0.1, 0.3, 0.5, 0.7, 0.9],
      },
    ],
    levelSnapshots: [
      { battletag: "Foo#1111", atSeconds: 90, level: 10 },
      { battletag: "Foo#1111", atSeconds: 160, level: 16 },
    ],
    deaths: [{ battletag: "Foo#1111", team: 0, atSeconds: 100, x: 0.5, y: 0.5 }],
    structureEvents: [{ team: 1, atSeconds: 60, structureType: "fort" }],
    ...overrides,
  };
}

function setup(a: HeatmapGameData | null, b: HeatmapGameData | null) {
  const gameA = ref(a);
  const gameB = ref(b);
  const heatmap = useHeatmapSync(
    computed(() => gameA.value),
    computed(() => gameB.value),
  );
  return { heatmap, gameA, gameB };
}

describe("useHeatmapSync cumulative window", () => {
  it("includes every sample up to the current slider time", () => {
    const { heatmap } = setup(game(), game());
    heatmap.sliderPercent.value = 100;
    expect(heatmap.pathPointsA.value.map((p) => p.atSeconds)).toEqual([0, 50, 100, 150, 200]);
  });

  it("excludes samples after the slider in progress mode", () => {
    const { heatmap } = setup(game(), game());
    heatmap.sliderPercent.value = 50; // 50% of 200s = 100s
    expect(heatmap.pathPointsA.value.map((p) => p.atSeconds)).toEqual([0, 50, 100]);
  });
});

describe("useHeatmapSync gameTime sync mode", () => {
  it("caps both games' current time at the shorter game's duration", () => {
    const { heatmap } = setup(game({ durationSeconds: 100 }), game({ durationSeconds: 200 }));
    heatmap.syncMode.value = "gameTime";
    heatmap.sliderPercent.value = 100;
    expect(heatmap.currentSecondsA.value).toBe(100);
    expect(heatmap.currentSecondsB.value).toBe(100);
  });
});

describe("useHeatmapSync phase window", () => {
  it("bounds the early phase to [0, level-10 timestamp)", () => {
    const { heatmap } = setup(game(), game());
    heatmap.windowMode.value = "phase";
    heatmap.selectedPhase.value = "early";
    heatmap.sliderPercent.value = 100;
    // level 10 reached at 90s -- samples at 0/50 fall in [0,90), 100 does not.
    expect(heatmap.pathPointsA.value.map((p) => p.atSeconds)).toEqual([0, 50]);
  });

  it("bounds the mid phase to [level-10, level-16) timestamps", () => {
    const { heatmap } = setup(game(), game());
    heatmap.windowMode.value = "phase";
    heatmap.selectedPhase.value = "mid";
    heatmap.sliderPercent.value = 100;
    // [90, 160) -- only the 100s and 150s samples qualify.
    expect(heatmap.pathPointsA.value.map((p) => p.atSeconds)).toEqual([100, 150]);
  });

  it("falls back to durationSeconds for a phase boundary never reached", () => {
    const shortGame = game({
      durationSeconds: 80,
      levelSnapshots: [], // never hit level 10
      trajectories: [
        {
          matchPlayerId: "p1",
          battletag: "Foo#1111",
          heroId: "li-ming",
          team: 0,
          atSeconds: [0, 40],
          x: [0.1, 0.2],
          y: [0.1, 0.2],
        },
      ],
    });
    const { heatmap } = setup(shortGame, shortGame);
    heatmap.windowMode.value = "phase";
    heatmap.selectedPhase.value = "early";
    heatmap.sliderPercent.value = 100;
    // Never reaching level 10 means "early" spans the whole match.
    expect(heatmap.pathPointsA.value.map((p) => p.atSeconds)).toEqual([0, 40]);
  });
});

describe("useHeatmapSync event window", () => {
  it("keeps only samples within [death - before, death + after]", () => {
    const { heatmap } = setup(game(), game());
    heatmap.windowMode.value = "event";
    heatmap.selectedEventType.value = "death";
    heatmap.eventWindowBeforeSeconds.value = 55; // 100 - 55 = 45
    heatmap.eventWindowAfterSeconds.value = 5; // 100 + 5 = 105
    heatmap.sliderPercent.value = 100;
    // Only the t=50 and t=100 samples fall in [45, 105].
    expect(heatmap.pathPointsA.value.map((p) => p.atSeconds)).toEqual([50, 100]);
  });

  it("anchors on structure destructions when selected", () => {
    const { heatmap } = setup(game(), game());
    heatmap.windowMode.value = "event";
    heatmap.selectedEventType.value = "structure";
    heatmap.eventWindowBeforeSeconds.value = 10; // 60 - 10 = 50
    heatmap.eventWindowAfterSeconds.value = 0; // 60 + 0 = 60
    heatmap.sliderPercent.value = 100;
    expect(heatmap.pathPointsA.value.map((p) => p.atSeconds)).toEqual([50]);
  });
});

describe("useHeatmapSync density grids", () => {
  it("builds an empty delta grid when both games visited the same cell equally", () => {
    const shared = game();
    const { heatmap } = setup(shared, shared);
    heatmap.sliderPercent.value = 100;
    expect(heatmap.deltaGrid.value).toEqual({});
  });

  it("delta grid is positive where only A has presence", () => {
    const onlyA = game();
    const empty = game({ trajectories: [] });
    const { heatmap } = setup(onlyA, empty);
    heatmap.sliderPercent.value = 100;
    const values = Object.values(heatmap.deltaGrid.value);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => v > 0)).toBe(true);
  });
});

describe("useHeatmapSync viewport", () => {
  it("panBy accumulates offsets", () => {
    const { heatmap } = setup(game(), game());
    heatmap.panBy(10, -5);
    heatmap.panBy(5, 5);
    expect(heatmap.viewTransform.value).toEqual({ scale: 1, offsetX: 15, offsetY: 0 });
  });

  it("zoomBy clamps scale to [1, 8]", () => {
    const { heatmap } = setup(game(), game());
    for (let i = 0; i < 10; i++) heatmap.zoomBy(1.5);
    expect(heatmap.viewTransform.value.scale).toBe(8);
    for (let i = 0; i < 10; i++) heatmap.zoomBy(1 / 1.5);
    expect(heatmap.viewTransform.value.scale).toBe(1);
  });

  it("resetViewTransform restores the identity transform", () => {
    const { heatmap } = setup(game(), game());
    heatmap.panBy(10, 10);
    heatmap.zoomBy(2);
    heatmap.resetViewTransform();
    expect(heatmap.viewTransform.value).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });
});

describe("useHeatmapSync hero selection", () => {
  it("falls back to the first trajectory when no hero is explicitly selected", () => {
    const { heatmap } = setup(game(), game());
    expect(heatmap.trajectoryA.value?.battletag).toBe("Foo#1111");
  });

  it("returns no path points for a game that hasn't loaded yet", () => {
    const { heatmap } = setup(null, game());
    expect(heatmap.pathPointsA.value).toEqual([]);
    expect(heatmap.currentSecondsA.value).toBe(0);
  });
});
