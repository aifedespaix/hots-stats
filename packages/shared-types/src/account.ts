import { z } from "zod";

/**
 * How a BattleTag ended up linked to a site account.
 * - legacy:    backfilled from users.battletag by the multi-account migration.
 * - battlenet: auto-filled from the Battle.net OAuth profile.
 * - daemon:    declared by the daemon from a local replay file (trusted).
 * - manual:    typed by the player in Settings (unverified).
 */
export const userAccountSourceSchema = z.enum(["legacy", "battlenet", "daemon", "manual"]);
export type UserAccountSource = z.infer<typeof userAccountSourceSchema>;

/**
 * One BattleTag linked to a site account, as returned by GET /auth/me and
 * GET /ingest/accounts. Personal stats are computed from a *set* of these.
 */
export interface PlayerAccount {
  battletag: string;
  /** Stable across a BattleTag rename, e.g. "2-Hero-1-4929240". */
  toonHandle: string | null;
  /** Free-form label ("Main", "Smurf"), never used programmatically. */
  label: string | null;
  isPrimary: boolean;
  source: UserAccountSource;
  lastSeenAt: string | null;
  createdAt: string;
}

/** BattleTags read "Name#1234"; 3..64 leaves room for both parts on any locale. */
export const battletagSchema = z.string().trim().min(3).max(64);

export const addAccountInputSchema = z.object({
  battletag: battletagSchema,
  label: z.string().trim().max(32).optional(),
});
export type AddAccountInput = z.infer<typeof addAccountInputSchema>;

export const updateAccountInputSchema = z.object({
  label: z.string().trim().max(32).nullable().optional(),
  isPrimary: z.boolean().optional(),
});
export type UpdateAccountInput = z.infer<typeof updateAccountInputSchema>;

/**
 * Caps both the `?accounts=` query list and the number of accounts linked to
 * one user, bounding the `battletag IN (...)` the personal scope compiles to.
 */
export const MAX_LINKED_ACCOUNTS = 20;
