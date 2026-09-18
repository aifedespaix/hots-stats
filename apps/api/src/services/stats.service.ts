import { db, matchPlayers, matches } from "@hots-stats/db";
import type { GameMode, NormalizedMetrics } from "@hots-stats/shared-types";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type Scope, scopeConditions } from "../lib/account-selection";
import { normalizeMetrics } from "./metrics.service";

export interface StatsSummary {
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgDurationSeconds: number;
  /** Duration-weighted rates over the same filtered match set (A2). */
  normalized: NormalizedMetrics;
}

export async function getStatsSummary(scope: Scope, mode?: GameMode[]): Promise<StatsSummary> {
  const conditions = scopeConditions([], scope, matchPlayers.battletag);
  if (mode && mode.length > 0) conditions.push(inArray(matches.gameMode, mode));

  const [row] = await db
    .select({
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
      avgDurationSeconds: sql<number>`coalesce(avg(${matches.durationSeconds}), 0)::int`,
      // Raw sums feeding the duration-weighted rates below (A2): the rate is
      // sum(stat) / (sum(duration) / unit), never an average of per-match ratios.
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
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const gamesPlayed = row?.gamesPlayed ?? 0;
  const wins = row?.wins ?? 0;

  return {
    gamesPlayed,
    wins,
    winrate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
    avgDurationSeconds: row?.avgDurationSeconds ?? 0,
    normalized: normalizeMetrics({
      durationSeconds: row?.durationSeconds ?? 0,
      experienceContribution: row?.experienceContribution ?? 0,
      heroDamage: row?.heroDamage ?? 0,
      siegeDamage: row?.siegeDamage ?? 0,
      healing: row?.healing ?? 0,
      damageTaken: row?.damageTaken ?? 0,
      kills: row?.kills ?? 0,
      deaths: row?.deaths ?? 0,
      assists: row?.assists ?? 0,
    }),
  };
}
