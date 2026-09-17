import { MAX_LINKED_ACCOUNTS } from "@hots-stats/shared-types";

export { MAX_LINKED_ACCOUNTS };
import { type SQL, inArray, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

/**
 * Pure half of the personal-scope plumbing: everything here is a function of
 * its arguments, with no database access, so it is unit-testable without a
 * DATABASE_URL (importing @hots-stats/db throws without one -- see
 * packages/db/src/client.ts). The db-bound half lives in `account-scope.ts`,
 * which re-exports all of this.
 */

/** `?accounts=A#1,B#2` -- omitted means "every account linked to the user". */
export const accountsQuerySchema = z.string().max(1500).optional();

/** Personal scope is a BattleTag set; global scope ignores accounts entirely. */
export type Scope = { mode: "personal"; battletags: string[] } | { mode: "global" };

/** Base class so the middleware can turn any scope failure into a 400. */
export class ScopeError extends Error {}

/** A requested BattleTag is not linked to the requesting account. */
export class UnlinkedAccountError extends ScopeError {
  constructor(readonly battletags: string[]) {
    super(`Compte non lié : ${battletags.join(", ")}`);
    this.name = "UnlinkedAccountError";
  }
}

/** More than MAX_LINKED_ACCOUNTS were requested in one query. */
export class TooManyAccountsError extends ScopeError {
  constructor() {
    super(`Trop de comptes demandés (max ${MAX_LINKED_ACCOUNTS})`);
    this.name = "TooManyAccountsError";
  }
}

/**
 * Splits the raw `?accounts=` value. Returns `undefined` when the parameter is
 * absent or empty, which callers read as "all linked accounts".
 * Dedupes case-insensitively (BattleTag casing is not stable across clients),
 * keeping the first spelling seen.
 */
export function parseAccountSelection(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const tag = part.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  if (out.length > MAX_LINKED_ACCOUNTS) throw new TooManyAccountsError();
  return out.length > 0 ? out : undefined;
}

/**
 * Splits `requested` into tags the user owns (returned in the casing the
 * server stored) and tags they do not. The caller turns a non-empty
 * `missing` into a 400: silently dropping an unknown tag would make a typo
 * read as "no games", and accepting it would expose another player's stats.
 */
export function intersectSelection(
  requested: string[],
  linked: string[],
): { kept: string[]; missing: string[] } {
  const byLower = new Map(linked.map((tag) => [tag.toLowerCase(), tag]));
  const kept: string[] = [];
  const missing: string[] = [];
  for (const tag of requested) {
    const stored = byLower.get(tag.toLowerCase());
    if (stored) kept.push(stored);
    else missing.push(tag);
  }
  return { kept, missing };
}

/**
 * Combines the request's resolved personal scope with the legacy
 * `?scope=personal|global` toggle (per-user default in users.heroStatsScope).
 * "global" wins and ignores accounts entirely.
 */
export function withStatsScope(
  scope: Scope,
  requested?: "personal" | "global",
  fallback?: "personal" | "global",
): Scope {
  const effective = requested ?? fallback ?? "personal";
  return effective === "global" ? { mode: "global" } : scope;
}

/**
 * SQL condition restricting a `match_players` reference to a scope. Returns
 * `undefined` for the global scope so callers can spread it into an `and()`.
 * An empty personal scope compiles to `false` -- matches nothing, rather than
 * silently matching everything. `column` targets an aliased match_players
 * (e.g. the `other` self-join in players.service.ts).
 */
export function scopeCondition(scope: Scope, column: AnyPgColumn): SQL | undefined {
  if (scope.mode === "global") return undefined;
  if (scope.battletags.length === 0) return sql`false`;
  return inArray(column, scope.battletags);
}

/**
 * Base conditions plus the scope condition, with `undefined` dropped, so
 * `and(...scopeConditions([...], scope, col))` is always well-typed.
 */
export function scopeConditions(
  base: (SQL | undefined)[],
  scope: Scope,
  column: AnyPgColumn,
): SQL[] {
  return [...base, scopeCondition(scope, column)].filter((c): c is SQL => c !== undefined);
}
