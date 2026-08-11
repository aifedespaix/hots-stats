import { db, matchPlayers, matches } from "@hots-stats/db";
import { eq, sql } from "drizzle-orm";

export interface StatsSummary {
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgDurationSeconds: number;
}

export async function getStatsSummary(userId: string): Promise<StatsSummary> {
  const [row] = await db
    .select({
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
      avgDurationSeconds: sql<number>`coalesce(avg(${matches.durationSeconds}), 0)::int`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(eq(matchPlayers.userId, userId));

  const gamesPlayed = row?.gamesPlayed ?? 0;
  const wins = row?.wins ?? 0;

  return {
    gamesPlayed,
    wins,
    winrate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
    avgDurationSeconds: row?.avgDurationSeconds ?? 0,
  };
}
