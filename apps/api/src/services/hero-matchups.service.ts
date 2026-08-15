import { db, heroes, matchPlayers, matches } from "@hots-stats/db";
import { HERO_MATCHUP_MIN_GAMES, type GameMode, type HeroMatchupEntry, type HeroStatsScope } from "@hots-stats/shared-types";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { wilsonLowerBound, wilsonUpperBound } from "../lib/wilson";

interface Baseline {
  gamesPlayed: number;
  winrate: number;
  kda: number;
  avgKillParticipation: number;
  avgHeroDamage: number;
  avgDamageTaken: number;
  avgExperienceContribution: number;
}

const emptyBaseline: Baseline = {
  gamesPlayed: 0,
  winrate: 0,
  kda: 0,
  avgKillParticipation: 0,
  avgHeroDamage: 0,
  avgDamageTaken: 0,
  avgExperienceContribution: 0,
};

/** This hero's own overall performance in the given scope, tous adversaires
 * confondus -- the baseline every matchup entry's `delta*` fields compare
 * against. Not reusing `talents.service`'s `heroStatsQuery`: this needs
 * heroDamage/damageTaken/experienceContribution averages that query doesn't
 * select, and touching its shape would ripple into the Heroes list/detail
 * pages that already depend on it. */
async function getBaseline(userId: string, heroId: string, scope: HeroStatsScope, mode?: GameMode[]): Promise<Baseline> {
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

  const conditions = [eq(matchPlayers.heroId, heroId)];
  if (scope === "personal") conditions.push(eq(matchPlayers.userId, userId));
  if (mode && mode.length > 0) conditions.push(inArray(matches.gameMode, mode));

  const [row] = await db
    .with(teamKills)
    .select({
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
      avgKills: sql<number>`coalesce(avg(${matchPlayers.kills}), 0)::float`,
      avgDeaths: sql<number>`coalesce(avg(${matchPlayers.deaths}), 0)::float`,
      avgAssists: sql<number>`coalesce(avg(${matchPlayers.assists}), 0)::float`,
      avgHeroDamage: sql<number>`coalesce(avg(${matchPlayers.heroDamage}), 0)::float`,
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
    .where(and(...conditions));

  if (!row || row.gamesPlayed === 0) return emptyBaseline;
  return {
    gamesPlayed: row.gamesPlayed,
    winrate: row.wins / row.gamesPlayed,
    kda: (row.avgKills + row.avgAssists) / Math.max(1, row.avgDeaths),
    avgKillParticipation: row.avgKillParticipation,
    avgHeroDamage: row.avgHeroDamage,
    avgDamageTaken: row.avgDamageTaken,
    avgExperienceContribution: row.avgExperienceContribution,
  };
}

/** Relative delta (ratio of baseline) -- used for damage/XP-contribution
 * stats, which are raw counts (not 0-1 ratios like winrate or kill
 * participation) on a scale that varies wildly hero to hero, so an absolute
 * difference wouldn't read consistently across heroes. */
function relativeDelta(matchupValue: number, baselineValue: number): number {
  return baselineValue > 0 ? (matchupValue - baselineValue) / baselineValue : 0;
}

/**
 * Every enemy hero this hero has faced (opposing team, same match) in the
 * given scope, with per-opponent aggregates and deltas against `baseline`.
 * Self-joins `matchPlayers` on `matchId` with `ne(team)`, same pattern as
 * `face-a-face.service.ts`'s `getPairedComboStats`, but keyed by `heroId` on
 * both sides instead of `userId`/`battletag` -- this compares two heroes
 * across the whole scope, not two specific players.
 */
async function getAllMatchupEntries(
  userId: string,
  heroId: string,
  scope: HeroStatsScope,
  baseline: Baseline,
  mode?: GameMode[],
): Promise<HeroMatchupEntry[]> {
  const a = alias(matchPlayers, "a");
  const b = alias(matchPlayers, "b");
  const heroB = alias(heroes, "hero_b");
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

  const conditions = [eq(a.heroId, heroId)];
  if (scope === "personal") conditions.push(eq(a.userId, userId));
  if (mode && mode.length > 0) conditions.push(inArray(matches.gameMode, mode));

  const rows = await db
    .with(teamKills)
    .select({
      heroId: b.heroId,
      heroName: heroB.name,
      heroRole: heroB.role,
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${a.winner})::int`,
      avgKills: sql<number>`coalesce(avg(${a.kills}), 0)::float`,
      avgDeaths: sql<number>`coalesce(avg(${a.deaths}), 0)::float`,
      avgAssists: sql<number>`coalesce(avg(${a.assists}), 0)::float`,
      avgHeroDamage: sql<number>`coalesce(avg(${a.heroDamage}), 0)::float`,
      avgDamageTaken: sql<number>`coalesce(avg(${a.damageTaken}), 0)::float`,
      avgExperienceContribution: sql<number>`coalesce(avg(${a.experienceContribution}), 0)::float`,
      avgKillParticipation: sql<number>`coalesce(avg(
        case when ${teamKills.teamKills} > 0
          then (${a.kills} + ${a.assists})::float / ${teamKills.teamKills}
          else 0
        end
      ), 0)::float`,
    })
    .from(a)
    .innerJoin(b, and(eq(b.matchId, a.matchId), ne(b.team, a.team), ne(b.id, a.id)))
    .innerJoin(matches, eq(matches.id, a.matchId))
    .innerJoin(heroB, eq(heroB.id, b.heroId))
    .innerJoin(teamKills, and(eq(teamKills.matchId, a.matchId), eq(teamKills.team, a.team)))
    .where(and(...conditions))
    .groupBy(b.heroId, heroB.name, heroB.role);

  return rows.map((row) => {
    const winrate = row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0;
    const kda = (row.avgKills + row.avgAssists) / Math.max(1, row.avgDeaths);
    return {
      heroId: row.heroId,
      heroName: row.heroName,
      heroRole: row.heroRole,
      gamesPlayed: row.gamesPlayed,
      wins: row.wins,
      winrate,
      deltaWinrate: winrate - baseline.winrate,
      kda,
      deltaKda: kda - baseline.kda,
      avgKillParticipation: row.avgKillParticipation,
      deltaKillParticipation: row.avgKillParticipation - baseline.avgKillParticipation,
      avgHeroDamage: row.avgHeroDamage,
      deltaHeroDamage: relativeDelta(row.avgHeroDamage, baseline.avgHeroDamage),
      avgDamageTaken: row.avgDamageTaken,
      deltaDamageTaken: relativeDelta(row.avgDamageTaken, baseline.avgDamageTaken),
      avgExperienceContribution: row.avgExperienceContribution,
      deltaExperienceContribution: relativeDelta(row.avgExperienceContribution, baseline.avgExperienceContribution),
      smallSample: row.gamesPlayed < HERO_MATCHUP_MIN_GAMES,
    };
  });
}

/**
 * Picks up to 3 entries, best-first per `rankScore`, preferring ones that
 * clear `HERO_MATCHUP_MIN_GAMES`. Backfills with the most-played remaining
 * entries (flagged `smallSample`, already set by the caller) when fewer than
 * 3 clear that floor -- same top-3-with-backfill rule as
 * `face-a-face.service.ts`'s `pickTopCombos`.
 */
function pickTopMatchups(entries: HeroMatchupEntry[], rankScore: (entry: HeroMatchupEntry) => number) {
  const eligible = entries.filter((entry) => !entry.smallSample);
  const result = [...eligible].sort((x, y) => rankScore(y) - rankScore(x) || y.gamesPlayed - x.gamesPlayed).slice(0, 3);

  if (result.length < 3) {
    const used = new Set(result.map((entry) => entry.heroId));
    const fallback = entries
      .filter((entry) => !used.has(entry.heroId))
      .sort((x, y) => y.gamesPlayed - x.gamesPlayed || rankScore(y) - rankScore(x));
    for (const entry of fallback) {
      if (result.length >= 3) break;
      result.push(entry);
    }
  }
  return result;
}

export interface HeroMatchupsResult {
  baselineWinrate: number;
  baselineGamesPlayed: number;
  bestMatchups: HeroMatchupEntry[];
  worstMatchups: HeroMatchupEntry[];
}

/**
 * Top 3 best/worst enemy-hero matchups for `heroId`, ranked by Wilson score
 * bound (not raw winrate/delta) so a 2-game 100% matchup can't outrank a
 * 40-game 58% one -- same reasoning as the Talent Analyzer's
 * `wilsonLowerBound` sort. "Best" ranks by the confident *lower* bound of
 * the matchup winrate (confidently good); "worst" ranks by the confident
 * *upper* bound (confidently bad).
 */
export async function getHeroMatchups(
  userId: string,
  heroId: string,
  scope: HeroStatsScope,
  mode?: GameMode[],
): Promise<HeroMatchupsResult> {
  const baseline = await getBaseline(userId, heroId, scope, mode);
  const entries = await getAllMatchupEntries(userId, heroId, scope, baseline, mode);

  const bestMatchups = pickTopMatchups(entries, (entry) => wilsonLowerBound(entry.wins, entry.gamesPlayed));
  // Excludes whatever `bestMatchups` already claimed: with few distinct
  // opponents (a niche personal-scope hero, say), the same "least bad of a
  // mediocre bunch" entry could otherwise rank into both lists and show up
  // as simultaneously one of the best and worst matchups, which would trash
  // trust in the whole panel on the very first glance.
  const usedByBest = new Set(bestMatchups.map((entry) => entry.heroId));
  const worstMatchups = pickTopMatchups(
    entries.filter((entry) => !usedByBest.has(entry.heroId)),
    (entry) => -wilsonUpperBound(entry.wins, entry.gamesPlayed),
  );

  return {
    baselineWinrate: baseline.winrate,
    baselineGamesPlayed: baseline.gamesPlayed,
    bestMatchups,
    worstMatchups,
  };
}

export interface HeroMatchupResult {
  baselineWinrate: number;
  baselineGamesPlayed: number;
  opponent: HeroMatchupEntry;
}

/** Single head-to-head lookup for the Matchups search -- same computation as
 * `getHeroMatchups`, narrowed to one opponent. Returns a zeroed-out entry
 * (never an error) when the two heroes have never been on opposing teams,
 * so the search always renders a card. */
export async function getHeroMatchup(
  userId: string,
  heroId: string,
  opponentHeroId: string,
  scope: HeroStatsScope,
  mode?: GameMode[],
): Promise<HeroMatchupResult | null> {
  const baseline = await getBaseline(userId, heroId, scope, mode);
  const entries = await getAllMatchupEntries(userId, heroId, scope, baseline, mode);
  const found = entries.find((entry) => entry.heroId === opponentHeroId);
  if (found) return { baselineWinrate: baseline.winrate, baselineGamesPlayed: baseline.gamesPlayed, opponent: found };

  const [opponentHero] = await db
    .select({ id: heroes.id, name: heroes.name, role: heroes.role })
    .from(heroes)
    .where(eq(heroes.id, opponentHeroId))
    .limit(1);
  if (!opponentHero) return null;

  return {
    baselineWinrate: baseline.winrate,
    baselineGamesPlayed: baseline.gamesPlayed,
    opponent: {
      heroId: opponentHero.id,
      heroName: opponentHero.name,
      heroRole: opponentHero.role,
      gamesPlayed: 0,
      wins: 0,
      winrate: 0,
      deltaWinrate: 0,
      kda: 0,
      deltaKda: 0,
      avgKillParticipation: 0,
      deltaKillParticipation: 0,
      avgHeroDamage: 0,
      deltaHeroDamage: 0,
      avgDamageTaken: 0,
      deltaDamageTaken: 0,
      avgExperienceContribution: 0,
      deltaExperienceContribution: 0,
      smallSample: true,
    },
  };
}
