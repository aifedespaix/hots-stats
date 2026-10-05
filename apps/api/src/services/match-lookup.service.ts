import { db, matchPlayers, matches } from "@hots-stats/db";
import type { MatchLookupInput, MatchLookupItem } from "@hots-stats/shared-types";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { linkedBattletags } from "../lib/account-scope";

interface LookupRow {
  matchId: string;
  replayHash: string;
  parserVersion: string;
  map: string;
  gameMode: string;
  playedAt: Date;
  hero: string | null;
  won: boolean | null;
}

/** One row per match: joining on several linked BattleTags can repeat a match; keep the row that has a hero. */
export function dedupeLookupRows(rows: LookupRow[]): MatchLookupItem[] {
  const byMatch = new Map<string, LookupRow>();
  for (const row of rows) {
    const existing = byMatch.get(row.matchId);
    if (!existing || (existing.hero === null && row.hero !== null)) byMatch.set(row.matchId, row);
  }
  return [...byMatch.values()].map((r) => ({ ...r, playedAt: r.playedAt.toISOString() }));
}

/**
 * Matches the daemon asks about, restricted to the authenticated user's own: uploaded by them,
 * or one of their linked BattleTags played in it (same notion of "mine" as account-scope.ts).
 * Unknown / foreign ids are simply absent from the result.
 */
export async function lookupMatches(userId: string, input: MatchLookupInput): Promise<MatchLookupItem[]> {
  const battletags = await linkedBattletags(userId);
  const wanted = or(
    input.matchIds.length > 0 ? inArray(matches.id, input.matchIds) : undefined,
    input.replayHashes.length > 0 ? inArray(matches.replayHash, input.replayHashes) : undefined,
  );
  const rows = await db
    .select({
      matchId: matches.id,
      replayHash: matches.replayHash,
      parserVersion: matches.parserVersion,
      map: matches.mapId,
      gameMode: matches.gameMode,
      playedAt: matches.playedAt,
      hero: matchPlayers.heroId,
      won: matchPlayers.winner,
    })
    .from(matches)
    .leftJoin(
      matchPlayers,
      and(
        eq(matchPlayers.matchId, matches.id),
        battletags.length > 0 ? inArray(matchPlayers.battletag, battletags) : sql`false`,
      ),
    )
    .where(and(wanted, or(eq(matches.uploadedByUserId, userId), isNotNull(matchPlayers.id))));
  return dedupeLookupRows(rows);
}
