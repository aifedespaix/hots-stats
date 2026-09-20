import { describe, expect, it } from "vitest";
import type {
  MatchTimelineDeath,
  MatchTimelineLevelSnapshot,
  MatchTimelineStructureEvent,
} from "~/types/coach";
import type { MatchHeroTrajectory } from "~/types/spatial";
import type { HeatmapPlayerLabels } from "./heatmapCellDetails";
import {
  advantageAtSeconds,
  buildEventRecaps,
  fightBilanAt,
  nearbyTeamsAt,
  teamStateAt,
} from "./eventRecap";

const labels: HeatmapPlayerLabels = {
  "Me#1": { name: "Jaina", side: "me" },
  "Ally#1": { name: "Raynor", side: "ally" },
  "Enemy#1": { name: "Kael'thas", side: "enemy" },
};

function death(overrides: Partial<MatchTimelineDeath> = {}): MatchTimelineDeath {
  return { battletag: "Enemy#1", team: 1, atSeconds: 100, x: 0.5, y: 0.5, ...overrides };
}

describe("teamStateAt", () => {
  it("counts distinct heroes of each side still down inside the respawn window", () => {
    const deaths: MatchTimelineDeath[] = [
      death({ battletag: "Ally1", team: 0, atSeconds: 100 }),
      death({ battletag: "Ally2", team: 0, atSeconds: 120 }),
      death({ battletag: "Ally2", team: 0, atSeconds: 122 }),
      death({ battletag: "Ally3", team: 0, atSeconds: 110 }),
      death({ battletag: "Enemy1", team: 1, atSeconds: 139 }),
    ];
    // 140 - 25 = 115, so Alley1 (100) and Ally3 (110) are presumed back up.
    expect(teamStateAt(deaths, 140, 0)).toEqual({
      allies: { down: 1, present: 4 },
      enemies: { down: 1, present: 4 },
    });
  });

  it("excludes the event's own instant and later deaths", () => {
    const deaths: MatchTimelineDeath[] = [
      death({ battletag: "Ally1", team: 0, atSeconds: 100 }),
      death({ battletag: "Ally2", team: 0, atSeconds: 101 }),
    ];
    expect(teamStateAt(deaths, 100, 0).allies).toEqual({ down: 0, present: 5 });
  });

  it("can include a death landing exactly at the instant, for a post-event state", () => {
    const deaths: MatchTimelineDeath[] = [death({ battletag: "Ally1", team: 0, atSeconds: 100 })];
    expect(teamStateAt(deaths, 100, 0, true).allies).toEqual({ down: 1, present: 4 });
  });

  it("swaps the two sides when the reference team flips", () => {
    const deaths: MatchTimelineDeath[] = [
      death({ battletag: "Ally1", team: 0, atSeconds: 100 }),
      death({ battletag: "Enemy1", team: 1, atSeconds: 100 }),
      death({ battletag: "Enemy2", team: 1, atSeconds: 101 }),
    ];
    expect(teamStateAt(deaths, 102, 1)).toEqual({
      allies: { down: 2, present: 3 },
      enemies: { down: 1, present: 4 },
    });
  });
});

