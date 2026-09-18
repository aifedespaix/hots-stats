import { describe, expect, test } from "vitest";
import { buildCoachInsights, buildScoreboardRows } from "./coachAnalysis";
import type { CoachInsightResult, CoachAnalysisInput, ScoreboardRow } from "../types/coach";
import type { MatchDetailPlayer } from "../types/matches";

/**
 * Behaviour lock for the six Coach pillars (A1 acceptance criterion 2): every
 * projection below was captured from the implementation BEFORE the rules were
 * extracted into @hots-stats/shared-types, and must stay byte-identical. Each
 * numeric decision now delegates to the shared module, so this test is the
 * guard against drift.
 */

function mkPlayer(over: Partial<MatchDetailPlayer>): MatchDetailPlayer {
  return {
    id: over.battletag ?? "id",
    userId: null,
    battletag: "P#1",
    heroId: "hero",
    heroName: "Hero",
    heroRole: "RangedAssassin",
    team: 0,
    winner: true,
    kills: 0,
    deaths: 0,
    assists: 0,
    heroDamage: 0,
    siegeDamage: 0,
    healing: 0,
    selfHealing: 0,
    damageTaken: 0,
    experienceContribution: 0,
    talents: [],
    ...over,
  };
}

const MY_TAG = "Me#1111";
const MY_TAG_LOWER = MY_TAG.toLowerCase();

function roster(): MatchDetailPlayer[] {
  return [
    mkPlayer({ battletag: MY_TAG, team: 0, winner: true, kills: 10, deaths: 3, assists: 5, heroDamage: 40000, siegeDamage: 20000, damageTaken: 25000, experienceContribution: 12000 }),
    mkPlayer({ battletag: "Ally1#1", team: 0, winner: true, heroRole: "Tank", kills: 2, deaths: 5, assists: 8, heroDamage: 15000, siegeDamage: 30000, damageTaken: 45000, experienceContribution: 9000 }),
    mkPlayer({ battletag: "Ally2#2", team: 0, winner: true, heroRole: "Healer", kills: 1, deaths: 4, assists: 12, heroDamage: 5000, siegeDamage: 2000, healing: 50000, experienceContribution: 8000 }),
    mkPlayer({ battletag: "Ally3#3", team: 0, winner: true, heroRole: "Bruiser", kills: 4, deaths: 6, assists: 3, heroDamage: 30000, siegeDamage: 12000, damageTaken: 40000, experienceContribution: 10000 }),
    mkPlayer({ battletag: "Ally4#4", team: 0, winner: true, heroRole: "MeleeAssassin", kills: 6, deaths: 4, assists: 4, heroDamage: 35000, siegeDamage: 8000, damageTaken: 30000, experienceContribution: 11000 }),
    mkPlayer({ battletag: "Enemy1#1", team: 1, winner: false, heroRole: "Tank", kills: 3, deaths: 5, assists: 6, heroDamage: 18000, siegeDamage: 25000, damageTaken: 50000, experienceContribution: 9500 }),
    mkPlayer({ battletag: "Enemy2#2", team: 1, winner: false, heroRole: "Healer", kills: 0, deaths: 6, assists: 9, heroDamage: 4000, siegeDamage: 1000, healing: 42000, experienceContribution: 7000 }),
    mkPlayer({ battletag: "Enemy3#3", team: 1, winner: false, heroRole: "RangedAssassin", kills: 8, deaths: 4, assists: 5, heroDamage: 45000, siegeDamage: 15000, damageTaken: 22000, experienceContribution: 13000 }),
    mkPlayer({ battletag: "Enemy4#4", team: 1, winner: false, heroRole: "Bruiser", kills: 5, deaths: 5, assists: 4, heroDamage: 28000, siegeDamage: 18000, damageTaken: 42000, experienceContribution: 10500 }),
    mkPlayer({ battletag: "Enemy5#5", team: 1, winner: false, heroRole: "MeleeAssassin", kills: 7, deaths: 5, assists: 2, heroDamage: 38000, siegeDamage: 6000, damageTaken: 26000, experienceContribution: 11500 }),
  ];
}

type Timeline = CoachAnalysisInput["timeline"];

