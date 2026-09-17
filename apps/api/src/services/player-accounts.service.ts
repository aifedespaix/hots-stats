import { db, matchPlayers, userAccounts, users } from "@hots-stats/db";
import {
  MAX_LINKED_ACCOUNTS,
  type PlayerAccount,
  type UserAccountSource,
} from "@hots-stats/shared-types";
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { linkedBattletags } from "../lib/account-scope";

export class AccountLimitError extends Error {
  constructor() {
    super(`Maximum ${MAX_LINKED_ACCOUNTS} comptes liés`);
    this.name = "AccountLimitError";
  }
}

/**
 * Raised for both "that tag is already another account's primary" and "you
 * must name a replacement before unlinking your primary". The routes surface
 * it as a 409.
 */
export class PrimaryConflictError extends Error {
  constructor(message = "Ce BattleTag est déjà le compte principal d'un autre utilisateur") {
    super(message);
    this.name = "PrimaryConflictError";
  }
}

export class AccountNotFoundError extends Error {
  constructor() {
    super("Compte introuvable");
    this.name = "AccountNotFoundError";
  }
}

type AccountRow = typeof userAccounts.$inferSelect;

function toPlayerAccount(row: AccountRow): PlayerAccount {
  return {
    battletag: row.battletag,
    toonHandle: row.toonHandle,
    label: row.label,
    isPrimary: row.isPrimary,
    source: row.source,
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * True when `battletag` already appears in a match that also contains one of
 * the user's linked accounts. Personal scope is a set of *player rows*, so
 * linking such a tag makes those matches contribute two rows to every merged
 * stat -- Settings warns about it instead of silently inflating the numbers.
 */
export async function accountOverlapsExisting(userId: string, battletag: string): Promise<boolean> {
  const mine = await linkedBattletags(userId);
  if (mine.length === 0) return false;
  const mineRows = alias(matchPlayers, "mine");
  const target = alias(matchPlayers, "target");
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(target)
    .innerJoin(mineRows, eq(mineRows.matchId, target.matchId))
    .where(and(eq(target.battletag, battletag), inArray(mineRows.battletag, mine)))
    .limit(1);
  return row !== undefined;
}

/** Primary first, then oldest first -- the same order linkedBattletags() uses. */
export async function listAccounts(userId: string): Promise<PlayerAccount[]> {
  const rows = await db.select().from(userAccounts).where(eq(userAccounts.userId, userId));
  return rows
    .sort(
      (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt.getTime() - b.createdAt.getTime(),
    )
    .map(toPlayerAccount);
}

/**
 * Links `battletag` to `userId`, creating the row or refreshing an existing
 * one. Deliberately never throws when the tag is already linked to *another*
 * account: sharing a BattleTag between site accounts is allowed (family /
 * shared machine), only *primary* is exclusive -- see users.battletag's unique
 * constraint.
 *
 * A BattleTag rename arrives as a known toon handle under a new name, so that
 * case renames the existing row instead of accumulating a second account.
 */
export async function linkSelfBattletag(
  userId: string,
  battletag: string,
  toonHandle?: string | null,
  source: UserAccountSource = "daemon",
): Promise<"linked" | "updated"> {
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(userAccounts).where(eq(userAccounts.userId, userId));

    if (toonHandle) {
      const renamed = existing.find(
        (row) => row.toonHandle === toonHandle && row.battletag !== battletag,
      );
      if (renamed) {
        await tx
          .update(userAccounts)
          .set({ battletag, lastSeenAt: new Date() })
          .where(eq(userAccounts.id, renamed.id));
        if (renamed.isPrimary) {
          await tx
            .update(users)
            .set({ battletag, updatedAt: new Date() })
            .where(eq(users.id, userId));
        }
        return "updated";
      }
    }

    const already = existing.find((row) => row.battletag === battletag);
    if (already) {
      await tx
        .update(userAccounts)
        .set({
          lastSeenAt: new Date(),
          ...(toonHandle && !already.toonHandle ? { toonHandle } : {}),
        })
        .where(eq(userAccounts.id, already.id));
      return "linked";
    }

    if (existing.length >= MAX_LINKED_ACCOUNTS) throw new AccountLimitError();

    const [user] = await tx
      .select({ battletag: users.battletag })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // Only the very first account, and only while nobody else holds the tag
    // as their primary -- a shared tag is added as a secondary instead.
    let canBePrimary = existing.length === 0 && !user?.battletag;
    if (canBePrimary) {
      const [claim] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.battletag, battletag))
        .limit(1);
      if (claim && claim.id !== userId) canBePrimary = false;
    }

    await tx
      .insert(userAccounts)
      .values({
        userId,
        battletag,
        toonHandle: toonHandle ?? null,
        isPrimary: canBePrimary,
        source,
        lastSeenAt: new Date(),
      })
      .onConflictDoNothing();

    if (canBePrimary) {
      await tx.update(users).set({ battletag, updatedAt: new Date() }).where(eq(users.id, userId));
    }
    return "linked";
  });
}

