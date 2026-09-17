import { db, userAccounts, users } from "@hots-stats/db";
import { MAX_LINKED_ACCOUNTS } from "@hots-stats/shared-types";
import { eq } from "drizzle-orm";
import {
  type Scope,
  UnlinkedAccountError,
  intersectSelection,
  parseAccountSelection,
} from "./account-selection";

// Re-exported so callers have a single import for the whole scope story.
export * from "./account-selection";

/**
 * Every BattleTag linked to a user, primary first then oldest first (a stable
 * order, so the API's own default and the web's "all accounts" agree).
 *
 * Falls back to users.battletag when user_accounts is still empty: that is the
 * window between this code shipping and a user's first link (the migration
 * backfills everyone who already had a battletag, but a brand new account has
 * neither).
 */
export async function linkedBattletags(userId: string): Promise<string[]> {
  const rows = await db
    .select({
      battletag: userAccounts.battletag,
      isPrimary: userAccounts.isPrimary,
      createdAt: userAccounts.createdAt,
    })
    .from(userAccounts)
    .where(eq(userAccounts.userId, userId));

  if (rows.length > 0) {
    return rows
      .sort(
        (a, b) =>
          Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt.getTime() - b.createdAt.getTime(),
      )
      .map((row) => row.battletag)
      .slice(0, MAX_LINKED_ACCOUNTS);
  }

  const [user] = await db
    .select({ battletag: users.battletag })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.battletag ? [user.battletag] : [];
}

/**
 * Turns a request into a Scope. Absent `requested` means "all linked
 * accounts". A requested Tag the user does not own is a hard error -- see
 * `intersectSelection` for why.
 */
export async function resolveScope(userId: string, requested?: string): Promise<Scope> {
  const parsed = parseAccountSelection(requested);
  const linked = await linkedBattletags(userId);
  if (parsed === undefined) return { mode: "personal", battletags: linked };

  const { kept, missing } = intersectSelection(parsed, linked);
  if (missing.length > 0) throw new UnlinkedAccountError(missing);
  return { mode: "personal", battletags: kept };
}
