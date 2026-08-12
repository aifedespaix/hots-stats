import { db, matches, users } from "@hots-stats/db";
import { eq, sql } from "drizzle-orm";

/**
 * Wipes every match a user uploaded themselves (`matches.uploadedByUserId`),
 * cascading to `match_players`/`talent_picks`, and stamps `dataResetAt` so
 * the next `GET /ingest/version` tells their daemon to forget its local
 * "already synced" state (see `routes/ingest.ts` and the daemon's
 * `app.py`/`sync_state.py`). Scoped strictly to matches this account
 * uploaded -- never touches matches a friend uploaded that this user
 * happens to appear in as an opponent/ally, since those aren't this
 * account's data to delete.
 *
 * This is the "start fresh" escape hatch for corrupted history (wrong hero
 * attributed, mistagged game mode, etc. from a since-fixed parser bug): the
 * daemon re-derives everything from the `.StormReplay` files still on disk,
 * so this only actually restores data if those files haven't been deleted.
 */
export async function resetUserData(userId: string): Promise<{ deletedMatches: number; dataResetAt: Date }> {
  const dataResetAt = new Date();

  const deleted = await db.transaction(async (tx) => {
    const countRows = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(matches)
      .where(eq(matches.uploadedByUserId, userId));

    await tx.delete(matches).where(eq(matches.uploadedByUserId, userId));
    await tx.update(users).set({ dataResetAt, updatedAt: dataResetAt }).where(eq(users.id, userId));

    return countRows[0]?.value ?? 0;
  });

  return { deletedMatches: deleted, dataResetAt };
}
