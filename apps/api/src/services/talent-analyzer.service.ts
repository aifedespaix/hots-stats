import { db, matchPlayers, matches, talentPicks } from "@hots-stats/db";
import {
  TALENT_TIERS,
  type GameMode,
  type HeroStatsScope,
  type TalentAnalyzerBuild,
  type TalentAnalyzerPin,
  type TalentAnalyzerResponse,
  type TalentAnalyzerTier,
  type TalentTier,
} from "@hots-stats/shared-types";
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { wilsonLowerBound } from "../lib/wilson";

export interface TalentAnalyzerParams {
  userId: string;
  heroId: string;
  mapId?: string;
  scope: HeroStatsScope;
  mode?: GameMode[];
  pins: TalentAnalyzerPin[];
  minGames: number;
}

/**
 * The `matchPlayers.id`s matching the hero/map/scope filters *and* every
 * currently pinned talent -- the population every tier's stats (and the
 * build leaderboard) are computed against. Each pin joins a differently
 * aliased copy of `talent_picks`, so pinning tier 1 and tier 4 requires both
 * a tier-1 row and a tier-4 row to exist for the same match player, not
 * just any two talent_picks rows.
 */
async function getPopulationMatchPlayerIds(params: TalentAnalyzerParams): Promise<string[]> {
  const conditions = [eq(matchPlayers.heroId, params.heroId)];
  if (params.mapId) conditions.push(eq(matches.mapId, params.mapId));
  if (params.scope === "personal") conditions.push(eq(matchPlayers.userId, params.userId));
  if (params.mode && params.mode.length > 0) conditions.push(inArray(matches.gameMode, params.mode));

  let query = db
    .select({ id: matchPlayers.id })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .$dynamic();

  for (const pin of params.pins) {
    const pinnedPick = alias(talentPicks, `pin_tier_${pin.tier}`);
    query = query.innerJoin(
      pinnedPick,
      and(eq(pinnedPick.matchPlayerId, matchPlayers.id), eq(pinnedPick.tier, pin.tier), eq(pinnedPick.talentId, pin.talentId)),
    );
  }

  const rows = await query.where(and(...conditions));
  return rows.map((row) => row.id);
}

async function getTiers(matchPlayerIds: string[], minGames: number): Promise<TalentAnalyzerTier[]> {
  if (matchPlayerIds.length === 0) {
    return TALENT_TIERS.map((tier) => ({ tier, options: [] }));
  }

  const rows = await db
    .select({
      tier: talentPicks.tier,
      talentId: talentPicks.talentId,
      talentName: talentPicks.talentName,
      picks: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
    })
    .from(talentPicks)
    .innerJoin(matchPlayers, eq(matchPlayers.id, talentPicks.matchPlayerId))
    .where(inArray(talentPicks.matchPlayerId, matchPlayerIds))
    .groupBy(talentPicks.tier, talentPicks.talentId, talentPicks.talentName);

  const tierTotals = new Map<number, number>();
  for (const row of rows) {
    tierTotals.set(row.tier, (tierTotals.get(row.tier) ?? 0) + row.picks);
  }

  const byTier = new Map<number, TalentAnalyzerTier["options"]>();
  for (const row of rows) {
    const tierTotal = tierTotals.get(row.tier) ?? 0;
    const list = byTier.get(row.tier) ?? [];
    list.push({
      talentId: row.talentId,
      talentName: row.talentName,
      picks: row.picks,
      pickRate: tierTotal > 0 ? row.picks / tierTotal : 0,
      winrate: row.picks > 0 ? row.wins / row.picks : 0,
      wilsonLowerBound: wilsonLowerBound(row.wins, row.picks),
      reliable: row.picks >= minGames,
    });
    byTier.set(row.tier, list);
  }

  return TALENT_TIERS.map((tier) => ({
    tier,
    options: (byTier.get(tier) ?? []).sort((a, b) => b.wilsonLowerBound - a.wilsonLowerBound),
  }));
}

/**
 * Full talent paths within the population, grouped and ranked for the "Top
 * builds" leaderboard. Fetches every pick row for the population and groups
 * in JS rather than in SQL -- population sizes here (one hero, optionally
 * one map) stay small enough (low thousands at most) that this is simpler
 * and fast enough than a SQL string-aggregation pivot.
 */
async function getTopBuilds(matchPlayerIds: string[], minGames: number): Promise<TalentAnalyzerBuild[]> {
  if (matchPlayerIds.length === 0) return [];

  const [picks, winners] = await Promise.all([
    db
      .select({
        matchPlayerId: talentPicks.matchPlayerId,
        tier: talentPicks.tier,
        talentId: talentPicks.talentId,
        talentName: talentPicks.talentName,
      })
      .from(talentPicks)
      .where(inArray(talentPicks.matchPlayerId, matchPlayerIds)),
    db
      .select({ id: matchPlayers.id, winner: matchPlayers.winner })
      .from(matchPlayers)
      .where(inArray(matchPlayers.id, matchPlayerIds)),
  ]);

  const winnerById = new Map(winners.map((row) => [row.id, row.winner]));

  const picksByMatchPlayer = new Map<string, { tier: TalentTier; talentId: string; talentName: string }[]>();
  for (const pick of picks) {
    const list = picksByMatchPlayer.get(pick.matchPlayerId) ?? [];
    list.push({ tier: pick.tier as TalentTier, talentId: pick.talentId, talentName: pick.talentName });
    picksByMatchPlayer.set(pick.matchPlayerId, list);
  }

  const buildsByPath = new Map<string, { path: TalentAnalyzerBuild["picks"]; gamesPlayed: number; wins: number }>();
  for (const [matchPlayerId, path] of picksByMatchPlayer) {
    const sortedPath = [...path].sort((a, b) => a.tier - b.tier);
    if (sortedPath.length === 0) continue;
    const key = sortedPath.map((pick) => `${pick.tier}:${pick.talentId}`).join("|");
    const entry = buildsByPath.get(key) ?? { path: sortedPath, gamesPlayed: 0, wins: 0 };
    entry.gamesPlayed += 1;
    if (winnerById.get(matchPlayerId)) entry.wins += 1;
    buildsByPath.set(key, entry);
  }

  return [...buildsByPath.values()]
    .filter((build) => build.gamesPlayed >= Math.min(minGames, 2)) // a "build" of 1 game is just noise on the leaderboard, even at a looser reliability setting
    .map((build) => ({
      picks: build.path,
      gamesPlayed: build.gamesPlayed,
      winrate: build.wins / build.gamesPlayed,
      wilsonLowerBound: wilsonLowerBound(build.wins, build.gamesPlayed),
    }))
    .sort((a, b) => b.wilsonLowerBound - a.wilsonLowerBound)
    .slice(0, 10);
}

export async function getTalentAnalysis(params: TalentAnalyzerParams): Promise<TalentAnalyzerResponse> {
  const matchPlayerIds = await getPopulationMatchPlayerIds(params);
  const [tiers, topBuilds] = await Promise.all([
    getTiers(matchPlayerIds, params.minGames),
    getTopBuilds(matchPlayerIds, params.minGames),
  ]);

  return { gamesPlayed: matchPlayerIds.length, tiers, topBuilds };
}
