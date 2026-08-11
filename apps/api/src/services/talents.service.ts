import { db, heroes, matchPlayers, talentPicks } from "@hots-stats/db";
import type { TalentTierStats } from "@hots-stats/shared-types";
import { and, eq, sql } from "drizzle-orm";

export interface HeroStatsRow {
  heroId: string;
  heroName: string;
  heroRole: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgKillParticipation: number;
}

/**
 * Kill participation needs each match's team total kills, so we aggregate
 * per (match, team) first and join back onto the connected user's rows.
 */
async function heroStatsQuery(userId: string, heroId?: string) {
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

  const conditions = [eq(matchPlayers.userId, userId)];
  if (heroId) conditions.push(eq(matchPlayers.heroId, heroId));

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
    })
    .from(matchPlayers)
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .innerJoin(teamKills, and(eq(teamKills.matchId, matchPlayers.matchId), eq(teamKills.team, matchPlayers.team)))
    .where(and(...conditions))
    .groupBy(matchPlayers.heroId, heroes.name, heroes.role);
}

export async function getHeroSummaries(userId: string): Promise<HeroStatsRow[]> {
  const rows = await heroStatsQuery(userId);
  return rows.map((row) => ({
    ...row,
    winrate: row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0,
  }));
}

export async function getHeroSummary(userId: string, heroId: string): Promise<HeroStatsRow | null> {
  const rows = await heroStatsQuery(userId, heroId);
  const row = rows[0];
  if (!row) return null;
  return { ...row, winrate: row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0 };
}

const TALENT_TIERS = [1, 4, 7, 10, 13, 16, 20] as const;

export async function getTalentTierStats(userId: string, heroId: string): Promise<TalentTierStats[]> {
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
    .where(and(eq(matchPlayers.heroId, heroId), eq(matchPlayers.userId, userId)))
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
