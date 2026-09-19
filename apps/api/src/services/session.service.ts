import { db, heroes, maps, matchPlayers, matches } from "@hots-stats/db";
import type { GameMode, SessionRecapResponse } from "@hots-stats/shared-types";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type Scope, scopeConditions } from "../lib/account-selection";
import { type RosterPlayer, resolveSubject } from "../lib/pattern-aggregate";
import { buildSessionRecap, type SessionMatchInput } from "../lib/session-recap";

export interface SessionFilters {
  mode?: GameMode[];
  /** ISO datetime; omitted = the most recent session. */
  at?: string;
}

/**
 * Builds the E1 session recap over every match the scope played, optionally
 * filtered by mode. The subject of each match is resolved with the same shared
 * rule as A1/A3/A4 (resolveSubject): the SQL scopeCondition already restricts
 * candidate rows to the caller's own battletags, so another user's match can
 * never be selected. This service only scopes, filters and assembles rows --
 * the session selection and stats maths are pure (see ../lib/session-recap.ts).
 */
export async function getSessionRecap(
  scope: Scope,
  filters: SessionFilters,
): Promise<SessionRecapResponse> {
  const conditions = scopeConditions([], scope, matchPlayers.battletag);
  if (filters.mode && filters.mode.length > 0) {
    conditions.push(inArray(matches.gameMode, filters.mode));
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
      heroId: matchPlayers.heroId,
      heroName: heroes.name,
      mapId: matches.mapId,
      mapName: maps.name,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .innerJoin(maps, eq(maps.id, matches.mapId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(matches.playedAt), asc(matchPlayers.matchId));

  const candidatesByMatch = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = candidatesByMatch.get(row.matchId) ?? [];
    list.push(row);
    candidatesByMatch.set(row.matchId, list);
  }

  const scopedBattletags = scope.mode === "personal" ? scope.battletags : [];
  const inputs: SessionMatchInput[] = [];
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
      heroId: row.heroId,
      heroName: row.heroName,
      mapId: row.mapId,
      mapName: row.mapName,
    });
  }

  return { scope: scope.mode, ...buildSessionRecap(inputs, filters.at) };
}
