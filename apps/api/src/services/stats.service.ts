import { db, matchPlayers, matches } from "@hots-stats/db";
import type { GameMode, HeroStatsScope } from "@hots-stats/shared-types";
import { and, eq, inArray, sql } from "drizzle-orm";

export interface StatsSummary {
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgDurationSeconds: number;
}

export async function getStatsSummary(
  userId: string,
  scope: HeroStatsScope = "personal",
  mode?: GameMode[],
): Promise<StatsSummary> {
  const conditions = scope === "personal" ? [eq(matchPlayers.userId, userId)] : [];
  if (mode && mode.length > 0) conditions.push(inArray(matches.gameMode, mode));

  const [row] = await db
    .select({
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
      avgDurationSeconds: sql<number>`coalesce(avg(${matches.durationSeconds}), 0)::int`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const gamesPlayed = row?.gamesPlayed ?? 0;
  const wins = row?.wins ?? 0;

  return {
    gamesPlayed,
    wins,
    winrate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
    avgDurationSeconds: row?.avgDurationSeconds ?? 0,
  };
}