function input(timeline: Timeline): CoachAnalysisInput {
  const rows: ScoreboardRow[] = buildScoreboardRows(roster(), new Set([MY_TAG_LOWER]));
  return {
    me: rows.find((r) => r.isMe)!,
    myTeam: rows.filter((r) => r.team === 0),
    enemyTeam: rows.filter((r) => r.team === 1),
    timeline,
  };
}

const richTimeline: Timeline = {
  deaths: [
    { battletag: MY_TAG, team: 0, atSeconds: 100 },
    { battletag: "Ally1#1", team: 0, atSeconds: 300 },
    { battletag: "Enemy1#1", team: 1, atSeconds: 305 },
    { battletag: MY_TAG, team: 0, atSeconds: 315 },
    { battletag: "Ally3#3", team: 0, atSeconds: 585 },
    { battletag: "Ally4#4", team: 0, atSeconds: 590 },
    { battletag: MY_TAG, team: 0, atSeconds: 600 },
  ],
  levelSnapshots: [
    { battletag: MY_TAG, atSeconds: 0, level: 4 },
    ...["Enemy1#1", "Enemy2#2", "Enemy3#3", "Enemy4#4", "Enemy5#5"].map((battletag) => ({ battletag, atSeconds: 0, level: 7 })),
  ],
};

const positiveTalentTimeline: Timeline = {
  deaths: [
    { battletag: "Ally1#1", team: 0, atSeconds: 100 },
    { battletag: "Enemy1#1", team: 1, atSeconds: 105 },
  ],
  levelSnapshots: [
    { battletag: MY_TAG, atSeconds: 0, level: 7 },
    ...["Enemy1#1", "Enemy2#2", "Enemy3#3", "Enemy4#4", "Enemy5#5"].map((battletag) => ({ battletag, atSeconds: 0, level: 4 })),
  ],
};

const noDeathsTimeline: Timeline = {
  deaths: [
    { battletag: "Ally1#1", team: 0, atSeconds: 100 },
    { battletag: "Enemy1#1", team: 1, atSeconds: 200 },
  ],
  levelSnapshots: [
    { battletag: MY_TAG, atSeconds: 0, level: 5 },
    ...["Enemy1#1", "Enemy2#2", "Enemy3#3", "Enemy4#4", "Enemy5#5"].map((battletag) => ({ battletag, atSeconds: 0, level: 5 })),
  ],
};

type Projection = {
  pillar: string;
  status: string;
  verdict?: string;
  summary?: string;
  metricLabel?: string;
  metricValue?: string;
  reason?: string;
  occurrences?: { atLabel?: string; detail: string }[];
};

function project(result: CoachInsightResult): Projection {
  if (result.status === "unavailable") {
    return { pillar: result.pillar, status: result.status, reason: result.reason };
  }
  return {
    pillar: result.pillar,
    status: result.status,
    verdict: result.verdict,
    summary: result.summary,
    metricLabel: result.metricLabel,
    metricValue: result.metricValue,
    occurrences: result.occurrences,
  };
}

function projectAll(timeline: Timeline): Projection[] {
  return buildCoachInsights(input(timeline)).map(project);
}

const NO_TIMELINE_REASON = "Nécessite le timestamp de chaque mort du replay (SUnitDiedEvent) -- pas encore extrait par le pipeline d'ingestion.";
const NO_LEVELS_REASON = "Nécessite un relevé de niveau au fil du temps (SPlayerStatsEvent périodique) -- pas encore extrait par le pipeline d'ingestion.";
const NO_DEATHS_OUTNUMBERED_REASON = "Aucune mort ce match : impossible d'avoir combattu en sous-nombre en mourant.";
const NO_DEATHS_STAGGERED_REASON = "Aucune mort ce match : rien à décaler.";

const EFFICIENCY_READY = {
  pillar: "efficiency",
  status: "ready",
  verdict: "positive",
  summary: "KDA de 5.00, au-dessus de la moyenne de ton équipe (2.23), avec 65% de participation aux kills.",
  metricLabel: "KDA",
  metricValue: "5.00",
};
const OBJECTIVE_READY = {
  pillar: "objectiveFootprint",
  status: "ready",
  verdict: "neutral",
  summary: "28% des dégâts de siège de l'équipe, contre 32% des dégâts héros.",
  metricLabel: "Part des dégâts de siège",
  metricValue: "28%",
};

