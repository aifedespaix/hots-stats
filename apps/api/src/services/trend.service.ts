import { db, matchPlayers, matches } from "@hots-stats/db";
import { UNKNOWN_GAME_VERSION, type GameMode, type TrendResponse } from "@hots-stats/shared-types";
import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { type Scope, scopeConditions } from "../lib/account-selection";
import { type RosterPlayer, resolveSubject } from "../lib/pattern-aggregate";
import { buildTrendResponse, type TrendMatchInput } from "../lib/trend-series";

export interface TrendFilters {
  mode?: GameMode[];
  heroId?: string;
  mapId?: string;
  from?: string;
  to?: string;
  gameVersion?: string[];
  window: number;
  compareTo?: string;
}

/**
 * Builds the A3 rolling trend over every match the scope played, optionally
 * filtered by mode/hero/map/date/gameVersion. The subject of each match is
 * resolved with the same shared rule as A1 (resolveSubject): the SQL
 * scopeCondition already restricts candidate rows to the caller's own
 * battletags, so another user's match can never be selected. This service only
 * scopes, filters and orders rows -- the rolling math is pure (see
 * ../lib/trend-series.ts).
 */
export async function getTrend(scope: Scope, filters: TrendFilters): Promise<TrendResponse> {
  const conditions = scopeConditions([], scope, matchPlayers.battletag);
  if (filters.mode && filters.mode.length > 0) conditions.push(inArray(matches.gameMode, filters.mode));
  if (filters.heroId) conditions.push(eq(matchPlayers.heroId, filters.heroId));
  if (filters.mapId) conditions.push(eq(matches.mapId, filters.mapId));
  if (filters.from) conditions.push(gte(matches.playedAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(matches.playedAt, new Date(filters.to)));
  if (filters.gameVersion && filters.gameVersion.length > 0) {
    const knownVersions = filters.gameVersion.filter((version) => version !== UNKNOWN_GAME_VERSION);
    const versionConditions = [
      ...(knownVersions.length > 0 ? [inArray(matches.gameVersion, knownVersions)] : []),
      ...(filters.gameVersion.includes(UNKNOWN_GAME_VERSION) ? [isNull(matches.gameVersion)] : []),
    ];
    // Never empty: gameVersionListSchema validates a non-empty list which
    // splits into exactly these two buckets.
    conditions.push(or(...versionConditions)!);
  }

  const rows = await db
    .select({
      matchId: matchPlayers.matchId,
      playedAt: matches.playedAt,
      durationSeconds: matches.durationSeconds,
      gameVersion: matches.gameVersion,
      battletag: matchPlayers.battletag,
      team: matchPlayers.team,
      kills: matchPlayers.kills,
      deaths: matchPlayers.deaths,
      assists: matchPlayers.assists,
      winner: matchPlayers.winner,
      experienceContribution: matchPlayers.experienceContribution,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(matches.playedAt), asc(matchPlayers.matchId));

  const candidatesByMatch = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = candidatesByMatch.get(row.matchId) ?? [];
    list.push(row);
    candidatesByMatch.set(row.matchId, list);
  }

  const scopedBattletags = scope.mode === "personal" ? scope.battletags : [];
  const inputs: TrendMatchInput[] = [];
  for (const candidates of candidatesByMatch.values()) {
    const roster: RosterPlayer[] = candidates.map((row) => ({
      battletag: row.battletag,
      team: row.team === 1 ? 1 : 0,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      winner: row.winner,
    }));
    const subject = resolveSubject(roster, scopedBattletags);
    if (!subject) continue;
    const row = candidates.find((candidate) => candidate.battletag === subject.battletag);
    if (!row) continue;
    inputs.push({
      matchId: row.matchId,
      playedAt: row.playedAt.toISOString(),
      winner: row.winner,
      durationSeconds: row.durationSeconds,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      experienceContribution: row.experienceContribution,
      gameVersion: row.gameVersion,
    });
  }

  return buildTrendResponse(inputs, { window: filters.window, compareTo: filters.compareTo });
}
