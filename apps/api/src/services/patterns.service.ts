import { db, matchDeaths, matchLevelSnapshots, matchPlayers, matches } from "@hots-stats/db";
import type { GameMode, PatternsResponse, RuleDeath, RuleLevelSnapshot, RuleSubject } from "@hots-stats/shared-types";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { type Scope, scopeConditions } from "../lib/account-selection";
import {
  EMPTY_PATTERN_AGGREGATE,
  aggregatePatterns,
  resolveSubject,
  type PatternMatchInput,
  type RosterPlayer,
} from "../lib/pattern-aggregate";

export interface PatternsFilters {
  mode?: GameMode[];
  heroId?: string;
  mapId?: string;
  from?: string;
  to?: string;
}

/**
 * Aggregates the shared combat rules (see packages/shared-types/src/coach-rules.ts)
 * over every match the scope played, optionally filtered by mode/hero/map/date.
 *
 * The subject of each match is resolved from the scope's own account set
 * (resolveSubject): the SQL scopeCondition restricts the candidate rows to
 * those battletags, so another user's match can never be selected. The
 * per-match numbers are then handed to the pure aggregator -- this service
 * only scopes, filters and assembles raw rows.
 */
export async function getPatterns(scope: Scope, filters: PatternsFilters): Promise<PatternsResponse> {
  const responseFilter: PatternsResponse["filter"] = {};
  if (filters.heroId) responseFilter.heroId = filters.heroId;
  if (filters.mapId) responseFilter.mapId = filters.mapId;
  if (filters.from) responseFilter.from = filters.from;
  if (filters.to) responseFilter.to = filters.to;

  const conditions = scopeConditions([], scope, matchPlayers.battletag);
  if (filters.mode && filters.mode.length > 0) conditions.push(inArray(matches.gameMode, filters.mode));
  if (filters.heroId) conditions.push(eq(matchPlayers.heroId, filters.heroId));
  if (filters.mapId) conditions.push(eq(matches.mapId, filters.mapId));
  if (filters.from) conditions.push(gte(matches.playedAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(matches.playedAt, new Date(filters.to)));

  const subjectRows = await db
    .select({
      matchId: matchPlayers.matchId,
      playedAt: matches.playedAt,
      durationSeconds: matches.durationSeconds,
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

  if (subjectRows.length === 0) {
    return { scope: scope.mode, aggregate: EMPTY_PATTERN_AGGREGATE, filter: responseFilter };
  }

  const scopedBattletags = scope.mode === "personal" ? scope.battletags : [];

  // One subject row per match: the scope's first account that played it. An
  // explicit hero/map filter already narrowed the candidate rows, so every
  // pattern below shares this exact denominator.
  const candidatesByMatch = new Map<string, typeof subjectRows>();
  for (const row of subjectRows) {
    const list = candidatesByMatch.get(row.matchId) ?? [];
    list.push(row);
    candidatesByMatch.set(row.matchId, list);
  }

  const subjectsByMatch = new Map<string, (typeof subjectRows)[number]>();
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
  if (matchIds.length === 0) {
    return { scope: scope.mode, aggregate: EMPTY_PATTERN_AGGREGATE, filter: responseFilter };
  }

  // Full roster of those matches, not scope-filtered: the enemy battletags
  // drive the level comparison of the talent-delay rule.
  const rosterRows = await db
    .select({ matchId: matchPlayers.matchId, battletag: matchPlayers.battletag, team: matchPlayers.team })
    .from(matchPlayers)
    .where(inArray(matchPlayers.matchId, matchIds));

  const enemyBattletagsByMatch = new Map<string, string[]>();
  for (const row of rosterRows) {
    const subject = subjectsByMatch.get(row.matchId);
    if (!subject || row.team === subject.team) continue;
    const list = enemyBattletagsByMatch.get(row.matchId) ?? [];
    list.push(row.battletag);
    enemyBattletagsByMatch.set(row.matchId, list);
  }

  const deathRows = await db
    .select({
      matchId: matchPlayers.matchId,
      battletag: matchPlayers.battletag,
      team: matchPlayers.team,
      atSeconds: matchDeaths.atSeconds,
      x: matchDeaths.x,
      y: matchDeaths.y,
    })
    .from(matchDeaths)
    .innerJoin(matchPlayers, eq(matchPlayers.id, matchDeaths.matchPlayerId))
    .where(inArray(matchPlayers.matchId, matchIds));

  const deathsByMatch = new Map<string, RuleDeath[]>();
  const positionsByMatch = new Set<string>();
  for (const row of deathRows) {
    const list = deathsByMatch.get(row.matchId) ?? [];
    list.push({ battletag: row.battletag, team: row.team === 1 ? 1 : 0, atSeconds: row.atSeconds });
    deathsByMatch.set(row.matchId, list);
    if (row.x !== null && row.y !== null) positionsByMatch.add(row.matchId);
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

  const inputs: PatternMatchInput[] = [...subjectsByMatch.values()]
    .sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime() || a.matchId.localeCompare(b.matchId))
    .map((row) => {
      const deaths = deathsByMatch.get(row.matchId) ?? [];
      const levelSnapshots = levelsByMatch.get(row.matchId) ?? [];
      const subject: RuleSubject = {
        battletag: row.battletag,
        team: row.team === 1 ? 1 : 0,
        kills: row.kills,
        deaths: row.deaths,
        assists: row.assists,
      };
      return {
        matchId: row.matchId,
        playedAt: row.playedAt.toISOString(),
        durationSeconds: row.durationSeconds,
        winner: row.winner,
        subject,
        deaths,
        levelSnapshots,
        enemyBattletags: enemyBattletagsByMatch.get(row.matchId) ?? [],
        hasTimeline: deaths.length > 0 || levelSnapshots.length > 0,
        hasPositions: positionsByMatch.has(row.matchId),
      };
    });

  return { scope: scope.mode, aggregate: aggregatePatterns(inputs), filter: responseFilter };
}