describe("nearbyTeamsAt", () => {
  const trajectories: MatchHeroTrajectory[] = [
    { matchPlayerId: "p1", battletag: "Ally1", heroId: null, team: 0, layer: null, atSeconds: [104], x: [0.5], y: [0.5] },
    { matchPlayerId: "p2", battletag: "Ally2", heroId: null, team: 0, layer: null, atSeconds: [80], x: [0.5], y: [0.5] },
    { matchPlayerId: "p3", battletag: "Enemy1", heroId: null, team: 1, layer: null, atSeconds: [104], x: [0.55], y: [0.5] },
    { matchPlayerId: "p4", battletag: "Enemy2", heroId: null, team: 1, layer: null, atSeconds: [104], x: [0.95], y: [0.95] },
  ];

  it("counts each side's heroes near the event at its own instant", () => {
    const proximity = nearbyTeamsAt({ trajectories, atSeconds: 104, x: 0.5, y: 0.5, allyTeam: 0 });
    expect(proximity).toMatchObject({ allies: 1, enemies: 1, known: true });
    expect(proximity.closestEnemyDistance).toBeCloseTo(0.05);
  });

  it("ignores a hero whose nearest sample sits outside the time window", () => {
    // Ally2's only sample is 24s away -- long enough that its 0.5/0.5 position says
    // nothing about where it was at 104s.
    expect(nearbyTeamsAt({ trajectories, atSeconds: 104, x: 0.5, y: 0.5, allyTeam: 0, windowSeconds: 5 }).allies).toBe(1);
  });

  it("reports proximity as unknown when no trajectory sample is close enough in time", () => {
    expect(nearbyTeamsAt({ trajectories, atSeconds: 400, x: 0.5, y: 0.5, allyTeam: 0 })).toEqual({
      allies: 0,
      enemies: 0,
      closestEnemyDistance: null,
      known: false,
    });
  });

  it("only reads trajectories on the event's own layer", () => {
    const layered: MatchHeroTrajectory[] = [
      { matchPlayerId: "p1", battletag: "Enemy1", heroId: null, team: 1, layer: "mine", atSeconds: [104], x: [0.5], y: [0.5] },
    ];
    expect(nearbyTeamsAt({ trajectories: layered, atSeconds: 104, x: 0.5, y: 0.5, allyTeam: 0, layer: "surface" })).toEqual({
      allies: 0,
      enemies: 0,
      closestEnemyDistance: null,
      known: false,
    });
  });
});

describe("advantageAtSeconds", () => {
  const snapshots: MatchTimelineLevelSnapshot[] = [
    { battletag: "A1", atSeconds: 100, level: 10 },
    { battletag: "A2", atSeconds: 100, level: 11 },
    { battletag: "E1", atSeconds: 100, level: 9 },
    { battletag: "A1", atSeconds: 200, level: 13 },
    { battletag: "A2", atSeconds: 200, level: 13 },
    { battletag: "E1", atSeconds: 200, level: 11 },
  ];
  const teamByBattletag = new Map([
    ["A1", 0],
    ["A2", 0],
    ["E1", 1],
  ]);

  it("averages each team's latest known level and derives both talent tiers", () => {
    expect(advantageAtSeconds(snapshots, teamByBattletag, 150, 0)).toEqual({
      allyLevel: 10.5,
      enemyLevel: 9,
      lead: 1.5,
      allyTier: 10,
      enemyTier: 7,
    });
  });

  it("flips the lead when the reference team flips", () => {
    const advantage = advantageAtSeconds(snapshots, teamByBattletag, 150, 1)!;
    expect(advantage.lead).toBeCloseTo(-1.5);
    expect(advantage.allyTier).toBe(7);
  });

  it("returns null while either side has no level reading yet", () => {
    expect(advantageAtSeconds(snapshots, teamByBattletag, 50, 0)).toBeNull();
  });
});

describe("fightBilanAt", () => {
  const deaths: MatchTimelineDeath[] = [
    death({ battletag: "A1", team: 0, atSeconds: 100, killers: ["E1"] }),
    death({ battletag: "A2", team: 0, atSeconds: 104, killers: ["E1", "E2"] }),
    death({ battletag: "E1", team: 1, atSeconds: 108, killers: ["A3"] }),
    death({ battletag: "A3", team: 0, atSeconds: 200, killers: ["E1"] }),
  ];
  const teamByBattletag = new Map([
    ["A1", 0],
    ["A2", 0],
    ["A3", 0],
    ["E1", 1],
    ["E2", 1],
  ]);

  it("summarizes the fight the event belongs to, in kills and deaths per side", () => {
    expect(fightBilanAt(deaths, 104, 0, teamByBattletag)).toEqual({
      startSeconds: 100,
      endSeconds: 108,
      allyDeaths: 2,
      enemyDeaths: 1,
      allyKills: 1,
      enemyKills: 3,
    });
  });

  it("credits an unlisted killer to the victim's opposing side", () => {
    const bilan = fightBilanAt([death({ battletag: "A1", team: 0, atSeconds: 100, killers: ["Unknown#9"] })], 100, 0, teamByBattletag);
    expect(bilan).toEqual({
      startSeconds: 100,
      endSeconds: 100,
      allyDeaths: 1,
      enemyDeaths: 0,
      allyKills: 0,
      enemyKills: 1,
    });
  });
});

