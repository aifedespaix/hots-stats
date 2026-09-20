import { describe, expect, it } from "vitest";
import type { MatchTimelineData, MatchTimelineSeries } from "~/types/coach";
import {
  buildMatchTimelineSeries,
  structureTypeLabel,
  timelineEventLabel,
  timelineEventsAround,
  timelineEventStep,
  timelineFocusAt,
  timelineLevelAt,
  timelineStateAt,
  type MatchTimelineInput,
} from "./useMatchTimelineSeries";

function timeline(overrides: Partial<MatchTimelineData> = {}): MatchTimelineData {
  return { deaths: [], levelSnapshots: [], ...overrides };
}

function input(overrides: Partial<MatchTimelineInput> = {}): MatchTimelineInput {
  return {
    timeline: timeline(),
    players: [
      { battletag: "Me#1", team: 0, heroName: "Muradin" },
      { battletag: "Ally#1", team: 0, heroName: "Valla" },
      { battletag: "Foe#1", team: 1, heroName: "Rexxar" },
    ],
    durationSeconds: 300,
    myBattletags: ["Me#1"],
    ...overrides,
  };
}

describe("buildMatchTimelineSeries lanes", () => {
  it("orders lanes mine first, then my team, then the enemy team", () => {
    const series = buildMatchTimelineSeries(
      input({
        players: [
          { battletag: "Foe#1", team: 1, heroName: "Rexxar" },
          { battletag: "Ally#1", team: 0, heroName: "Valla" },
          { battletag: "Me#1", team: 0, heroName: "Muradin" },
        ],
      }),
    );
    expect(series.lanes.map((lane) => lane.battletag)).toEqual(["Me#1", "Ally#1", "Foe#1"]);
    expect(series.lanes.map((lane) => lane.isMe)).toEqual([true, false, false]);
  });

  it("keeps a lane for every player even when they never died", () => {
    const series = buildMatchTimelineSeries(input());
    expect(series.lanes).toHaveLength(3);
    expect(series.lanes.every((lane) => lane.deaths.length === 0)).toBe(true);
  });

  it("sorts a lane's own deaths by time and resolves killers to hero names", () => {
    const series = buildMatchTimelineSeries(
      input({
        timeline: timeline({
          deaths: [
            { battletag: "Me#1", team: 0, atSeconds: 200, killers: ["Foe#1"], killType: "hero" },
            { battletag: "Me#1", team: 0, atSeconds: 50, killers: [], killType: "other" },
          ],
        }),
      }),
    );
    const me = series.lanes.find((lane) => lane.isMe)!;
    expect(me.deaths).toEqual([
      { atSeconds: 50, killers: [], killType: "other" },
      { atSeconds: 200, killers: ["Foe#1"], killType: "hero" },
    ]);
    expect(series.allDeaths.map((death) => death.killerNames)).toEqual([[], ["Rexxar"]]);
  });

  it("keeps a killer that has no row in this match as its raw BattleTag", () => {
    const series = buildMatchTimelineSeries(
      input({ timeline: timeline({ deaths: [{ battletag: "Me#1", team: 0, atSeconds: 10, killers: ["Ghost#9"] }] }) }),
    );
    expect(series.allDeaths[0]!.killerNames).toEqual(["Ghost#9"]);
  });

  it("falls back to the BattleTag when no hero name was resolved", () => {
    const series = buildMatchTimelineSeries(
      input({
        players: [{ battletag: "Me#1", team: 0 }],
        timeline: timeline({ deaths: [{ battletag: "Me#1", team: 0, atSeconds: 10 }] }),
      }),
    );
    expect(series.lanes[0]!.heroName).toBeNull();
    expect(series.allDeaths[0]!.heroName).toBeNull();
    expect(series.allDeaths[0]!.killType).toBeNull();
  });

  it("drops a death whose battletag has no lane but keeps it on the flat list", () => {
    const series = buildMatchTimelineSeries(
      input({ timeline: timeline({ deaths: [{ battletag: "Ghost#9", team: 1, atSeconds: 10 }] }) }),
    );
    expect(series.lanes.every((lane) => lane.deaths.length === 0)).toBe(true);
    expect(series.allDeaths.map((death) => death.battletag)).toEqual(["Ghost#9"]);
  });

  it("has no lanes at all when the match has no timeline", () => {
    const series = buildMatchTimelineSeries(input({ timeline: null }));
    expect(series.lanes).toEqual([]);
    expect(series.events).toEqual([]);
    expect(series.teamLevels).toEqual([[], []]);
  });
});

describe("buildMatchTimelineSeries events", () => {
  it("merges deaths and structures in time order, deaths first on a tie", () => {
    const series = buildMatchTimelineSeries(
      input({
        timeline: timeline({
          deaths: [{ battletag: "Me#1", team: 0, atSeconds: 60 }],
          structureEvents: [
            { team: 1, atSeconds: 60, structureType: "bastion" },
            { team: 0, atSeconds: 30, structureType: "tower" },
          ],
        }),
      }),
    );
    expect(series.events.map((event) => event.atSeconds + ":" + event.kind)).toEqual([
      "30:structure",
      "60:death",
      "60:structure",
    ]);
  });

  it("carries the hero name onto the death event", () => {
    const series = buildMatchTimelineSeries(
      input({ timeline: timeline({ deaths: [{ battletag: "Me#1", team: 0, atSeconds: 5 }] }) }),
    );
    expect(series.events[0]).toMatchObject({ kind: "death", battletag: "Me#1", heroName: "Muradin" });
  });
});

