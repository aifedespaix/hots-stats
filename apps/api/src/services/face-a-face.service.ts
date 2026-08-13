import { db, heroes, matchPlayers, matches } from "@hots-stats/db";
import {
  FACE_A_FACE_MIN_GAMES_FOR_COMBO,
  FACE_A_FACE_MIN_GAMES_FOR_SIGNATURE_HERO,
  type FaceAFaceHeroCombo,
  type FaceAFaceOverviewStats,
  type FaceAFaceRoleDistributionEntry,
  type FaceAFaceSignatureHero,
  type FaceAFaceSynergyStats,
} from "@hots-stats/shared-types";
import { and, eq, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getHeroSummaries } from "./talents.service";

/**
 * Account-wide (not per-hero) aggregate for one side of a Face-à-Face
 * comparison -- powers the Tale of the Tape and the raw inputs to the
 * playstyle radar. No `scope` parameter on purpose, unlike getStatsSummary/
 * getHeroSummaries: a comparison between two specific accounts must never be
 * able to silently balloon into "the whole app's data" via a stray "global"
 * scope -- it would still render, just compare nonsense.
 */
export async function getPlayerOverviewStats(userId: string): Promise<FaceAFaceOverviewStats> {
  const teamKills = db.$with("team_kills").as(
    db
      .select({
        matchId: matchPlayers.matchId,
        team: matchPlayers.team,
        teamKills: sql<number>`sum(${matchPlayers.kills})`.as("team_kills"),
      })
      .from(matchPlayers)
      .groupBy(matchPlayers.matchId, matchPlayers.team),
  );

  const [row] = await db
    .with(teamKills)
    .select({
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
      totalDurationSeconds: sql<number>`coalesce(sum(${matches.durationSeconds}), 0)::int`,
      avgDurationSeconds: sql<number>`coalesce(avg(${matches.durationSeconds}), 0)::int`,
      avgKills: sql<number>`coalesce(avg(${matchPlayers.kills}), 0)::float`,
      avgDeaths: sql<number>`coalesce(avg(${matchPlayers.deaths}), 0)::float`,
      avgAssists: sql<number>`coalesce(avg(${matchPlayers.assists}), 0)::float`,
      avgHeroDamage: sql<number>`coalesce(avg(${matchPlayers.heroDamage}), 0)::float`,
      avgSiegeDamage: sql<number>`coalesce(avg(${matchPlayers.siegeDamage}), 0)::float`,
      avgHealing: sql<number>`coalesce(avg(${matchPlayers.healing}), 0)::float`,
      avgDamageTaken: sql<number>`coalesce(avg(${matchPlayers.damageTaken}), 0)::float`,
      avgExperienceContribution: sql<number>`coalesce(avg(${matchPlayers.experienceContribution}), 0)::float`,
      avgKillParticipation: sql<number>`coalesce(avg(
        case when ${teamKills.teamKills} > 0
          then (${matchPlayers.kills} + ${matchPlayers.assists})::float / ${teamKills.teamKills}
          else 0
        end
      ), 0)::float`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(teamKills, and(eq(teamKills.matchId, matchPlayers.matchId), eq(teamKills.team, matchPlayers.team)))
    .where(eq(matchPlayers.userId, userId));

  const gamesPlayed = row?.gamesPlayed ?? 0;
  const wins = row?.wins ?? 0;
  const avgKills = row?.avgKills ?? 0;
  const avgDeaths = row?.avgDeaths ?? 0;
  const avgAssists = row?.avgAssists ?? 0;

  return {
    gamesPlayed,
    wins,
    winrate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
    totalDurationSeconds: row?.totalDurationSeconds ?? 0,
    avgDurationSeconds: row?.avgDurationSeconds ?? 0,
    avgKills,
    avgDeaths,
    avgAssists,
    kda: (avgKills + avgAssists) / Math.max(1, avgDeaths),
    avgHeroDamage: row?.avgHeroDamage ?? 0,
    avgSiegeDamage: row?.avgSiegeDamage ?? 0,
    avgHealing: row?.avgHealing ?? 0,
    avgDamageTaken: row?.avgDamageTaken ?? 0,
    avgExperienceContribution: row?.avgExperienceContribution ?? 0,
    avgKillParticipation: row?.avgKillParticipation ?? 0,
  };
}

/** Share of a player's own games spent on each hero role. */
export async function getRoleDistribution(userId: string): Promise<FaceAFaceRoleDistributionEntry[]> {
  const rows = await db
    .select({ role: heroes.role, gamesPlayed: sql<number>`count(*)::int` })
    .from(matchPlayers)
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .where(eq(matchPlayers.userId, userId))
    .groupBy(heroes.role);

  const total = rows.reduce((sum, row) => sum + row.gamesPlayed, 0);
  return rows
    .map((row) => ({
      role: row.role,
      gamesPlayed: row.gamesPlayed,
      percentage: total > 0 ? row.gamesPlayed / total : 0,
    }))
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed);
}

/**
 * Top 3 heroes by winrate among those clearing `FACE_A_FACE_MIN_GAMES_FOR_SIGNATURE_HERO`,
 * backfilled with the most-played remaining heroes (flagged `smallSample`)
 * when fewer than 3 clear the floor -- an empty/short card row reads as
 * broken, a flagged thin-sample pick reads as honest.
 */
export async function getSignatureHeroes(userId: string): Promise<FaceAFaceSignatureHero[]> {
  const heroStats = await getHeroSummaries(userId);
  const withKda = heroStats.map((hero) => ({
    heroId: hero.heroId,
    heroName: hero.heroName,
    gamesPlayed: hero.gamesPlayed,
    wins: hero.wins,
    winrate: hero.winrate,
    kda: (hero.avgKills + hero.avgAssists) / Math.max(1, hero.avgDeaths),
  }));

  const eligible = withKda.filter((hero) => hero.gamesPlayed >= FACE_A_FACE_MIN_GAMES_FOR_SIGNATURE_HERO);
  const ranked = [...eligible].sort((a, b) => b.winrate - a.winrate || b.gamesPlayed - a.gamesPlayed);
  const result: FaceAFaceSignatureHero[] = ranked.slice(0, 3).map((hero) => ({ ...hero, smallSample: false }));

  if (result.length < 3) {
    const used = new Set(result.map((hero) => hero.heroId));
    const fallback = withKda
      .filter((hero) => !used.has(hero.heroId))
      .sort((a, b) => b.gamesPlayed - a.gamesPlayed || b.winrate - a.winrate);
    for (const hero of fallback) {
      if (result.length >= 3) break;
      result.push({ ...hero, smallSample: true });
    }
  }
  return result;
}

/**
 * Stats for games where `userId` and `friendId` were on the same team,
 * self-joining match_players on both sides by userId (both are guaranteed
 * registered accounts here -- friendship requires it) rather than battletag.
 */
export async function getSynergyStats(userId: string, friendId: string): Promise<FaceAFaceSynergyStats> {
  const a = alias(matchPlayers, "a");
  const b = alias(matchPlayers, "b");
  const heroA = alias(heroes, "hero_a");
  const heroB = alias(heroes, "hero_b");

  // ne(b.id, a.id) is structurally redundant (a.userId=userId != friendId=b.userId
  // already guarantees distinct rows) but kept to match the defensive
  // self-join style used throughout players.service.ts/weaknesses.service.ts.
  const allyJoin = and(eq(b.matchId, a.matchId), eq(b.team, a.team), ne(b.id, a.id));
  const pairWhere = and(eq(a.userId, userId), eq(b.userId, friendId));

  const [overviewRows, comboRows] = await Promise.all([
    db
      .select({
        gamesPlayed: sql<number>`count(*)::int`,
        wins: sql<number>`count(*) filter (where ${a.winner})::int`,
      })
      .from(a)
      .innerJoin(b, allyJoin)
      .where(pairWhere),
    db
      .select({
        myHeroId: a.heroId,
        myHeroName: heroA.name,
        friendHeroId: b.heroId,
        friendHeroName: heroB.name,
        gamesPlayed: sql<number>`count(*)::int`,
        wins: sql<number>`count(*) filter (where ${a.winner})::int`,
      })
      .from(a)
      .innerJoin(b, allyJoin)
      .innerJoin(heroA, eq(heroA.id, a.heroId))
      .innerJoin(heroB, eq(heroB.id, b.heroId))
      .where(pairWhere)
      .groupBy(a.heroId, heroA.name, b.heroId, heroB.name),
  ]);

  const overview = overviewRows[0] ?? { gamesPlayed: 0, wins: 0 };

  const combos: FaceAFaceHeroCombo[] = comboRows.map((combo) => ({
    ...combo,
    winrate: combo.gamesPlayed > 0 ? combo.wins / combo.gamesPlayed : 0,
    smallSample: false,
  }));
  // No backfill here (unlike getSignatureHeroes): a duo without any combo
  // clearing the floor is a normal, honest "not enough games together yet"
  // state, not something worth papering over with a low-confidence pick.
  const topCombos = combos
    .filter((combo) => combo.gamesPlayed >= FACE_A_FACE_MIN_GAMES_FOR_COMBO)
    .sort((x, y) => y.winrate - x.winrate || y.gamesPlayed - x.gamesPlayed)
    .slice(0, 3);

  return {
    gamesPlayed: overview.gamesPlayed,
    wins: overview.wins,
    winrate: overview.gamesPlayed > 0 ? overview.wins / overview.gamesPlayed : 0,
    topCombos,
  };
}
