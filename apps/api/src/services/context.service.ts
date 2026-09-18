import { db, heroes, matchPlayers, matches } from "@hots-stats/db";
import type { ContextResponse, GameMode } from "@hots-stats/shared-types";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { type Scope, scopeConditions } from "../lib/account-selection";
import { buildContextResponse, type ContextMatchInput } from "../lib/context-aggregate";
import { type RosterPlayer, resolveSubject } from "../lib/pattern-aggregate";

export interface ContextFilters {
  mode?: GameMode[];
  heroId?: string;
  mapId?: string;
  from?: string;
  to?: string;
}

/**
 * Builds the C4 context breakdown over every match the scope played, optionally
 * filtered by mode/hero/map/date. The subject of each match is resolved with the
 * same shared rule as A1/A3/A4 (resolveSubject): the SQL scopeCondition already
 * restricts candidate rows to the caller's own battletags, so another user's
 * match can never be selected. Team-composition counts are taken from the
 * subject's own team only. The bucketing maths is pure (see
 * ../lib/context-aggregate.ts).
 */
export async function getContext(
  scope: Scope,
  filters: ContextFilters,
  tzOffsetMinutes: number,
): Promise<ContextResponse> {
  const conditions = scopeConditions([], scope, matchPlayers.battletag);
  if (filters.mode && filters.mode.length > 0) conditions.push(inArray(matches.gameMode, filters.mode));
  if (filters.heroId) conditions.push(eq(matchPlayers.heroId, filters.heroId));
  if (filters.mapId) conditions.push(eq(matches.mapId, filters.mapId));
  if (filters.from) conditions.push(gte(matches.playedAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(matches.playedAt, new Date(filters.to)));

  const candidateRows = await db
    .select({
      matchId: matchPlayers.matchId,
      playedAt: matches.playedAt,
      gameVersion: matches.gameVersion,
      winner: matchPlayers.winner,
      battletag: matchPlayers.battletag,
      team: matchPlayers.team,
      kills: matchPlayers.kills,
      deaths: matchPlayers.deaths,
      assists: matchPlayers.assists,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(matches.playedAt), asc(matchPlayers.matchId));

  if (candidateRows.length === 0) return buildContextResponse([], scope.mode, tzOffsetMinutes);

  const scopedBattletags = scope.mode === "personal" ? scope.battletags : [];
  const candidatesByMatch = new Map<string, typeof candidateRows>();
  for (const row of candidateRows) {
    const list = candidatesByMatch.get(row.matchId) ?? [];
    list.push(row);
    candidatesByMatch.set(row.matchId, list);
  }

  // One subject row per match: the scope's first account that played it.
  const subjectsByMatch = new Map<string, (typeof candidateRows)[number]>();
  for (const [matchId, candidates] of candidatesByMatch) {
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
    if (row) subjectsByMatch.set(matchId, row);
  }

  const matchIds = [...subjectsByMatch.keys()];
  if (matchIds.length === 0) return buildContextResponse([], scope.mode, tzOffsetMinutes);

  // Full roster of those matches joined to hero roles, then restricted to the
  // subject's own team -- team composition is "what my team looked like", not
  // the enemy's.
  const rosterRows = await db
    .select({ matchId: matchPlayers.matchId, team: matchPlayers.team, role: heroes.role })
    .from(matchPlayers)
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .where(inArray(matchPlayers.matchId, matchIds));

  const roleCountsByMatch = new Map<string, Record<string, number>>();
  for (const row of rosterRows) {
    const subject = subjectsByMatch.get(row.matchId);
    if (!subject || row.team !== subject.team) continue;
    const counts = roleCountsByMatch.get(row.matchId) ?? {};
    const role = row.role ?? "unknown";
    counts[role] = (counts[role] ?? 0) + 1;
    roleCountsByMatch.set(row.matchId, counts);
  }

  const inputs: ContextMatchInput[] = [...subjectsByMatch.values()].map((row) => ({
    matchId: row.matchId,
    playedAt: row.playedAt.toISOString(),
    winner: row.winner,
    gameVersion: row.gameVersion,
    teamRoleCounts: roleCountsByMatch.get(row.matchId) ?? {},
  }));

  return buildContextResponse(inputs, scope.mode, tzOffsetMinutes);
}
