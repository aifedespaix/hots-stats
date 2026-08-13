import { db, heroes, matchPlayers, matches } from "@hots-stats/db";
import {
  FACE_A_FACE_MIN_GAMES_FOR_COMBO,
  FACE_A_FACE_MIN_GAMES_FOR_SIGNATURE_HERO,
  type FaceAFaceHeroCombo,
  type FaceAFaceMatchupStats,
  type FaceAFaceOverviewStats,
  type FaceAFaceRoleDistributionEntry,
  type FaceAFaceSignatureHero,
  type FaceAFaceSynergyStats,
} from "@hots-stats/shared-types";
import { and, eq, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

/**
 * Identifies one side of a comparison: a registered account (complete
 * history, survives battletag changes) or a bare battletag (anyone ever seen
 * in a recorded match, account or not) -- comparisons work for any player,
 * not just friends.
 */
export type FaceAFaceTarget = { userId: string } | { battletag: string };

function targetCondition(target: FaceAFaceTarget) {
  return "userId" in target ? eq(matchPlayers.userId, target.userId) : eq(matchPlayers.battletag, target.battletag);
}

/**
 * Account-wide (not per-hero) aggregate for one side of a Face-à-Face
 * comparison -- powers the Tale of the Tape and the raw inputs to the
 * playstyle radar. No `scope` parameter on purpose, unlike getStatsSummary/
 * getHeroSummaries: a comparison between two specific players must never be
 * able to silently balloon into "the whole app's data" via a stray "global"
 * scope -- it would still render, just compare nonsense.
 */
export async function getPlayerOverviewStats(target: FaceAFaceTarget): Promise<FaceAFaceOverviewStats> {
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
    .where(targetCondition(target));

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
export async function getRoleDistribution(target: FaceAFaceTarget): Promise<FaceAFaceRoleDistributionEntry[]> {
  const rows = await db
    .select({ role: heroes.role, gamesPlayed: sql<number>`count(*)::int` })
    .from(matchPlayers)
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .where(targetCondition(target))
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
 * Per-hero breakdown for one side of a comparison. Deliberately not reusing
 * talents.service's `getHeroSummaries` (userId-only): a comparison target
 * without a registered account only has a battletag to filter on.
 */
async function getHeroBreakdown(target: FaceAFaceTarget) {
  const rows = await db
    .select({
      heroId: matchPlayers.heroId,
      heroName: heroes.name,
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
      avgKills: sql<number>`coalesce(avg(${matchPlayers.kills}), 0)::float`,
      avgDeaths: sql<number>`coalesce(avg(${matchPlayers.deaths}), 0)::float`,
      avgAssists: sql<number>`coalesce(avg(${matchPlayers.assists}), 0)::float`,
    })
    .from(matchPlayers)
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .where(targetCondition(target))
    .groupBy(matchPlayers.heroId, heroes.name);

  return rows.map((row) => ({ ...row, winrate: row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0 }));
}

/**
 * Top 3 heroes by winrate among those clearing `FACE_A_FACE_MIN_GAMES_FOR_SIGNATURE_HERO`,
 * backfilled with the most-played remaining heroes (flagged `smallSample`)
 * when fewer than 3 clear the floor -- an empty/short card row reads as
 * broken, a flagged thin-sample pick reads as honest.
 */
export async function getSignatureHeroes(target: FaceAFaceTarget): Promise<FaceAFaceSignatureHero[]> {
  const heroStats = await getHeroBreakdown(target);
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

type ComboRow = Omit<FaceAFaceHeroCombo, "winrate" | "smallSample">;

/**
 * Picks up to 3 combos, best-first per `compare`, preferring ones that clear
 * `FACE_A_FACE_MIN_GAMES_FOR_COMBO`. Backfills with the most-played
 * remaining combos (flagged `smallSample`) when fewer than 3 clear that
 * floor -- same "top 3 minimum, unless there simply aren't 3" rule as
 * signature heroes: only genuinely fewer than 3 distinct combos ever
 * produces a short list.
 */
function pickTopCombos(
  combos: FaceAFaceHeroCombo[],
  compare: (a: FaceAFaceHeroCombo, b: FaceAFaceHeroCombo) => number,
): FaceAFaceHeroCombo[] {
  const eligible = combos.filter((combo) => combo.gamesPlayed >= FACE_A_FACE_MIN_GAMES_FOR_COMBO);
  const result = [...eligible].sort(compare).slice(0, 3).map((combo) => ({ ...combo, smallSample: false }));

  if (result.length < 3) {
    const used = new Set(result.map((combo) => `${combo.myHeroId}-${combo.friendHeroId}`));
    const fallback = combos
      .filter((combo) => !used.has(`${combo.myHeroId}-${combo.friendHeroId}`))
      .sort((a, b) => b.gamesPlayed - a.gamesPlayed || compare(a, b));
    for (const combo of fallback) {
      if (result.length >= 3) break;
      result.push({ ...combo, smallSample: true });
    }
  }
  return result;
}

/**
 * Self-joins `matchPlayers` for games where `userId` and `targetBattletag`
 * both appear, on the given team relation (same team for synergy, opposing
 * teams for matchups). The other side is matched by battletag rather than
 * userId so this works for any player ever seen in a recorded match, account
 * or not.
 */
async function getPairedComboStats(
  userId: string,
  targetBattletag: string,
  sameTeam: boolean,
): Promise<{ gamesPlayed: number; wins: number; combos: ComboRow[] }> {
  const a = alias(matchPlayers, "a");
  const b = alias(matchPlayers, "b");
  const heroA = alias(heroes, "hero_a");
  const heroB = alias(heroes, "hero_b");

  const join = and(eq(b.matchId, a.matchId), sameTeam ? eq(b.team, a.team) : ne(b.team, a.team), ne(b.id, a.id));
  const pairWhere = and(eq(a.userId, userId), eq(b.battletag, targetBattletag));

  const [overviewRows, comboRows] = await Promise.all([
    db
      .select({
        gamesPlayed: sql<number>`count(*)::int`,
        wins: sql<number>`count(*) filter (where ${a.winner})::int`,
      })
      .from(a)
      .innerJoin(b, join)
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
      .innerJoin(b, join)
      .innerJoin(heroA, eq(heroA.id, a.heroId))
      .innerJoin(heroB, eq(heroB.id, b.heroId))
      .where(pairWhere)
      .groupBy(a.heroId, heroA.name, b.heroId, heroB.name),
  ]);

  const overview = overviewRows[0] ?? { gamesPlayed: 0, wins: 0 };
  return { gamesPlayed: overview.gamesPlayed, wins: overview.wins, combos: comboRows };
}

/** Stats for games where `userId` and `targetBattletag` were on the same team. */
export async function getSynergyStats(userId: string, targetBattletag: string): Promise<FaceAFaceSynergyStats> {
  const { gamesPlayed, wins, combos } = await getPairedComboStats(userId, targetBattletag, true);

  const withWinrate: FaceAFaceHeroCombo[] = combos.map((combo) => ({
    ...combo,
    winrate: combo.gamesPlayed > 0 ? combo.wins / combo.gamesPlayed : 0,
    smallSample: false,
  }));
  const topCombos = pickTopCombos(withWinrate, (x, y) => y.winrate - x.winrate || y.gamesPlayed - x.gamesPlayed);

  return {
    gamesPlayed,
    wins,
    winrate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
    topCombos,
  };
}

/**
 * Stats for games where `userId` and `targetBattletag` were on opposing
 * teams -- the raw material for "what should I pick against them" (best
 * winrate combos) and "what do they beat me with" (worst winrate combos).
 */
export async function getMatchupStats(userId: string, targetBattletag: string): Promise<FaceAFaceMatchupStats> {
  const { gamesPlayed, wins, combos } = await getPairedComboStats(userId, targetBattletag, false);

  const withWinrate: FaceAFaceHeroCombo[] = combos.map((combo) => ({
    ...combo,
    winrate: combo.gamesPlayed > 0 ? combo.wins / combo.gamesPlayed : 0,
    smallSample: false,
  }));
  const bestMatchups = pickTopCombos(withWinrate, (x, y) => y.winrate - x.winrate || y.gamesPlayed - x.gamesPlayed);
  const worstMatchups = pickTopCombos(withWinrate, (x, y) => x.winrate - y.winrate || y.gamesPlayed - x.gamesPlayed);

  return {
    gamesPlayed,
    wins,
    winrate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
    bestMatchups,
    worstMatchups,
  };
}
