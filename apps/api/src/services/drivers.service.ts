import { db, matchDeaths, matchLevelSnapshots, matchPlayers, matches } from "@hots-stats/db";
import {
  EARLY_DEATH_BEFORE_SECONDS,
  earlyDeathsCount,
  firstDeathCount,
  levelAt,
  outnumberedDeathsCount,
  type DriversResponse,
  type GameMode,
  type RuleDeath,
  type RuleLevelSnapshot,
  type RuleSubject,
} from "@hots-stats/shared-types";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { type Scope, scopeConditions } from "../lib/account-selection";
import {
  DRIVER_LEVEL_READ_SECONDS,
  buildDriversResponse,
  type DriverMatchInput,
} from "../lib/driver-analysis";
import { type RosterPlayer, resolveSubject } from "../lib/pattern-aggregate";

export interface DriversFilters {
  mode?: GameMode[];
  heroId?: string;
  mapId?: string;
  from?: string;
  to?: string;
}

/**
 * Builds the A4 outcome-driver response over every match the scope played,
 * optionally filtered by mode/hero/map/date. The subject of each match is
 * resolved with the same shared rule as A1/A3 (resolveSubject): the SQL
 * scopeCondition already restricts candidate rows to the caller's own
 * battletags, so another user's match can never be selected. This service
 * only scopes, filters and assembles raw rows -- the maths is pure (see
 * ../lib/driver-analysis.ts).
 */
export async function getDrivers(scope: Scope, filters: DriversFilters): Promise<DriversResponse> {
  const conditions = scopeConditions([], scope, matchPlayers.battletag);
  if (filters.mode && filters.mode.length > 0) conditions.push(inArray(matches.gameMode, filters.mode));
  if (filters.heroId) conditions.push(eq(matchPlayers.heroId, filters.heroId));
  if (filters.mapId) conditions.push(eq(matches.mapId, filters.mapId));
  if (filters.from) conditions.push(gte(matches.playedAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(matches.playedAt, new Date(filters.to)));

  const candidateRows = await db
    .select({
      matchId: matchPlayers.matchId,
      durationSeconds: matches.durationSeconds,
      battletag: matchPlayers.battletag,
      team: matchPlayers.team,
      kills: matchPlayers.kills,
      deaths: matchPlayers.deaths,
      assists: matchPlayers.assists,
      heroDamage: matchPlayers.heroDamage,
      experienceContribution: matchPlayers.experienceContribution,
      winner: matchPlayers.winner,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(matches.playedAt), asc(matchPlayers.matchId));

  if (candidateRows.length === 0) return buildDriversResponse([], scope.mode);

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
  if (matchIds.length === 0) return buildDriversResponse([], scope.mode);

  // Full roster of those matches, not scope-filtered: kill participation needs
  // the subject's whole team, including teammates the scope does not own.
  const rosterRows = await db
    .select({
      matchId: matchPlayers.matchId,
      team: matchPlayers.team,
      kills: matchPlayers.kills,
    })
    .from(matchPlayers)
    .where(inArray(matchPlayers.matchId, matchIds));

  const teamKillsByMatch = new Map<string, number>();
  for (const row of rosterRows) {
    const subject = subjectsByMatch.get(row.matchId);
    if (!subject || row.team !== subject.team) continue;
    teamKillsByMatch.set(row.matchId, (teamKillsByMatch.get(row.matchId) ?? 0) + row.kills);
  }

  const deathRows = await db
    .select({
      matchId: matchPlayers.matchId,
      battletag: matchPlayers.battletag,
      team: matchPlayers.team,
      atSeconds: matchDeaths.atSeconds,
    })
    .from(matchDeaths)
    .innerJoin(matchPlayers, eq(matchPlayers.id, matchDeaths.matchPlayerId))
    .where(inArray(matchPlayers.matchId, matchIds));

  const deathsByMatch = new Map<string, RuleDeath[]>();
  for (const row of deathRows) {
    const list = deathsByMatch.get(row.matchId) ?? [];
    list.push({ battletag: row.battletag, team: row.team === 1 ? 1 : 0, atSeconds: row.atSeconds });
    deathsByMatch.set(row.matchId, list);
  }

  const levelRows = await db
    .select({
      matchId: matchPlayers.matchId,
      battletag: matchPlayers.battletag,
      atSeconds: matchLevelSnapshots.atSeconds,
      level: matchLevelSnapshots.level,
    })
    .from(matchLevelSnapshots)
    .innerJoin(matchPlayers, eq(matchPlayers.id, matchLevelSnapshots.matchPlayerId))
    .where(inArray(matchPlayers.matchId, matchIds));

  const levelsByMatch = new Map<string, RuleLevelSnapshot[]>();
  for (const row of levelRows) {
    const list = levelsByMatch.get(row.matchId) ?? [];
    list.push({ battletag: row.battletag, atSeconds: row.atSeconds, level: row.level });
    levelsByMatch.set(row.matchId, list);
  }

  const inputs: DriverMatchInput[] = [...subjectsByMatch.values()].map((row) => {
    const deaths = deathsByMatch.get(row.matchId) ?? [];
    const snapshots = levelsByMatch.get(row.matchId) ?? [];
    const subject: RuleSubject = {
      battletag: row.battletag,
      team: row.team === 1 ? 1 : 0,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
    };
    const first = firstDeathCount(deaths, subject);
    const early = earlyDeathsCount(deaths, subject, EARLY_DEATH_BEFORE_SECONDS, row.durationSeconds);
    const outnumbered = outnumberedDeathsCount(deaths, subject);
    return {
      matchId: row.matchId,
      winner: row.winner,
      durationSeconds: row.durationSeconds,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      heroDamage: row.heroDamage,
      experienceContribution: row.experienceContribution,
      teamKills: teamKillsByMatch.get(row.matchId) ?? 0,
      earlyDeaths: early.evaluated > 0 ? early.occurrences : null,
      firstDeath: deaths.length === 0 ? null : first.isFirst,
      outnumberedDeaths: deaths.length === 0 ? null : outnumbered.occurrences,
      levelAt10Min:
        row.durationSeconds < DRIVER_LEVEL_READ_SECONDS
          ? null
          : levelAt(snapshots, subject.battletag, DRIVER_LEVEL_READ_SECONDS),
    };
  });

  return buildDriversResponse(inputs, scope.mode);
}