/** Manual link from Settings. Idempotent, and never 409s on a shared tag. */
export async function addAccount(
  userId: string,
  battletag: string,
  label?: string,
): Promise<PlayerAccount> {
  await linkSelfBattletag(userId, battletag, null, "manual");
  if (label !== undefined) await updateAccount(userId, battletag, { label });
  const accounts = await listAccounts(userId);
  const found = accounts.find((account) => account.battletag === battletag);
  if (!found) throw new AccountNotFoundError();
  return found;
}

export async function updateAccount(
  userId: string,
  battletag: string,
  input: { label?: string | null; isPrimary?: boolean },
): Promise<PlayerAccount> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(userAccounts)
      .where(and(eq(userAccounts.userId, userId), eq(userAccounts.battletag, battletag)))
      .limit(1);
    if (!row) throw new AccountNotFoundError();

    // isPrimary: false is deliberately ignored -- a user always has exactly
    // one primary while at least one account is linked. Use removeAccount()
    // with a promote target to hand the role over.
    if (input.isPrimary === true && !row.isPrimary) {
      const [claim] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.battletag, battletag))
        .limit(1);
      if (claim && claim.id !== userId) throw new PrimaryConflictError();
      await tx.update(userAccounts).set({ isPrimary: false }).where(eq(userAccounts.userId, userId));
      await tx.update(userAccounts).set({ isPrimary: true }).where(eq(userAccounts.id, row.id));
      await tx
        .update(users)
        .set({ battletag, updatedAt: new Date() })
        .where(eq(users.id, userId));
    }
    if (input.label !== undefined) {
      await tx.update(userAccounts).set({ label: input.label }).where(eq(userAccounts.id, row.id));
    }

    const [updated] = await tx.select().from(userAccounts).where(eq(userAccounts.id, row.id)).limit(1);
    if (!updated) throw new AccountNotFoundError();
    return toPlayerAccount(updated);
  });
}

/**
 * Unlinks a BattleTag. History is never touched: matches stay scoped by the
 * BattleTag, so other accounts (and this one, if it re-links later) still see
 * them. Unlinking the primary while other accounts remain requires
 * `promoteBattletag`; unlinking the last account clears users.battletag.
 */
export async function removeAccount(
  userId: string,
  battletag: string,
  promoteBattletag?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(userAccounts).where(eq(userAccounts.userId, userId));
    const target = rows.find((row) => row.battletag === battletag);
    if (!target) throw new AccountNotFoundError();

    const remaining = rows.filter((row) => row.id !== target.id);

    if (target.isPrimary && remaining.length > 0) {
      const promote = remaining.find((row) => row.battletag === promoteBattletag);
      if (!promote) {
        throw new PrimaryConflictError(
          "Désigne un nouveau compte principal avant de délier celui-ci",
        );
      }
      const [claim] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.battletag, promote.battletag))
        .limit(1);
      if (claim && claim.id !== userId) throw new PrimaryConflictError();
      await tx.update(userAccounts).set({ isPrimary: true }).where(eq(userAccounts.id, promote.id));
      await tx
        .update(users)
        .set({ battletag: promote.battletag, updatedAt: new Date() })
        .where(eq(users.id, userId));
    } else if (target.isPrimary) {
      await tx
        .update(users)
        .set({ battletag: null, updatedAt: new Date() })
        .where(eq(users.id, userId));
    }

    await tx.delete(userAccounts).where(eq(userAccounts.id, target.id));
  });
}
