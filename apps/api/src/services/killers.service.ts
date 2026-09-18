import { db, heroes, matchDeaths, matchPlayers, matches } from "@hots-stats/db";
import type { GameMode, KillersResponse } from "@hots-stats/shared-types";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { type Scope, scopeConditions } from "../lib/account-selection";
import { buildKillersResponse, type KillerCredit, type KillerDeathInput } from "../lib/killer-aggregate";
import { type RosterPlayer, resolveSubject } from "../lib/pattern-aggregate";

export interface KillersFilters {
  mode?: GameMode[];
  heroId?: string;
  mapId?: string;
  from?: string;
  to?: string;
}

/**
 * Aggregates who killed the subject over every match the scope played, optionally
 * filtered by mode/hero/map/date. The subject of each match is resolved with the
 * same shared rule as A1/A3/A4/C4 (resolveSubject): the SQL scopeCondition
 * already restricts candidate rows to the caller's own battletags, so another
 * user's match can never be selected. The counting maths is pure (see
 * ../lib/killer-aggregate.ts).
 */
export async function getKillers(scope: Scope, filters: KillersFilters): Promise<KillersResponse> {
  const conditions = scopeConditions([], scope, matchPlayers.battletag);
  if (filters.mode && filters.mode.length > 0) conditions.push(inArray(matches.gameMode, filters.mode));
  if (filters.heroId) conditions.push(eq(matchPlayers.heroId, filters.heroId));
  if (filters.mapId) conditions.push(eq(matches.mapId, filters.mapId));
  if (filters.from) conditions.push(gte(matches.playedAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(matches.playedAt, new Date(filters.to)));

  const candidateRows = await db
    .select({
      matchId: matchPlayers.matchId,
      playerId: matchPlayers.id,
      battletag: matchPlayers.battletag,
      team: matchPlayers.team,
      kills: matchPlayers.kills,
      deaths: matchPlayers.deaths,
      assists: matchPlayers.assists,
      winner: matchPlayers.winner,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(matches.playedAt), asc(matchPlayers.matchId));

  if (candidateRows.length === 0) return buildKillersResponse([], {}, scope.mode);

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
  if (matchIds.length === 0) return buildKillersResponse([], {}, scope.mode);

  const subjectByPlayerId = new Map<string, (typeof candidateRows)[number]>();
  for (const row of subjectsByMatch.values()) subjectByPlayerId.set(row.playerId, row);

  // Only the subject's own death rows: scoped by match_player id (derived from
  // the scoped rows above), never by a raw userId equality.
  const deathRows = await db
    .select({
      matchPlayerId: matchDeaths.matchPlayerId,
      matchId: matchPlayers.matchId,
      killers: matchDeaths.killers,
      killType: matchDeaths.killType,
    })
    .from(matchDeaths)
    .innerJoin(matchPlayers, eq(matchPlayers.id, matchDeaths.matchPlayerId))
    .where(inArray(matchDeaths.matchPlayerId, [...subjectByPlayerId.keys()]));

  // Full roster of those matches, to resolve each credited battletag to the hero
  // it played in the same match (a killer battletag missing from the roster stays
  // an unresolved credit, never silently attributed to a hero).
  const rosterRows = await db
    .select({
      matchId: matchPlayers.matchId,
      battletag: matchPlayers.battletag,
      heroId: matchPlayers.heroId,
    })
    .from(matchPlayers)
    .where(inArray(matchPlayers.matchId, matchIds));

  const heroByMatchAndTag = new Map<string, Map<string, string | null>>();
  for (const row of rosterRows) {
    let tags = heroByMatchAndTag.get(row.matchId);
    if (!tags) {
      tags = new Map();
      heroByMatchAndTag.set(row.matchId, tags);
    }
    tags.set(row.battletag.toLowerCase(), row.heroId);
  }

  const deaths: KillerDeathInput[] = [];
  for (const row of deathRows) {
    const subject = subjectByPlayerId.get(row.matchPlayerId);
    if (!subject) continue;
    const credits: KillerCredit[] = [];
    for (const battletag of row.killers ?? []) {
      if (!battletag) continue;
      credits.push({
        battletag,
        heroId: heroByMatchAndTag.get(row.matchId)?.get(battletag.toLowerCase()) ?? null,
      });
    }
    deaths.push({
      matchId: row.matchId,
      winner: subject.winner,
      heroKill: row.killType === "hero",
      credits,
    });
  }

  const heroIds = [
    ...new Set(
      deaths
        .flatMap((death) => death.credits.map((credit) => credit.heroId))
        .filter((heroId): heroId is string => heroId !== null),
    ),
  ];
  const heroNames: Record<string, string> = {};
  if (heroIds.length > 0) {
    const heroRows = await db
      .select({ id: heroes.id, name: heroes.name })
      .from(heroes)
      .where(inArray(heroes.id, heroIds));
    for (const hero of heroRows) heroNames[hero.id] = hero.name;
  }

  return buildKillersResponse(deaths, heroNames, scope.mode);
}