describe("timelineLevelAt and timelineStateAt", () => {
  const series = (): MatchTimelineSeries =>
    buildMatchTimelineSeries(
      input({
        timeline: timeline({
          levelSnapshots: [
            { battletag: "Me#1", atSeconds: 60, level: 2 },
            { battletag: "Me#1", atSeconds: 120, level: 4 },
            { battletag: "Foe#1", atSeconds: 90, level: 3 },
          ],
          deaths: [{ battletag: "Me#1", team: 0, atSeconds: 130 }],
          structureEvents: [{ team: 1, atSeconds: 200, structureType: "bastion" }],
        }),
      }),
    );

  it("carries the last known level forward and answers null before the first snapshot", () => {
    expect(timelineLevelAt(series().teamLevels[0], 59)).toBeNull();
    expect(timelineLevelAt(series().teamLevels[0], 60)).toBe(2);
    expect(timelineLevelAt(series().teamLevels[0], 119)).toBe(2);
    expect(timelineLevelAt(series().teamLevels[0], 999)).toBe(4);
  });

  it("reports a lead only once both sides have a known level", () => {
    const state = timelineStateAt(series(), 60);
    expect(state.team0Level).toBe(2);
    expect(state.team1Level).toBeNull();
    expect(state.lead).toBeNull();

    expect(timelineStateAt(series(), 130).lead).toBe(1);
  });

  it("keeps only the events within the clustering window of the instant", () => {
    expect(timelineStateAt(series(), 130).deaths).toHaveLength(1);
    expect(timelineStateAt(series(), 130).structures).toHaveLength(0);
    expect(timelineStateAt(series(), 200).structures).toHaveLength(1);
    expect(timelineStateAt(series(), 400).deaths).toHaveLength(0);
  });
});

describe("timelineFocusAt", () => {
  const series = (): MatchTimelineSeries =>
    buildMatchTimelineSeries(
      input({
        timeline: timeline({
          deaths: [
            { battletag: "Me#1", team: 0, atSeconds: 100 },
            { battletag: "Foe#1", team: 1, atSeconds: 104 },
            { battletag: "Ally#1", team: 0, atSeconds: 300 },
          ],
        }),
      }),
    );

  it("picks the nearest death inside the window and gathers its fight from both teams", () => {
    const focus = timelineFocusAt(series(), 102);
    expect(focus?.victim.battletag).toBe("Me#1");
    expect(focus?.fight.map((death) => death.battletag)).toEqual(["Me#1", "Foe#1"]);
  });

  it("resolves a tie to the earlier death so the cursor is deterministic", () => {
    expect(timelineFocusAt(series(), 102)?.victim.atSeconds).toBe(100);
  });

  it("returns null when no death is close enough", () => {
    expect(timelineFocusAt(series(), 200)).toBeNull();
  });
});

describe("timelineEventStep", () => {
  const events = [
    { kind: "death" as const, atSeconds: 30, team: 0 as const },
    { kind: "structure" as const, atSeconds: 60, team: 1 as const },
    { kind: "death" as const, atSeconds: 90, team: 1 as const },
  ];

  it("steps forward and backward, strictly", () => {
    expect(timelineEventStep(events, 30, 1)?.atSeconds).toBe(60);
    expect(timelineEventStep(events, 30, -1)).toBeNull();
    expect(timelineEventStep(events, 60, -1)?.atSeconds).toBe(30);
    expect(timelineEventStep(events, 60, 1)?.atSeconds).toBe(90);
  });

  it("returns null past either end", () => {
    expect(timelineEventStep(events, 90, 1)).toBeNull();
    expect(timelineEventStep([], 10, 1)).toBeNull();
  });
});

describe("timelineEventsAround", () => {
  const events = [10, 20, 30, 40, 50].map((atSeconds) => ({
    kind: "death" as const,
    atSeconds,
    team: 0 as const,
  }));

  it("returns the last event before the cursor and the next few after it", () => {
    const around = timelineEventsAround(events, 25);
    expect(around.previous?.atSeconds).toBe(20);
    expect(around.upcoming.map((event) => event.atSeconds)).toEqual([30, 40, 50]);
  });

  it("caps the upcoming list", () => {
    expect(timelineEventsAround(events, 5, 2).upcoming.map((event) => event.atSeconds)).toEqual([10, 20]);
    expect(timelineEventsAround(events, 5).previous).toBeNull();
  });

  it("treats an event exactly at the cursor as the previous one", () => {
    expect(timelineEventsAround(events, 30).previous?.atSeconds).toBe(30);
    expect(timelineEventsAround(events, 30).upcoming.map((event) => event.atSeconds)).toEqual([40, 50]);
  });
});

describe("timelineEventLabel", () => {
  it("names a death by its hero and falls back to the BattleTag", () => {
    expect(timelineEventLabel({ kind: "death", atSeconds: 1, team: 0, heroName: "Muradin" })).toBe("Mort de Muradin");
    expect(timelineEventLabel({ kind: "death", atSeconds: 1, team: 0, battletag: "Me#1" })).toBe("Mort de Me#1");
  });

  it("uses the game's French wording for structures", () => {
    expect(timelineEventLabel({ kind: "structure", atSeconds: 1, team: 0, structureType: "bastion" })).toBe("Bastion détruit");
    expect(timelineEventLabel({ kind: "structure", atSeconds: 1, team: 0, structureType: "core" })).toBe("Cœur détruit");
    expect(timelineEventLabel({ kind: "structure", atSeconds: 1, team: 0 })).toBe("Structure détruit");
    expect(structureTypeLabel("tower")).toBe("Tour");
    expect(structureTypeLabel("gate")).toBe("Porte");
  });
});
