import { db, matchPlayers, matches } from "@hots-stats/db";
import type { GameMode } from "@hots-stats/shared-types";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type Scope, scopeConditions } from "../lib/account-selection";

export interface StatsSummary {
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgDurationSeconds: number;
}

export async function getStatsSummary(scope: Scope, mode?: GameMode[]): Promise<StatsSummary> {
  const conditions = scopeConditions([], scope, matchPlayers.battletag);
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