describe("buildCoachInsights regression goldens", () => {
  test("rich timeline: all six pillars in their verdict-bearing state", () => {
    expect(projectAll(richTimeline)).toEqual([
      {
        pillar: "outnumberedFights",
        status: "ready",
        verdict: "negative",
        summary: "1 mort(s) sur 3 avec ton équipe en infériorité numérique estimée.",
        metricLabel: "Morts en sous-nombre",
        metricValue: "1/3",
        occurrences: [{ atLabel: "10:00", detail: "Mort en infériorité estimée (~3 vs 5)." }],
      },
      {
        pillar: "talentDelay",
        status: "ready",
        verdict: "negative",
        summary: "1 combat(s) sur 1 engagé(s) avec un palier de talent en retard.",
        metricLabel: "Combats en retard de palier",
        metricValue: "1/1",
        occurrences: [{ atLabel: "5:00", detail: "Palier 4 (niveau 4) engagé contre palier 7 (niveau adverse moyen 7.0)." }],
      },
      {
        pillar: "staggeredDeaths",
        status: "ready",
        verdict: "negative",
        summary: "2 mort(s) en groupe sur 2 en décalé, isolées après le reste de l'équipe.",
        metricLabel: "Morts en décalé",
        metricValue: "2/2",
        occurrences: [
          { atLabel: "5:15", detail: "Mort 15s après le premier coéquipier tombé dans ce fight." },
          { atLabel: "10:00", detail: "Mort 15s après le premier coéquipier tombé dans ce fight." },
        ],
      },
      EFFICIENCY_READY,
      {
        pillar: "firstDeath",
        status: "ready",
        verdict: "negative",
        summary: "Tu es le premier tombé de la partie, à 1:40.",
        metricLabel: "Premier mort à",
        metricValue: "1:40",
      },
      OBJECTIVE_READY,
    ]);
  });

  test("no timeline: the four event pillars stay unavailable", () => {
    expect(projectAll(null)).toEqual([
      { pillar: "outnumberedFights", status: "unavailable", reason: NO_TIMELINE_REASON },
      { pillar: "talentDelay", status: "unavailable", reason: NO_LEVELS_REASON },
      { pillar: "staggeredDeaths", status: "unavailable", reason: NO_TIMELINE_REASON },
      EFFICIENCY_READY,
      { pillar: "firstDeath", status: "unavailable", reason: NO_TIMELINE_REASON },
      OBJECTIVE_READY,
    ]);
  });

  test("positive talent fight: evaluated but never flagged", () => {
    expect(projectAll(positiveTalentTimeline)).toEqual([
      { pillar: "outnumberedFights", status: "ready", verdict: "positive", summary: NO_DEATHS_OUTNUMBERED_REASON },
      { pillar: "talentDelay", status: "ready", verdict: "positive", summary: "Palier de talent toujours au moins égal à l'adversaire sur 1 combat(s) analysé(s)." },
      { pillar: "staggeredDeaths", status: "ready", verdict: "positive", summary: NO_DEATHS_STAGGERED_REASON },
      EFFICIENCY_READY,
      { pillar: "firstDeath", status: "ready", verdict: "positive", summary: "Tu n'es pas le premier tombé de la partie (à 1:40)." },
      OBJECTIVE_READY,
    ]);
  });

  test("deathless subject with unreadable levels", () => {
    expect(projectAll(noDeathsTimeline)).toEqual([
      { pillar: "outnumberedFights", status: "ready", verdict: "positive", summary: NO_DEATHS_OUTNUMBERED_REASON },
      { pillar: "talentDelay", status: "unavailable", reason: "Aucun combat exploitable (niveau inconnu au moment des morts recensées)." },
      { pillar: "staggeredDeaths", status: "ready", verdict: "positive", summary: NO_DEATHS_STAGGERED_REASON },
      EFFICIENCY_READY,
      { pillar: "firstDeath", status: "ready", verdict: "positive", summary: "Tu n'es pas le premier tombé de la partie (à 1:40)." },
      OBJECTIVE_READY,
    ]);
  });
});