describe("buildEventRecaps", () => {
  const structureEvents: MatchTimelineStructureEvent[] = [{ team: 1, atSeconds: 130, structureType: "bastion" }];
  const levelSnapshots: MatchTimelineLevelSnapshot[] = [
    { battletag: "Ally#1", atSeconds: 0, level: 10 },
    { battletag: "Enemy#1", atSeconds: 0, level: 9 },
  ];
  const deaths: MatchTimelineDeath[] = [
    death({ battletag: "Enemy#1", team: 1, atSeconds: 60, x: 0.6, y: 0.6, killers: ["Ally#1"], killType: "hero" }),
    death({ battletag: "Ally#1", team: 0, atSeconds: 120, x: 0.4, y: 0.4, killers: ["Enemy#1"], killType: "hero" }),
  ];

  it("builds one chronological recap per event, with clock, progress and labels", () => {
    const recaps = buildEventRecaps({
      deaths,
      events: deaths,
      playerLabels: labels,
      allyTeam: 0,
      durationSeconds: 600,
    });
    expect(recaps.map((r) => r.atSeconds)).toEqual([60, 120]);
    expect(recaps[0]!.clock).toBe("1:00");
    expect(recaps[0]!.matchProgress).toBeCloseTo(0.1);
    expect(recaps[0]!.kind).toBe("kill");
    expect(recaps[0]!.victimLabel).toBe("Kael'thas (ennemi)");
    expect(recaps[0]!.killers).toEqual([{ battletag: "Ally#1", label: "Raynor (allié)", team: 0 }]);
    expect(recaps[1]!.kind).toBe("death");
    expect(recaps[1]!.victimLabel).toBe("Raynor (allié)");
  });

  it("counts each event's own victim among its side's down players", () => {
    const recaps = buildEventRecaps({ deaths, events: deaths, playerLabels: labels, allyTeam: 0 });
    expect(recaps[0]!.teamState).toEqual({ allies: { down: 0, present: 5 }, enemies: { down: 1, present: 4 } });
    expect(recaps[1]!.teamState).toEqual({ allies: { down: 1, present: 4 }, enemies: { down: 0, present: 5 } });
  });

  it("never repeats the same event twice", () => {
    const recaps = buildEventRecaps({
      deaths,
      events: [deaths[1]!, deaths[1]!, deaths[1]!],
      playerLabels: labels,
      allyTeam: 0,
    });
    expect(recaps).toHaveLength(1);
  });

  it("flags the first death of the match and leaves the others unflagged", () => {
    const recaps = buildEventRecaps({ deaths, events: deaths, playerLabels: labels, allyTeam: 0 });
    expect(recaps.map((r) => r.isFirstDeath)).toEqual([true, false]);
  });

  it("reports the match progress as unknown without a duration", () => {
    const recaps = buildEventRecaps({ deaths, events: deaths, playerLabels: labels, allyTeam: 0 });
    expect(recaps[0]!.matchProgress).toBeNull();
  });

  it("attaches the level advantage at the event's instant", () => {
    const recaps = buildEventRecaps({
      deaths,
      events: deaths,
      playerLabels: labels,
      allyTeam: 0,
      levelSnapshots,
      players: [
        { battletag: "Ally#1", team: 0 },
        { battletag: "Enemy#1", team: 1 },
      ],
    });
    expect(recaps[0]!.advantage).toEqual({ allyLevel: 10, enemyLevel: 9, lead: 1, allyTier: 10, enemyTier: 7 });
  });

  it("ignores a structure event far from the kill's instant", () => {
    const near = buildEventRecaps({
      deaths,
      events: deaths,
      playerLabels: labels,
      allyTeam: 0,
      structureEvents,
    });
    expect(near[1]!.structure).toEqual({ atSeconds: 130, structureType: "bastion", team: 1, deltaSeconds: 10 });
    expect(near[0]!.structure).toBeNull();
  });

  it("flags a death landing more than the stagger threshold after the first ally death of the fight", () => {
    const staggered: MatchTimelineDeath[] = [
      death({ battletag: "A1", team: 0, atSeconds: 100, killers: ["E1"] }),
      death({ battletag: "A2", team: 0, atSeconds: 112, killers: ["E1"] }),
    ];
    const recaps = buildEventRecaps({ deaths: staggered, events: staggered, playerLabels: labels, allyTeam: 0 });
    expect(recaps.map((r) => r.staggerDelaySeconds)).toEqual([null, 12]);
  });
});
