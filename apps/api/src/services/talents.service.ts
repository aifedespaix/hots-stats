import { db, heroes, matchPlayers, matches, talentPicks } from "@hots-stats/db";
import type { GameMode, NormalizedMetrics, TalentTierStats } from "@hots-stats/shared-types";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type Scope, scopeConditions } from "../lib/account-selection";
import { normalizeMetrics } from "./metrics.service";

export interface HeroStatsRow {
  heroId: string;
  heroName: string;
  heroRole: string | null;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgKillParticipation: number;
  /** Duration-weighted rates over the same filtered match set (A2). */
  normalized: NormalizedMetrics;
}

/**
 * Kill participation needs each match's team total kills, so we aggregate
 * per (match, team) first and join back onto the connected user's rows.
 */
async function heroStatsQuery(
  scope: Scope,
  heroId?: string,
  mode?: GameMode[],
  mapId?: string,
) {
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

  const conditions = scopeConditions([], scope, matchPlayers.battletag);
  if (heroId) conditions.push(eq(matchPlayers.heroId, heroId));
  if (mapId) conditions.push(eq(matches.mapId, mapId));
  if (mode && mode.length > 0) conditions.push(inArray(matches.gameMode, mode));

  return db
    .with(teamKills)
    .select({
      heroId: matchPlayers.heroId,
      heroName: heroes.name,
      heroRole: heroes.role,
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
      avgKills: sql<number>`coalesce(avg(${matchPlayers.kills}), 0)::float`,
      avgDeaths: sql<number>`coalesce(avg(${matchPlayers.deaths}), 0)::float`,
      avgAssists: sql<number>`coalesce(avg(${matchPlayers.assists}), 0)::float`,
      avgKillParticipation: sql<number>`coalesce(avg(
        case when ${teamKills.teamKills} > 0
          then (${matchPlayers.kills} + ${matchPlayers.assists})::float / ${teamKills.teamKills}
          else 0
        end
      ), 0)::float`,
      // Raw sums feeding the duration-weighted rates below (A2), grouped by hero.
      durationSeconds: sql<number>`coalesce(sum(${matches.durationSeconds}), 0)::int`,
      experienceContribution: sql<number>`coalesce(sum(${matchPlayers.experienceContribution}), 0)::float`,
      heroDamage: sql<number>`coalesce(sum(${matchPlayers.heroDamage}), 0)::float`,
      siegeDamage: sql<number>`coalesce(sum(${matchPlayers.siegeDamage}), 0)::float`,
      healing: sql<number>`coalesce(sum(${matchPlayers.healing}), 0)::float`,
      damageTaken: sql<number>`coalesce(sum(${matchPlayers.damageTaken}), 0)::float`,
      kills: sql<number>`coalesce(sum(${matchPlayers.kills}), 0)::int`,
      deaths: sql<number>`coalesce(sum(${matchPlayers.deaths}), 0)::int`,
      assists: sql<number>`coalesce(sum(${matchPlayers.assists}), 0)::int`,
    })
    .from(matchPlayers)
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(teamKills, and(eq(teamKills.matchId, matchPlayers.matchId), eq(teamKills.team, matchPlayers.team)))
    .where(and(...conditions))
    .groupBy(matchPlayers.heroId, heroes.name, heroes.role);
}

export async function getHeroSummaries(
  scope: Scope,
  mode?: GameMode[],
  mapId?: string,
): Promise<HeroStatsRow[]> {
  const rows = await heroStatsQuery(scope, undefined, mode, mapId);
  return rows.map(toHeroStatsRow);
}

export async function getHeroSummary(
  scope: Scope,
  heroId: string,
  mode?: GameMode[],
): Promise<HeroStatsRow | null> {
  const rows = await heroStatsQuery(scope, heroId, mode);
  const row = rows[0];
  if (!row) return null;
  return toHeroStatsRow(row);
}

type HeroStatsQueryRow = Awaited<ReturnType<typeof heroStatsQuery>>[number];

/** Keeps the raw SUM columns out of the API response -- only the derived
 * duration-weighted rates are exposed (A2). */
function toHeroStatsRow(row: HeroStatsQueryRow): HeroStatsRow {
  const {
    durationSeconds,
    experienceContribution,
    heroDamage,
    siegeDamage,
    healing,
    damageTaken,
    kills,
    deaths,
    assists,
    ...hero
  } = row;
  return {
    ...hero,
    winrate: hero.gamesPlayed > 0 ? hero.wins / hero.gamesPlayed : 0,
    normalized: normalizeMetrics({
      durationSeconds,
      experienceContribution,
      heroDamage,
      siegeDamage,
      healing,
      damageTaken,
      kills,
      deaths,
      assists,
    }),
  };
}

const TALENT_TIERS = [1, 4, 7, 10, 13, 16, 20] as const;

export async function getTalentTierStats(scope: Scope, heroId: string, mode?: GameMode[]): Promise<TalentTierStats[]> {
  const conditions = [...scopeConditions([], scope, matchPlayers.battletag), eq(matchPlayers.heroId, heroId)];
  if (mode && mode.length > 0) conditions.push(inArray(matches.gameMode, mode));

  const rows = await db
    .select({
      tier: talentPicks.tier,
      talentId: talentPicks.talentId,
      talentName: talentPicks.talentName,
      picks: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
    })
    .from(talentPicks)
    .innerJoin(matchPlayers, eq(matchPlayers.id, talentPicks.matchPlayerId))
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(and(...conditions))
    .groupBy(talentPicks.tier, talentPicks.talentId, talentPicks.talentName);

  const picksByTier = new Map<number, number>();
  for (const row of rows) {
    picksByTier.set(row.tier, (picksByTier.get(row.tier) ?? 0) + row.picks);
  }

  return rows
    .filter((row) => TALENT_TIERS.includes(row.tier as (typeof TALENT_TIERS)[number]))
    .map((row) => {
      const tierTotal = picksByTier.get(row.tier) ?? 0;
      return {
        tier: row.tier as TalentTierStats["tier"],
        talentId: row.talentId,
        talentName: row.talentName,
        pickRate: tierTotal > 0 ? row.picks / tierTotal : 0,
        winrate: row.picks > 0 ? row.wins / row.picks : 0,
      };
    })
    .sort((a, b) => a.tier - b.tier || b.pickRate - a.pickRate);
}
