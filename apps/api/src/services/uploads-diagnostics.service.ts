import { db, matchPlayers, matches, users } from "@hots-stats/db";
import { desc, eq, isNull, sql } from "drizzle-orm";

/**
 * `GET /_internal/diagnostics/uploads` -- breaks down who actually owns the
 * rows behind the "games" counts the web app shows (`matches.uploadedByUserId`
 * for distinct matches, `match_players` rows for the per-hero/global counts
 * that sum ~10 rows per match). Built to explain discrepancies like "personal
 * scope shows N games but global shows way more than N" without needing a
 * direct DATABASE_URL connection.
 */
export async function getUploadsDiagnostics() {
  const totalsRow = await db
    .select({
      totalMatches: sql<number>`count(distinct ${matches.id})::int`,
      totalMatchPlayers: sql<number>`count(${matchPlayers.id})::int`,
    })
    .from(matches)
    .leftJoin(matchPlayers, eq(matchPlayers.matchId, matches.id));
  const totals = totalsRow[0] ?? { totalMatches: 0, totalMatchPlayers: 0 };

  const byUploader = await db
    .select({
      uploadedByUserId: matches.uploadedByUserId,
      email: users.email,
      battletag: users.battletag,
      displayName: users.displayName,
      matchCount: sql<number>`count(*)::int`,
      firstUploadedAt: sql<string>`min(${matches.createdAt})`,
      lastUploadedAt: sql<string>`max(${matches.createdAt})`,
    })
    .from(matches)
    .leftJoin(users, eq(users.id, matches.uploadedByUserId))
    .groupBy(matches.uploadedByUserId, users.email, users.battletag, users.displayName)
    .orderBy(desc(sql`count(*)`));

  const byBattletagInMatchPlayers = await db
    .select({
      battletag: matchPlayers.battletag,
      userId: matchPlayers.userId,
      linkedEmail: users.email,
      rowCount: sql<number>`count(*)::int`,
      distinctMatches: sql<number>`count(distinct ${matchPlayers.matchId})::int`,
    })
    .from(matchPlayers)
    .leftJoin(users, eq(users.id, matchPlayers.userId))
    .groupBy(matchPlayers.battletag, matchPlayers.userId, users.email)
    .orderBy(desc(sql`count(*)`))
    .limit(50);

  const unlinkedBattletagRow = await db
    .select({ count: sql<number>`count(distinct ${matchPlayers.battletag})::int` })
    .from(matchPlayers)
    .where(isNull(matchPlayers.userId));

  return {
    totals,
    byUploader,
    topBattletagsInMatchPlayers: byBattletagInMatchPlayers,
    distinctUnlinkedBattletags: unlinkedBattletagRow[0]?.count ?? 0,
  };
}
