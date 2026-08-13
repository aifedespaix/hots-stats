import { db, matchPlayers, matches } from "@hots-stats/db";
import { and, eq, isNull, sql } from "drizzle-orm";

/**
 * A battletag present in 100% of this user's own uploaded matches is very
 * likely their own -- a replay can only exist on their machine because they
 * played in that game. Null when there's no upload history yet, or when no
 * single battletag is universal across it (e.g. uploads from a shared PC
 * covering more than one player) -- better to suggest nothing than guess wrong.
 */
export async function suggestBattletag(userId: string): Promise<string | null> {
  const [totalRow] = await db
    .select({ total: sql<number>`count(distinct ${matches.id})::int` })
    .from(matches)
    .where(eq(matches.uploadedByUserId, userId));
  const total = totalRow?.total ?? 0;
  if (total === 0) return null;

  const rows = await db
    .select({
      battletag: matchPlayers.battletag,
      matchCount: sql<number>`count(distinct ${matchPlayers.matchId})::int`,
    })
    .from(matches)
    .innerJoin(matchPlayers, eq(matchPlayers.matchId, matches.id))
    .where(eq(matches.uploadedByUserId, userId))
    .groupBy(matchPlayers.battletag);

  // A battletag hitting 100% coverage is only a confident signal when it's
  // the *only* one -- someone who has (so far) only ever uploaded games
  // played alongside the exact same duo partner would otherwise tie, and
  // picking either arbitrarily would be a coin flip, not a detection.
  const universal = rows.filter((row) => row.matchCount === total);
  return universal.length === 1 ? universal[0]!.battletag : null;
}

/**
 * Backfills match_players.userId for historical rows under `battletag` that
 * predate this account claiming it -- ingest-time linking (replay-upsert.service.ts)
 * only matches against the battletag snapshot at upload time, so a battletag
 * set/changed afterwards would otherwise leave that history orphaned forever.
 * Only touches still-unlinked rows: a battletag string has no ownership
 * verification and could in principle have belonged to a different account
 * previously, so an already-linked row must never be re-pointed.
 */
export async function linkUnclaimedMatchPlayers(userId: string, battletag: string): Promise<number> {
  const result = await db
    .update(matchPlayers)
    .set({ userId })
    .where(and(eq(matchPlayers.battletag, battletag), isNull(matchPlayers.userId)))
    .returning({ id: matchPlayers.id });
  return result.length;
}
