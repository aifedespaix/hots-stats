# Multi-Account Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a player account the *set* of BattleTags linked to it, scope every personal query by that set (or a selection inside it), and teach the daemon to discover and watch every local HotS account folder.

**Architecture:** A new `user_accounts` table (many-to-many, BattleTag keys) replaces `match_players.userId` as the personal-scope key. `users.battletag` survives as the *primary* account's mirror and keeps its uniqueness. A single `Scope` type flows from one Hono middleware (`?accounts=`) down into every service, whose personal filter becomes `match_players.battletag IN (...)`. The daemon globs `Accounts/*/*/Replays/*`, derives each folder's toon handle from its name, and sends `selfBattletag` with every replay so the API links the account automatically. The web picks the active account(s) in a persisted Pinia store injected into every fetch by the existing `useApiFetch` seam.

**Tech Stack:** TypeScript / Bun / Hono / Drizzle ORM / Zod / PostgreSQL (`apps/api`, `packages/db`, `packages/shared-types`), Nuxt 4 + Pinia + Vitest (`apps/web`), Python 3.11 + pytest + watchdog + heroprotocol (`daemon-python`).

**Spec:** `docs/superpowers/specs/2026-09-17-multi-account-support-design.md`

## Global Constraints

- **The scope key is BattleTag.** Every personal-scope SQL condition must go through `scopeCondition()` (Task 3). Never write a raw `eq(matchPlayers.userId, ...)` in a personal scope again.
- **`users.battletag` stays UNIQUE** and means "the primary account's BattleTag". Sharing a BattleTag is only ever possible through a *secondary* `user_accounts` row.
- **`match_players.userId` is informational only** after this change (admin diagnostics). Keep populating it; never filter personal scope on it.
- **Do NOT bump `MIN_PARSER_VERSION`** (`apps/api/src/constants.ts`) or `PARSER_VERSION` (`daemon-python/src/constants.py`). `selfBattletag` is not persisted; nothing needs reparsing.
- **`MAX_LINKED_ACCOUNTS = 20`** — caps both linked accounts and the `?accounts=` list.
- **French UI strings, English identifiers and code comments.**
- Test runners: `bun test apps/api` (`bun:test` — `apps/api/package.json` has **no** `test` script), `bun run --filter './apps/web' test` (vitest), `cd daemon-python && pytest -q`.
- **No destructive schema change.** Migration is additive; the backfill is idempotent.
- Do **not** send `accounts` to auth/token/health/admin/spatial/public routes (web side: `withAccounts: false`).

---

## Phase A — Database and shared contracts

### Task 1: `user_accounts` table + `match_players` BattleTag index + backfill

**Files:**
- Create: `packages/db/src/schema/user-accounts.ts`
- Modify: `packages/db/src/schema/index.ts` (add one `export *`)
- Modify: `packages/db/src/schema/match-players.ts`
- Create (generated + hand-edited): `packages/db/drizzle/0020_*.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `user_accounts` with columns `id, userId, battletag, toonHandle, label, isPrimary, source, lastSeenAt, createdAt`; exported types `UserAccount`, `NewUserAccount`; Drizzle table objects `userAccounts`, `userAccountSourceEnum`.

- [ ] **Step 1: Write the schema file**

```ts
// packages/db/src/schema/user-accounts.ts
import { sql } from "drizzle-orm";
import { boolean, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * How a BattleTag ended up linked to a site account.
 * - legacy:   backfilled from users.battletag by the 0020 migration.
 * - battlenet: auto-filled from the Battle.net OAuth profile.
 * - daemon:   declared by the daemon from a local replay file (trusted).
 * - manual:   typed by the player in Settings (unverified).
 */
export const userAccountSourceEnum = pgEnum("user_account_source", [
  "legacy",
  "battlenet",
  "daemon",
  "manual",
]);

/**
 * A player can own several BattleTags (main + smurfs), and a BattleTag can be
 * linked to several site accounts (shared/family account). Personal stats are
 * scoped by BattleTag set, so match_players.userId is informational only.
 */
export const userAccounts = pgTable(
  "user_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    battletag: text("battletag").notNull(),
    // Stable across a BattleTag rename: "2-Hero-1-4929240". Lets the daemon
    // update the tag in place instead of accumulating a second row.
    toonHandle: text("toon_handle"),
    label: text("label"),
    isPrimary: boolean("is_primary").notNull().default(false),
    source: userAccountSourceEnum("source").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userBattletagUnique: uniqueIndex("user_accounts_user_id_battletag_idx").on(
      table.userId,
      table.battletag,
    ),
    // Resolving "which accounts does this battletag belong to" (sharing).
    battletagIdx: index("user_accounts_battletag_idx").on(table.battletag),
    primaryUnique: uniqueIndex("user_accounts_primary_idx")
      .on(table.userId)
      .where(sql`${table.isPrimary}`),
  }),
);

export type UserAccount = typeof userAccounts.$inferSelect;
export type NewUserAccount = typeof userAccounts.$inferInsert;
```

- [ ] **Step 2: Export it from the schema barrel**

In `packages/db/src/schema/index.ts` add, next to the other `export *` lines:

```ts
export * from "./user-accounts";
```

- [ ] **Step 3: Add the btree index on `match_players.battletag`**

In `packages/db/src/schema/match-players.ts`, extend the table's index callback (the existing trigram GIN index cannot serve equality):

```ts
    // Personal scope is now `battletag IN (...)` -- the composite
    // (match_id, battletag) unique index cannot serve a bare battletag
    // lookup, and the trigram GIN index only serves ILIKE '%term%'.
    battletagIdx: index("match_players_battletag_idx").on(table.battletag),
```

- [ ] **Step 4: Generate the migration**

Run: `bun run --filter './packages/db' generate`
Expected: a new `packages/db/drizzle/00XX_*.sql` creating the enum, `user_accounts`, its three indexes and the new `match_players_battletag_idx`. **No `DROP` statement anywhere.**

- [ ] **Step 5: Append the backfill to the generated migration**

Append at the end of the generated `.sql` file:

```sql
--> statement-breakpoint
-- Backfill: every already-claimed users.battletag becomes that account's primary.
INSERT INTO "user_accounts" ("user_id", "battletag", "is_primary", "source")
SELECT "id", "battletag", true, 'legacy'
FROM "users"
WHERE "battletag" IS NOT NULL
ON CONFLICT DO NOTHING;
```

- [ ] **Step 6: Apply and verify**

Run: `bun run --filter './packages/db' migrate`
Then verify in psql/Drizzle Studio:
- `select count(*) from user_accounts where is_primary;` equals `select count(*) from users where battletag is not null;`
- re-running the same `INSERT` inserts 0 rows (idempotent).

- [ ] **Step 7: Typecheck and commit**

Run: `bun run typecheck`
Expected: PASS.

```bash
git add packages/db/src/schema/user-accounts.ts packages/db/src/schema/index.ts packages/db/src/schema/match-players.ts packages/db/drizzle
git commit -m "feat(db): user_accounts table, battletag index, legacy backfill"
```

---

### Task 2: Shared types for accounts and the ingest payload

**Files:**
- Create: `packages/shared-types/src/account.ts`
- Modify: `packages/shared-types/src/index.ts`
- Modify: `packages/shared-types/src/replay-payload.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PlayerAccount` interface, `userAccountSourceSchema`, `addAccountInputSchema`, `updateAccountInputSchema`; `ReplayPayload.selfBattletag?: string`.

- [ ] **Step 1: Write the account contract**

```ts
// packages/shared-types/src/account.ts
import { z } from "zod";

export const userAccountSourceSchema = z.enum(["legacy", "battlenet", "daemon", "manual"]);
export type UserAccountSource = z.infer<typeof userAccountSourceSchema>;

/** One BattleTag linked to a site account, as returned by GET /auth/me. */
export interface PlayerAccount {
  battletag: string;
  toonHandle: string | null;
  label: string | null;
  isPrimary: boolean;
  source: UserAccountSource;
  lastSeenAt: string | null;
  createdAt: string;
}

/** BattleTags are "Name#1234"; 3..64 leaves room for both parts on any locale. */
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

/** Cap on `?accounts=` lists and on linked accounts per user. */
export const MAX_LINKED_ACCOUNTS = 20;
```

- [ ] **Step 2: Export it**

In `packages/shared-types/src/index.ts` add:

```ts
export * from "./account";
```

- [ ] **Step 3: Add `selfBattletag` to the replay payload**

In `packages/shared-types/src/replay-payload.ts`, add to the `ReplayPayload` interface (next to `replayHash`):

```ts
  /**
   * The BattleTag of the player whose machine wrote this replay, derived by the
   * daemon from the HotS account folder name (the folder *is* the toon handle).
   * Undefined for older daemon builds and for replays whose folder toon handle
   * is not in the player list. Drives account auto-linking at ingest; never
   * stored on the match itself.
   */
  selfBattletag?: string;
```

If the payload schema is a Zod object, add `selfBattletag: z.string().optional()` there too — **make sure the field is not stripped**, otherwise the daemon's value never reaches `upsertReplay`.

- [ ] **Step 4: Verify the field survives parsing**

Run: `bun test apps/api`
Expected: existing tests still PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add packages/shared-types
git commit -m "feat(shared-types): PlayerAccount contract and ReplayPayload.selfBattletag"
```

---

### Task 3: `account-scope` library (scope resolution + SQL condition)

**Files:**
- Create: `apps/api/src/lib/account-scope.ts`
- Create: `apps/api/src/lib/account-scope.test.ts`

**Interfaces:**
- Consumes: `MAX_LINKED_ACCOUNTS` (Task 2), `userAccounts` + `users` tables (Task 1).
- Produces:
  - `type Scope = { mode: "personal"; battletags: string[] } | { mode: "global" }`
  - `class UnlinkedAccountError extends Error` with `readonly battletags: string[]`
  - `accountsQuerySchema`
  - `resolveScope(userId: string, requested?: string): Promise<Scope>`
  - `linkedBattletags(userId: string): Promise<string[]>`
  - `scopeCondition(scope: Scope, column?: AnyPgColumn): SQL | undefined`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/lib/account-scope.test.ts
import { describe, expect, test } from "bun:test";
import { MAX_LINKED_ACCOUNTS, UnlinkedAccountError, parseAccountSelection } from "./account-scope";

describe("parseAccountSelection", () => {
  test("absent param means 'all linked' (undefined)", () => {
    expect(parseAccountSelection(undefined)).toBeUndefined();
  });
  test("splits, trims and drops empty segments", () => {
    expect(parseAccountSelection(" A#1 , B#2 ,, ")).toEqual(["A#1", "B#2"]);
  });
  test("dedupes case-insensitively, keeping the first spelling seen", () => {
    expect(parseAccountSelection("Aife#21170,aife#21170")).toEqual(["Aife#21170"]);
  });
  test("rejects more than MAX_LINKED_ACCOUNTS entries", () => {
    const many = Array.from({ length: MAX_LINKED_ACCOUNTS + 1 }, (_, i) => `P${i}#1`).join(",");
    expect(() => parseAccountSelection(many)).toThrow(/trop de comptes/i);
  });
});

describe("intersectSelection", () => {
  test("keeps only linked tags, case-insensitively, in stored casing", () => {
    expect(intersectSelection(["AIFE#21170", "Inconnu#1"], ["aife#21170", "autre#2"])).toEqual({
      kept: ["aife#21170"],
      missing: ["Inconnu#1"],
    });
  });
});
```

Add the import for `intersectSelection` in the import list above.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/api/src/lib/account-scope.test.ts`
Expected: FAIL — `Cannot find module "./account-scope"` or the named exports missing.

- [ ] **Step 3: Implement the library**

```ts
// apps/api/src/lib/account-scope.ts
import { db, userAccounts, users } from "@hots-stats/db";
import { MAX_LINKED_ACCOUNTS } from "@hots-stats/shared-types";
import { type AnyPgColumn, inArray, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

/** `?accounts=A#1,B#2` -- omitted means "every account linked to the user". */
export const accountsQuerySchema = z.string().max(1500).optional();

export type Scope = { mode: "personal"; battletags: string[] } | { mode: "global" };

/** Raised when a requested BattleTag is not linked to the requesting account. */
export class UnlinkedAccountError extends Error {
  constructor(readonly battletags: string[]) {
    super(`Compte non lié : ${battletags.join(", ")}`);
    this.name = "UnlinkedAccountError";
  }
}

/** Splits the raw query value. Throws on an over-long list. */
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
  if (out.length > MAX_LINKED_ACCOUNTS) {
    throw new RangeError(`Trop de comptes demandés (max ${MAX_LINKED_ACCOUNTS})`);
  }
  return out.length > 0 ? out : undefined;
}

/** Splits `requested` into tags the user owns (stored casing) and tags they do not. */
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

/** Every BattleTag linked to a user, deduped and capped. */
export async function linkedBattletags(userId: string): Promise<string[]> {
  const rows = await db
    .select({ battletag: userAccounts.battletag })
    .from(userAccounts)
    .where(eq(userAccounts.userId, userId));
  const tags = rows.map((row) => row.battletag);
  if (tags.length > 0) return tags.slice(0, MAX_LINKED_ACCOUNTS);

  // Legacy window: the migration may not have run yet, or the user predates it.
  const [user] = await db.select({ battletag: users.battletag }).from(users).where(eq(users.id, userId)).limit(1);
  return user?.battletag ? [user.battletag] : [];
}

/**
 * Turns a request into a Scope. A requested tag the user does not own is a hard
 * error -- silently dropping it would make a typo read as "no games", and
 * accepting it would expose another player's stats.
 */
export async function resolveScope(userId: string, requested?: string): Promise<Scope> {
  let parsed: string[] | undefined;
  try {
    parsed = parseAccountSelection(requested);
  } catch (err) {
    throw new UnlinkedAccountError([err instanceof Error ? err.message : String(err)]);
  }
  const linked = await linkedBattletags(userId);
  if (parsed === undefined) return { mode: "personal", battletags: linked };
  const { kept, missing } = intersectSelection(parsed, linked);
  if (missing.length > 0) throw new UnlinkedAccountError(missing);
  return { mode: "personal", battletags: kept };
}

/**
 * SQL condition restricting a `match_players` reference to a scope. Returns
 * `undefined` for the global scope. Passing `column` targets an aliased
 * match_players (e.g. the `other` self-join).
 */
export function scopeCondition(scope: Scope, column?: AnyPgColumn): SQL | undefined {
  if (scope.mode === "global") return undefined;
  const target = column ?? matchPlayersBattletagColumn();
  if (scope.battletags.length === 0) return sql`false`;
  return inArray(target, scope.battletags);
}
```

The last helper needs the real `match_players` column. Add at the top of the file:

```ts
import { matchPlayers } from "@hots-stats/db";

/** Indirection so the column can be imported without a circular surprise. */
function matchPlayersBattletagColumn(): AnyPgColumn {
  return matchPlayers.battletag;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test apps/api/src/lib/account-scope.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/account-scope.ts apps/api/src/lib/account-scope.test.ts
git commit -m "feat(api): account scope resolution and SQL condition helper"
```

---

### Task 4: `player-accounts.service` (link / list / add / update / remove)

**Files:**
- Create: `apps/api/src/services/player-accounts.service.ts`

**Interfaces:**
- Consumes: `userAccounts`, `users`, `matchPlayers` (Task 1); `PlayerAccount`, `MAX_LINKED_ACCOUNTS` (Task 2); `linkedBattletags` (Task 3).
- Produces:
  - `listAccounts(userId: string): Promise<PlayerAccount[]>`
  - `linkSelfBattletag(userId: string, battletag: string, toonHandle?: string | null, source?: "daemon" | "battlenet" | "manual"): Promise<"linked" | "updated">`
  - `addAccount(userId: string, battletag: string, label?: string): Promise<PlayerAccount>`
  - `updateAccount(userId: string, battletag: string, input: { label?: string | null; isPrimary?: boolean }): Promise<PlayerAccount>`
  - `removeAccount(userId: string, battletag: string, promoteBattletag?: string): Promise<void>`
  - `class AccountLimitError extends Error`, `class PrimaryConflictError extends Error`, `class AccountNotFoundError extends Error`

- [ ] **Step 1: Implement the service**

Key rules (mirroring the spec §2.2):
- insert is `onConflictDoNothing` then re-select — never throws on an already-linked tag;
- a tag may be linked to **any number of other users** (decision: sharing allowed);
- `isPrimary` is only granted when the user has no primary **and** `users.battletag` is `NULL`;
  granting it also mirrors the tag into `users.battletag` in the same transaction;
- if the incoming `toonHandle` matches an existing row for this user, **rename that row's
  battletag** instead of inserting a second account (BattleTag rename);
- removing the primary requires `promoteBattletag` naming another linked account; removing the
  last account clears `is_primary` and `users.battletag`.

```ts
// apps/api/src/services/player-accounts.service.ts
import { db, userAccounts, users } from "@hots-stats/db";
import { MAX_LINKED_ACCOUNTS, type PlayerAccount, type UserAccountSource } from "@hots-stats/shared-types";
import { and, eq } from "drizzle-orm";

export class AccountLimitError extends Error {
  constructor() { super(`Maximum ${MAX_LINKED_ACCOUNTS} comptes liés`); this.name = "AccountLimitError"; }
}
export class PrimaryConflictError extends Error {
  constructor() { super("Ce BattleTag est déjà le compte principal d'un autre utilisateur"); this.name = "PrimaryConflictError"; }
}
export class AccountNotFoundError extends Error {
  constructor() { super("Compte introuvable"); this.name = "AccountNotFoundError"; }
}

function toPlayerAccount(row: {
  battletag: string; toonHandle: string | null; label: string | null;
  isPrimary: boolean; source: UserAccountSource;
  lastSeenAt: Date | null; createdAt: Date;
}): PlayerAccount {
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

export async function listAccounts(userId: string): Promise<PlayerAccount[]> {
  const rows = await db.select().from(userAccounts).where(eq(userAccounts.userId, userId));
  // Primary first, then oldest first -- stable order for the header switcher.
  return rows
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt.getTime() - b.createdAt.getTime())
    .map(toPlayerAccount);
}

export async function linkSelfBattletag(
  userId: string,
  battletag: string,
  toonHandle?: string | null,
  source: UserAccountSource = "daemon",
): Promise<"linked" | "updated"> {
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(userAccounts).where(eq(userAccounts.userId, userId));

    // A rename shows up as a known toon handle under a new BattleTag.
    if (toonHandle) {
      const renamed = existing.find((row) => row.toonHandle === toonHandle && row.battletag !== battletag);
      if (renamed) {
        await tx
          .update(userAccounts)
          .set({ battletag, lastSeenAt: new Date() })
          .where(eq(userAccounts.id, renamed.id));
        if (renamed.isPrimary) {
          await tx.update(users).set({ battletag, updatedAt: new Date() }).where(eq(users.id, userId));
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

    const [user] = await tx.select({ battletag: users.battletag }).from(users).where(eq(users.id, userId)).limit(1);
    const canBePrimary = existing.length === 0 && !user?.battletag;
    if (canBePrimary) {
      const [claim] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.battletag, battletag))
        .limit(1);
      if (claim && claim.id !== userId) throw new PrimaryConflictError();
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

export async function addAccount(userId: string, battletag: string, label?: string): Promise<PlayerAccount> {
  await linkSelfBattletag(userId, battletag, null, "manual");
  if (label) await updateAccount(userId, battletag, { label });
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

    if (input.isPrimary === true && !row.isPrimary) {
      const [claim] = await tx.select({ id: users.id }).from(users).where(eq(users.battletag, battletag)).limit(1);
      if (claim && claim.id !== userId) throw new PrimaryConflictError();
      await tx.update(userAccounts).set({ isPrimary: false }).where(eq(userAccounts.userId, userId));
      await tx.update(userAccounts).set({ isPrimary: true }).where(eq(userAccounts.id, row.id));
      await tx.update(users).set({ battletag, updatedAt: new Date() }).where(eq(users.id, userId));
    }
    if (input.label !== undefined) {
      await tx.update(userAccounts).set({ label: input.label }).where(eq(userAccounts.id, row.id));
    }

    const [updated] = await tx.select().from(userAccounts).where(eq(userAccounts.id, row.id)).limit(1);
    return toPlayerAccount(updated!);
  });
}

export async function removeAccount(userId: string, battletag: string, promoteBattletag?: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(userAccounts).where(eq(userAccounts.userId, userId));
    const target = rows.find((row) => row.battletag === battletag);
    if (!target) throw new AccountNotFoundError();

    const remaining = rows.filter((row) => row.id !== target.id);

    if (target.isPrimary && remaining.length > 0) {
      const promote = remaining.find((row) => row.battletag === promoteBattletag);
      if (!promote) throw new PrimaryConflictError();
      const [claim] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.battletag, promote.battletag))
        .limit(1);
      if (claim && claim.id !== userId) throw new PrimaryConflictError();
      await tx.update(userAccounts).set({ isPrimary: true }).where(eq(userAccounts.id, promote.id));
      await tx.update(users).set({ battletag: promote.battletag, updatedAt: new Date() }).where(eq(users.id, userId));
    } else if (target.isPrimary && remaining.length === 0) {
      await tx.update(users).set({ battletag: null, updatedAt: new Date() }).where(eq(users.id, userId));
    }

    await tx.delete(userAccounts).where(eq(userAccounts.id, target.id));
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run --filter './apps/api' typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/player-accounts.service.ts
git commit -m "feat(api): player accounts service (link/list/add/update/remove)"
```

---

## Phase B — API surface

### Task 5: `accountScope` middleware + account CRUD routes

**Files:**
- Create: `apps/api/src/middleware/account-scope.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/services/account-linking.service.ts`

**Interfaces:**
- Consumes: `resolveScope`, `UnlinkedAccountError` (Task 3); `listAccounts`, `addAccount`, `updateAccount`, `removeAccount` (Task 4).
- Produces: `accountScope` Hono middleware setting `c.set("scope", Scope)`; `toPublicUser` gains `accounts` and `primaryBattletag`.

- [ ] **Step 1: Write the middleware**

```ts
// apps/api/src/middleware/account-scope.ts
import type { User } from "@hots-stats/db";
import { createMiddleware } from "hono/factory";
import { UnlinkedAccountError, type Scope, resolveScope } from "../lib/account-scope";

type Env = { Variables: { user: User; scope: Scope } };

/**
 * Resolves ?accounts= once per request and exposes it as c.get("scope").
 * Mount after authSession/requireUser and before the handler.
 */
export const accountScope = createMiddleware<Env>(async (c, next) => {
  const user = c.get("user");
  try {
    c.set("scope", await resolveScope(user.id, c.req.query("accounts")));
  } catch (err) {
    if (err instanceof UnlinkedAccountError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }
  await next();
});
```

- [ ] **Step 2: Extend the public user payload**

In `apps/api/src/routes/auth.ts`, `toPublicUser` is synchronous and used in several places. Add a second async helper instead of making it async:

```ts
async function withAccounts(user: User) {
  const accounts = await listAccounts(user.id);
  return {
    ...toPublicUser(user),
    accounts,
    primaryBattletag: accounts.find((account) => account.isPrimary)?.battletag ?? user.battletag,
  };
}
```

and use `withAccounts` for `GET /auth/me`, `GET /auth/verify-token` and every `PATCH /auth/me` response. Leave `toPublicUser` itself untouched so nothing else breaks.

- [ ] **Step 3: Add the CRUD routes**

In `apps/api/src/routes/auth.ts`, before the `PATCH /me` route:

```ts
  .get("/me/accounts", authSession, requireUser, async (c) => {
    return c.json({ accounts: await listAccounts(c.get("user").id) });
  })
  .post("/me/accounts", authSession, requireUser, async (c) => {
    const parsed = addAccountInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    try {
      const account = await addAccount(c.get("user").id, parsed.data.battletag, parsed.data.label);
      return c.json({ account }, 201);
    } catch (err) {
      if (err instanceof AccountLimitError || err instanceof PrimaryConflictError) {
        return c.json({ error: err.message }, 409);
      }
      throw err;
    }
  })
  .patch("/me/accounts/:battletag", authSession, requireUser, async (c) => {
    const parsed = updateAccountInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    try {
      const account = await updateAccount(c.get("user").id, c.req.param("battletag"), parsed.data);
      return c.json({ account });
    } catch (err) {
      if (err instanceof PrimaryConflictError) return c.json({ error: err.message }, 409);
      if (err instanceof AccountNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  })
  .delete("/me/accounts/:battletag", authSession, requireUser, async (c) => {
    try {
      await removeAccount(c.get("user").id, c.req.param("battletag"), c.req.query("promote"));
      return c.json({ status: "ok" });
    } catch (err) {
      if (err instanceof PrimaryConflictError) return c.json({ error: err.message }, 409);
      if (err instanceof AccountNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  })
```

Import `addAccountInputSchema`, `updateAccountInputSchema` from shared-types and the service functions/errors from `../services/player-accounts.service`.

- [ ] **Step 4: Keep `PATCH /me` consistent with the primary rule**

In the existing `PATCH /me` handler the `battletag` conflict check stays (`users.battletag` is still unique), but the message must be honest about what it now means:

```ts
return c.json({ error: "Ce BattleTag est déjà le compte principal d'un autre utilisateur" }, 409);
```

After a successful update, mirror the tag into `user_accounts` so the two never drift:

```ts
    if (updated && parsed.data.battletag) {
      await linkSelfBattletag(user.id, parsed.data.battletag, null, "manual");
      await linkUnclaimedMatchPlayers(user.id, parsed.data.battletag);
    }
```

- [ ] **Step 5: Exclude already-linked tags from the suggestion**

In `apps/api/src/services/account-linking.service.ts`, `suggestBattletag` must not propose a tag the user already has. Import `userAccounts` and amend the final `universal` filter:

```ts
  const alreadyLinked = new Set(
    (await db.select({ battletag: userAccounts.battletag }).from(userAccounts).where(eq(userAccounts.userId, userId)))
      .map((row) => row.battletag.toLowerCase()),
  );
  const universal = rows.filter(
    (row) => row.matchCount === total && !alreadyLinked.has(row.battletag.toLowerCase()),
  );
```

- [ ] **Step 6: Detect a BattleTag that already shares matches (double-count guard)**

Personal scope is a set of *player rows*, so linking a tag that appears in the same matches
as an already-linked account makes those matches contribute two rows. Surface that at link
time instead of silently inflating the numbers.

In `player-accounts.service.ts`:

```ts
/**
 * True when `battletag` already appears in a match that also contains one of
 * the user's linked accounts. Linking it would double-count those matches in
 * every merged stat -- see the design doc's "double counting" note.
 */
export async function accountOverlapsExisting(userId: string, battletag: string): Promise<boolean> {
  const mine = await linkedBattletags(userId);
  if (mine.length === 0) return false;
  const mineRows = alias(matchPlayers, "mine");
  const target = alias(matchPlayers, "target");
  const [row] = await db
    .select({ one: sql<number>"1" })
    .from(target)
    .innerJoin(mineRows, eq(mineRows.matchId, target.matchId))
    .where(and(eq(target.battletag, battletag), inArray(mineRows.battletag, mine)))
    .limit(1);
  return row !== undefined;
}
```

In `auth.ts`, next to the other account routes:

```ts
  .get("/me/accounts/overlap", authSession, requireUser, async (c) => {
    const battletag = c.req.query("battletag") ?? "";
    if (!battletag) return c.json({ error: "battletag requis" }, 400);
    return c.json({ overlaps: await accountOverlapsExisting(c.get("user").id, battletag) });
  })
```

Then renumber the current Step 6 to **Step 7**.

- [ ] **Step 7: Typecheck and commit**

Run: `bun run --filter './apps/api' typecheck`
Expected: PASS.

```bash
git add apps/api/src/middleware/account-scope.ts apps/api/src/routes/auth.ts apps/api/src/services/account-linking.service.ts
git commit -m "feat(api): account CRUD routes and scope middleware"
```

---

### Task 6: Ingest auto-linking

**Files:**
- Modify: `apps/api/src/routes/ingest.ts`
- Modify: `apps/api/src/services/replay-ingest.service.ts`
- Modify: `apps/api/src/adapters/default-adapter.ts` (only if it whitelists payload fields)

**Interfaces:**
- Consumes: `linkSelfBattletag` (Task 4), `resolveScope` (Task 3).
- Produces: ingest links `payload.selfBattletag` to the token's user; `GET /ingest/accounts`; `GET /ingest/summary` scoped on all linked accounts.

- [ ] **Step 1: Thread `selfBattletag` through the ingest service**

`ingestReplayPayload(record, userId)` adapts then delegates to `upsertReplay(parsed, userId)`. The adapter must preserve `selfBattletag` (Task 2). In `replay-ingest.service.ts`, right before `upsertReplay`:

```ts
  const selfBattletag = typeof record.selfBattletag === "string" ? record.selfBattletag : undefined;
  if (selfBattletag) {
    // Best-effort: a linking failure must never fail the replay upload.
    try {
      await linkSelfBattletag(userId, selfBattletag, null, "daemon");
    } catch (err) {
      console.warn("Could not auto-link self battletag %s: %s", selfBattletag, err);
    }
  }
```

Check `apps/api/src/adapters/default-adapter.ts`: if it rebuilds the payload field-by-field rather than passing it through, copy `selfBattletag` onto the normalized `ParsedReplayData`.

- [ ] **Step 2: Add `GET /ingest/accounts` and rescope `/ingest/summary`**

In `apps/api/src/routes/ingest.ts`:

```ts
  .get("/accounts", async (c) => {
    // Lets the daemon's settings window show the accounts linked to its token.
    return c.json({ accounts: await listAccounts(c.get("user").id) });
  })
  .get("/summary", async (c) => {
    const user = c.get("user");
    return c.json(await getStatsSummary(await resolveScope(user.id), undefined));
  })
```

`getStatsSummary`'s new signature is defined in Task 7 — do that change first if you run these out of order.

- [ ] **Step 3: Verify with curl**

```bash
curl -s localhost:3001/ingest/accounts -H "Authorization: Bearer $PAT" | jq
```

Expected: the linked accounts, including anything auto-linked by a recent ingest.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/ingest.ts apps/api/src/services/replay-ingest.service.ts apps/api/src/adapters
git commit -m "feat(api): auto-link the daemon selfBattletag at ingest"
```

---

### Task 7: Repoint every personal-scope query from `userId` to the scope

The wide, mechanical task. Do it service by service, running `bun run --filter './apps/api' typecheck` after each file.

**Files (all modify):**
`apps/api/src/services/{stats,talents,maps,players,weaknesses,hero-matchups,face-a-face,talent-analyzer}.service.ts`,
`apps/api/src/routes/{stats,heroes,maps,matches,players,talents,weaknesses,draft,compare,friends}.ts`.

**Interfaces:**
- Consumes: `Scope`, `scopeCondition`, `linkedBattletags` (Task 3).
- Produces: every service that took `(userId, ..., scope: HeroStatsScope)` now takes `(scope: Scope, ...)`.

- [ ] **Step 1: Add one helper to `account-scope.ts`**

The array-literal form is where this refactor goes wrong, so centralise it:

```ts
/** Base conditions plus the scope condition, with undefined dropped. */
export function scopeConditions(base: (SQL | undefined)[], scope: Scope): SQL[] {
  return [...base, scopeCondition(scope)].filter((c): c is SQL => c !== undefined);
}
```

**The replacement rule, once and for all:**

```ts
// BEFORE
const conditions = scope === "personal" ? [eq(matchPlayers.userId, userId)] : [];
// AFTER
const conditions = scopeConditions([], scope);
```

and for the sites that are unconditionally personal:

```ts
// BEFORE
.where(and(eq(matchPlayers.userId, userId), rankedModeCondition()))
// AFTER
.where(and(...scopeConditions([rankedModeCondition()], scope)))
```

An empty selection becomes `sql```false```, which is correct: it matches nothing rather than everything.

- [ ] **Step 2: `services/stats.service.ts` + `services/talents.service.ts`**

| File | Site | Change |
|---|---|---|
| `stats.service.ts` | `getStatsSummary` (l.12-17) | `(scope: Scope, mode?: GameMode[])`; conditions = `scopeConditions([], scope)` |
| `talents.service.ts` | `getHeroSummaries` (l.40) | `(scope: Scope, mode?)` |
| `talents.service.ts` | `getTalentTierStats` (l.99) | `(scope: Scope, heroId, mode?)` |

Run `bun run --filter './apps/api' typecheck`, then commit.

- [ ] **Step 3: `services/maps.service.ts` + `services/weaknesses.service.ts`**

| File | Sites | Change |
|---|---|---|
| `maps.service.ts` | l.50, 97, 193, 335, 398 | replace the personal condition with `...scopeConditions([], scope)` |
| `maps.service.ts` | l.271 | the `if (userId)` branch disappears — global simply contributes no condition |
| `weaknesses.service.ts` | l.41, 69, 112, 122 | same replacement |

- [ ] **Step 4: `services/hero-matchups.service.ts` + `services/talent-analyzer.service.ts`**

`hero-matchups.service.ts` l.45-46: `(scope: Scope, heroId, mode?)`, condition `if (scope.mode === "personal")` → `scopeConditions`.

`talent-analyzer.service.ts` l.34-38: replace `params.userId` + `params.scope: HeroStatsScope` with a single `params.scope: Scope`; the condition becomes `scopeConditions([...], params.scope)`.

- [ ] **Step 5: `services/face-a-face.service.ts`**

```ts
export type FaceAFaceTarget = { battletags: string[] } | { battletag: string };

function targetCondition(target: FaceAFaceTarget, mode?: GameMode[]) {
  const base =
    "battletags" in target
      ? target.battletags.length > 0
        ? inArray(matchPlayers.battletag, target.battletags)
        : sql`false`
      : eq(matchPlayers.battletag, target.battletag);
  return mode && mode.length > 0 ? and(base, inArray(matches.gameMode, mode)) : base;
}
```

Every caller that used `{ userId }` (the "me" side) passes `{ battletags: scope.battletags }`.

- [ ] **Step 6: `routes/matches.ts`**

`buildMatchConditions(userId, filters)` (l.101-107) → `buildMatchConditions(scope: Scope, filters)`. Then l.228, 235, 241, 275, 418 each become `.where(and(...scopeConditions([], scope)))` (adding back any extra condition they already had).

- [ ] **Step 7: `routes/friends.ts`**

Line 144 views the **friend's** matches, not the viewer's selection:

```ts
    const friendTags = await linkedBattletags(friendId);
    const conditions = [friendTags.length > 0 ? inArray(matchPlayers.battletag, friendTags) : sql`false`];
```

- [ ] **Step 8: Wire the middleware into every route group**

For `stats, heroes, maps, matches, players, talents, weaknesses, draft, compare, friends`:

```ts
type Env = { Variables: { user: User; scope: Scope } };
// ...
.use("*", authSession, requireUser, accountScope)
```

Replace direct service arguments with `c.get("scope")`. Routes that also need the viewer id (`players.ts`) keep `c.get("user").id` for `resolveAccountLinks`/`getFriendshipStatuses`.

- [ ] **Step 9: `routes/players.ts` — a friend's own stats**

```ts
  const friendScope: Scope = { mode: "personal", battletags: await linkedBattletags(encounter.accountUserId) };
  const [summary, heroes] = await Promise.all([
    getStatsSummary(friendScope, mode),
    getHeroSummaries(friendScope, mode),
  ]);
```

- [ ] **Step 10: Ban the old pattern**

Run: `grep -rn "matchPlayers.userId" apps/api/src`
Expected: only `uploads-diagnostics.service.ts` and `replay-upsert.service.ts` (which writes the column).

- [ ] **Step 11: Typecheck, test, commit**

```bash
bun run typecheck && bun test apps/api
git add apps/api/src
git commit -m "refactor(api): scope every personal query by battletag set"
```

---

### Task 8: Never list your own accounts as encountered players

**Files:**
- Modify: `apps/api/src/services/players.service.ts`
- Modify: `apps/api/src/services/face-a-face.service.ts`

**Interfaces:**
- Consumes: `Scope`, `linkedBattletags` (Task 3).
- Produces: the `other` alias always excludes the whole scope; `resolveAccountLinks` marks `self` for any linked account.

- [ ] **Step 1: Exclude the scope from the `other` join**

`ne(other.battletag, matchPlayers.battletag)` only removes the *same* tag; with a smurf linked, the main account would "encounter" the smurf in every merged game:

```ts
  const otherExcluded = scope.battletags.length > 0 ? scope.battletags : [""];
  const conditions = [
    ...scopeConditions([], scope),
    notInArray(other.battletag, otherExcluded),
  ];
```

Apply the same `notInArray(other.battletag, otherExcluded)` to `getPlayerHeroBreakdown`, `getOpponentHeroBreakdown` and `getPlayerMapBreakdown`, and to the opponent side in `face-a-face.service.ts`.

- [ ] **Step 2: Mark every linked account as `self``

`resolveAccountLinks` looks up `users.battletag`, which (a) misses a shared tag whose owner has no `users.battletag` row and (b) assumes one owner. Join on `user_accounts` instead:

```ts
  const rows = await db
    .select({ userId: userAccounts.userId, battletag: userAccounts.battletag, isPrimary: userAccounts.isPrimary })
    .from(userAccounts)
    .where(inArray(userAccounts.battletag, battletags));
  const viewerTags = new Set((await linkedBattletags(userId)).map((tag) => tag.toLowerCase()));
```

Then per battletag: `friendshipStatus: viewerTags.has(tag.toLowerCase()) ? "self" : ...`, and pick `accountUserId` from the primary row first, else the first row. A `self` match must never fall through to a friend status.

- [ ] **Step 3: Draft audience must reach every linked account**

`apps/api/src/services/draft.service.ts` l.233-238 resolves the users to notify with
`inArray(users.battletag, candidateBattletags)`. A BattleTag linked through `user_accounts`
would miss its owner (and a shared tag would only ever reach the one account that owns
`users.battletag`). Replace the lookup:

```ts
  const matchedUsers =
    candidateBattletags.length > 0
      ? await db
          .selectDistinct({ id: userAccounts.userId })
          .from(userAccounts)
          .where(inArray(userAccounts.battletag, candidateBattletags))
      : [];
```

The `audience` line below it stays unchanged.

- [ ] **Step 4: Typecheck, test, commit**

```bash
bun run typecheck && bun test apps/api
git add apps/api/src/services/players.service.ts apps/api/src/services/face-a-face.service.ts
git commit -m "fix(api): exclude own linked accounts from encounter lists"
```

---

## Phase C — Web

### Task 9: `useAccountsStore`

**Files:**
- Create: `apps/web/app/stores/useAccountsStore.ts`
- Create: `apps/web/app/stores/useAccountsStore.test.ts`

**Interfaces:**
- Consumes: `PlayerAccount` (Task 2), `/auth/me`'s `accounts`/`primaryBattletag` (Task 5).
- Produces: `useAccountsStore()` with `selected: string[] | null`, `effectiveAccounts(available, primary)`, `accountsQueryParam(available, primary)`, `toggle`, `selectOnly`, `setSelection`, `reset`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/stores/useAccountsStore.test.ts
import { beforeEach, describe, expect, test } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAccountsStore } from "./useAccountsStore";

const available = ["aife#21170", "JeanPichet#2126"];

beforeEach(() => setActivePinia(createPinia()));

describe("useAccountsStore", () => {
  test("defaults to the primary account only", () => {
    const store = useAccountsStore();
    expect(store.effectiveAccounts(available, "aife#21170")).toEqual(["aife#21170"]);
  });
  test("toggling a second account merges it", () => {
    const store = useAccountsStore();
    store.toggle("JeanPichet#2126", available, "aife#21170");
    expect(store.effectiveAccounts(available, "aife#21170")).toEqual(["aife#21170", "JeanPichet#2126"]);
  });
  test("never empties the selection", () => {
    const store = useAccountsStore();
    store.toggle("aife#21170", available, "aife#21170");
    expect(store.effectiveAccounts(available, "aife#21170")).toEqual(["aife#21170"]);
  });
  test("a saved tag that is no longer linked falls back to the primary", () => {
    const store = useAccountsStore();
    store.selectOnly("JeanPichet#2126");
    expect(store.effectiveAccounts(["aife#21170"], "aife#21170")).toEqual(["aife#21170"]);
  });
  test("query param is comma-joined and URL-safe", () => {
    const store = useAccountsStore();
    store.setSelection(available);
    expect(store.accountsQueryParam(available, "aife#21170")).toBe(
      encodeURIComponent("aife#21170") + "," + encodeURIComponent("JeanPichet#2126"),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run --filter './apps/web' test useAccountsStore`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

```ts
// apps/web/app/stores/useAccountsStore.ts
import { defineStore } from "pinia";

/**
 * Which linked accounts the current view is computed from. Client-only
 * preference, persisted to localStorage exactly like the game-mode filter
 * (see useGameModeStore). null means "not chosen yet" -> the primary account
 * is used, matching the server's own default.
 */
export const useAccountsStore = defineStore("accounts", {
  state: (): { selected: string[] | null } => ({ selected: null }),
  actions: {
    /** The tags actually sent to the API: the saved selection intersected with
     *  what is still linked, or [primary] when that intersection is empty. */
    effectiveAccounts(available: string[], primary: string | null): string[] {
      const linked = new Set(available);
      const kept = (this.selected ?? []).filter((tag) => linked.has(tag));
      if (kept.length > 0) return kept;
      return primary ? [primary] : [];
    },
    accountsQueryParam(available: string[], primary: string | null): string | undefined {
      const tags = this.effectiveAccounts(available, primary);
      if (tags.length === 0) return undefined;
      // BattleTags contain '#' -- encode each and join, so the API's
      // split(",") sees exactly what we meant.
      return tags.map((tag) => encodeURIComponent(tag)).join(",");
    },
    setSelection(tags: string[]) {
      this.selected = [...tags];
    },
    selectOnly(tag: string) {
      this.selected = [tag];
    },
    toggle(tag: string, available: string[], primary: string | null) {
      const current = this.effectiveAccounts(available, primary);
      if (current.includes(tag)) {
        if (current.length === 1) return; // at least one account must stay selected
        this.selected = current.filter((t) => t !== tag);
      } else {
        this.selected = [...current, tag];
      }
    },
    reset() {
      this.selected = null;
    },
  },
  persist: { key: "hots-stats:accounts", pick: ["selected"] },
});
```

- [ ] **Step 4: Run the tests**

Run: `bun run --filter './apps/web' test useAccountsStore`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/stores/useAccountsStore.ts apps/web/app/stores/useAccountsStore.test.ts
git commit -m "feat(web): accounts selection store"
```

---

### Task 10: Inject `accounts` into every stats fetch

**Files:**
- Modify: `apps/web/app/composables/useApiFetch.ts`
- Modify: `apps/web/app/composables/useAuth.ts`
- Create: `apps/web/app/composables/useApiFetch.test.ts`

**Interfaces:**
- Consumes: `useAccountsStore` (Task 9), `useAuthUser` (existing).
- Produces: `useApiFetch(url, { withAccounts?: boolean })`; `buildApiQuery({ base, mode, accounts })`; `useAuthUser()` exposing `accounts` + `primaryBattletag`.

- [ ] **Step 1: Extend the auth user type**

Read `apps/web/app/composables/useAuth.ts` and add `accounts: PlayerAccount[]` and `primaryBattletag: string | null` to the user interface it returns.

- [ ] **Step 2: Rewrite the composable**

```ts
// apps/web/app/composables/useApiFetch.ts
type ApiFetchOptions = {
  query?: Record<string, unknown> | ComputedRef<Record<string, unknown>>;
  /**
   * Every stats-bearing endpoint must be scoped by the global game-mode
   * filter. Set to false only for routes that are not mode-dependent.
   */
  withGameMode?: boolean;
  /**
   * Every *personal* endpoint must be scoped by the active account selection.
   * Set to false for auth, tokens, annotations, admin and spatial calibration.
   */
  withAccounts?: boolean;
};

/**
 * Pure helper so the query assembly is unit-testable without a Nuxt runtime.
 * `accounts` is spread first: a caller's own query still wins.
 */
export function buildApiQuery(input: {
  base: Record<string, unknown>;
  mode?: string;
  accounts?: string;
}): Record<string, unknown> {
  return {
    ...(input.accounts ? { accounts: input.accounts } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...input.base,
  };
}

export function useApiFetch<T>(url: string, opts: ApiFetchOptions = {}) {
  const config = useRuntimeConfig();
  const headers = import.meta.server ? useRequestHeaders(["cookie"]) : undefined;
  const withGameMode = opts.withGameMode ?? true;
  const withAccounts = opts.withAccounts ?? true;
  const gameModeStore = withGameMode ? useGameModeStore() : undefined;
  const accountsStore = withAccounts ? useAccountsStore() : undefined;
  const { data: authData } = useAuthUser();

  const query = computed(() =>
    buildApiQuery({
      base: unref(opts.query) ?? {},
      mode: gameModeStore?.modeQueryParam,
      accounts: accountsStore
        ? accountsStore.accountsQueryParam(
            (authData.value?.user?.accounts ?? []).map((account) => account.battletag),
            authData.value?.user?.primaryBattletag ?? authData.value?.user?.battletag ?? null,
          )
        : undefined,
    }),
  );

  return useFetch<T>(url, {
    baseURL: config.public.apiBase,
    credentials: "include",
    headers,
    query,
  });
}
```

- [ ] **Step 3: Add `withAccounts: false` where required**

Search: `apps/web/app/composables/useTokens.ts`, the annotation calls in `apps/web/app/stores/usePlayerAnnotationsStore.ts`, admin pages, spatial calibration composables. Rule: any endpoint listed under "must not carry accounts" in the spec gets `withAccounts: false`.

- [ ] **Step 4: Write the test**

```ts
// apps/web/app/composables/useApiFetch.test.ts
import { describe, expect, test } from "vitest";
import { buildApiQuery } from "./useApiFetch";

describe("buildApiQuery", () => {
  test("omits accounts when undefined, keeps mode", () => {
    expect(buildApiQuery({ base: { page: 1 }, mode: "QuickMatch", accounts: undefined })).toEqual({
      mode: "QuickMatch",
      page: 1,
    });
  });
  test("includes accounts and lets base override", () => {
    expect(buildApiQuery({ base: { accounts: "explicit" }, mode: "QuickMatch", accounts: "A%231" })).toEqual({
      accounts: "explicit",
      mode: "QuickMatch",
    });
  });
  test("omits mode when undefined", () => {
    expect(buildApiQuery({ base: {}, accounts: "A%231" })).toEqual({ accounts: "A%231" });
  });
});
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun run --filter './apps/web' test && bun run --filter './apps/web' typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/composables
git commit -m "feat(web): inject the active account selection into every stats fetch"
```

---

### Task 11: Header account switcher

**Files:**
- Create: `apps/web/app/components/ui/AccountSwitcher.vue`
- Modify: `apps/web/app/layouts/default.vue`

**Interfaces:**
- Consumes: `useAccountsStore` (Task 9), `useAuthUser` (Task 10).
- Produces: the header control driving the selection.

- [ ] **Step 1: Write the component**

```vue
<script setup lang="ts">
const { data: authData } = await useAuthUser();
const accountsStore = useAccountsStore();

const available = computed(() => (authData.value?.user?.accounts ?? []).map((account) => account.battletag));
const primary = computed(
  () => authData.value?.user?.primaryBattletag ?? authData.value?.user?.battletag ?? null,
);
const effective = computed(() => accountsStore.effectiveAccounts(available.value, primary.value));
const label = computed(() => {
  if (effective.value.length === 0) return "Aucun compte";
  if (effective.value.length === available.value.length) return "Tous les comptes";
  if (effective.value.length === 1) return effective.value[0]!;
  return effective.value[0] + " +" + (effective.value.length - 1);
});

function toggle(tag: string) {
  accountsStore.toggle(tag, available.value, primary.value);
}
function selectAll() {
  accountsStore.setSelection(available.value);
}

// Same stale-hydration issue as UiGameModeFilter: the persisted selection is
// restored during hydration, before this subtree renders.
const renderKey = ref(0);
onMounted(() => {
  renderKey.value++;
});
</script>

<template>
  <div v-if="available.length > 1" :key="renderKey" class="flex items-center gap-1.5">
    <UDropdownMenu
      :items="[
        [
          {
            label: 'Tous les comptes',
            type: 'checkbox',
            checked: effective.length === available.length,
            onSelect: selectAll,
          },
        ],
        available.map((tag) => ({
          label: tag,
          type: 'checkbox',
          checked: effective.includes(tag),
          suffix: tag === primary ? '(principal)' : undefined,
          onSelect: () => toggle(tag),
        })),
      ]"
    >
      <UButton
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-heroicons-user-circle"
        :label="label"
        class="max-w-[10rem] truncate"
      />
    </UDropdownMenu>
  </div>
</template>
```

- [ ] **Step 2: Mount it in the header**

In `apps/web/app/layouts/default.vue`, inside the header's right-hand cluster, above the settings link:

```vue
        <div class="hidden sm:block">
          <UiAccountSwitcher />
        </div>
```

- [ ] **Step 3: Verify in the browser**

Run: `bun run dev`
Expected: with two linked accounts the switcher appears; unchecking one changes the dashboard numbers; the choice survives a reload.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/ui/AccountSwitcher.vue apps/web/app/layouts/default.vue
git commit -m "feat(web): header account switcher"
```

---

### Task 12: Settings — linked accounts section

**Files:**
- Modify: `apps/web/app/pages/settings/index.vue`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /auth/me/accounts` (Task 5), `useAuthUser` (Task 10).
- Produces: the "Comptes liés" UI (list, add, label, primary, unlink).

- [ ] **Step 1: Replace the single BattleTag section**

The existing "BattleTag" section (`settings/index.vue` l.162-171) becomes "Comptes liés". Keep the existing primary editor as the first row's inline edit, and add below it:

```vue
    <section class="space-y-4 rounded-lg border border-border p-4 sm:p-6">
      <h2 class="font-heading text-lg">Comptes liés</h2>
      <p class="text-sm text-muted">
        Tous les BattleTags dont les parties t'appartiennent. Coche-les dans l'en-tête pour
        choisir ce que le tableau de bord affiche (tu peux en fusionner plusieurs).
      </p>

      <ul class="space-y-2">
        <li
          v-for="account in accounts"
          :key="account.battletag"
          class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
        >
          <div class="min-w-0">
            <p class="truncate font-mono text-sm">{{ account.battletag }}</p>
            <p class="text-xs text-muted">
              {{ account.isPrimary ? "Compte principal" : "Compte secondaire" }}
              · {{ account.source === "daemon" ? "vérifié par le démon" : "non vérifié" }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              v-if="!account.isPrimary"
              size="xs"
              variant="soft"
              color="neutral"
              :loading="busy === account.battletag"
              @click="makePrimary(account.battletag)"
            >
              Définir principal
            </UButton>
            <UButton
              size="xs"
              variant="soft"
              color="error"
              :loading="busy === account.battletag"
              @click="unlink(account.battletag)"
            >
              Délier
            </UButton>
          </div>
        </li>
      </ul>

      <div class="flex flex-col gap-2 sm:flex-row">
        <UInput v-model="newBattletag" placeholder="Autre compte : Pseudo#12345" class="flex-1 font-mono" />
        <UButton :loading="adding" icon="i-heroicons-plus" block class="sm:w-auto" @click="addAccount">
          Lier
        </UButton>
      </div>
      <p v-if="accountsError" class="text-sm text-danger">{{ accountsError }}</p>
      <p v-if="suggestion" class="text-sm text-muted">
        Compte détecté dans tes parties : {{ suggestion }}
        <UButton size="xs" variant="link" @click="linkSuggestion">Lier</UButton>
      </p>
    </section>
```

- [ ] **Step 2: Wire the actions**

```ts
const accounts = computed(() => authData.value?.user?.accounts ?? []);
const newBattletag = ref("");
const adding = ref(false);
const busy = ref<string | null>(null);
const accountsError = ref("");
const suggestion = ref<string | null>(null);

async function addAccount() {
  const battletag = newBattletag.value.trim();
  if (!battletag) return;
  adding.value = true;
  accountsError.value = "";
  try {
    await $fetch("/auth/me/accounts", {
      method: "POST",
      baseURL: config.public.apiBase,
      credentials: "include",
      body: { battletag },
    });
    newBattletag.value = "";
    await refreshAuth();
  } catch (err) {
    accountsError.value = (err as { data?: { error?: string } })?.data?.error ?? "Liaison impossible";
  } finally {
    adding.value = false;
  }
}

async function makePrimary(battletag: string) {
  busy.value = battletag;
  accountsError.value = "";
  try {
    await $fetch("/auth/me/accounts/" + encodeURIComponent(battletag), {
      method: "PATCH",
      baseURL: config.public.apiBase,
      credentials: "include",
      body: { isPrimary: true },
    });
    await refreshAuth();
  } catch (err) {
    accountsError.value = (err as { data?: { error?: string } })?.data?.error ?? "Changement impossible";
  } finally {
    busy.value = null;
  }
}

async function unlink(battletag: string) {
  const primary = accounts.value.find((a) => a.isPrimary)?.battletag ?? null;
  const remaining = accounts.value.filter((a) => a.battletag !== battletag);
  const promote = primary === battletag ? remaining[0]?.battletag : undefined;
  if (primary === battletag && !promote) return; // never unlink the last account
  busy.value = battletag;
  accountsError.value = "";
  try {
    const suffix = promote ? "?promote=" + encodeURIComponent(promote) : "";
    await $fetch("/auth/me/accounts/" + encodeURIComponent(battletag) + suffix, {
      method: "DELETE",
      baseURL: config.public.apiBase,
      credentials: "include",
    });
    await refreshAuth();
    accountsStore.reset();
  } catch (err) {
    accountsError.value = (err as { data?: { error?: string } })?.data?.error ?? "Suppression impossible";
  } finally {
    busy.value = null;
  }
}

async function loadSuggestion() {
  try {
    const res = await $fetch<{ suggestion: string | null }>("/auth/me/battletag-suggestion", {
      baseURL: config.public.apiBase,
      credentials: "include",
    });
    suggestion.value = res.suggestion;
  } catch {
    suggestion.value = null;
  }
}
onMounted(loadSuggestion);

function linkSuggestion() {
  if (!suggestion.value) return;
  newBattletag.value = suggestion.value;
  addAccount();
}
```

Add `const accountsStore = useAccountsStore();` to the script setup.

Before posting a manual BattleTag, ask whether it already shares matches with a linked account and
warn — best-effort, silent when the call fails (the link itself must still work):

```ts
const overlapWarning = ref("");

async function checkOverlap(battletag: string): Promise<boolean> {
  try {
    const res = await $fetch<{ overlaps: boolean }>("/auth/me/accounts/overlap", {
      baseURL: config.public.apiBase,
      credentials: "include",
      query: { battletag },
    });
    return res.overlaps;
  } catch {
    return false;
  }
}
```

In `addAccount()`, after a successful link:

```ts
    if (await checkOverlap(battletag)) {
      overlapWarning.value =
        "Ce compte a joué des parties avec un de tes comptes : ces parties compteront deux fois.";
    }
```

and render `overlapWarning` under the add field, in `text-warning`.

- [ ] **Step 3: Verify in the browser**

Run: `bun run dev`
Expected: the `/settings` page lists the accounts; linking a new tag refreshes the list and the header switcher; unlinking the last account clears the primary.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/pages/settings/index.vue
git commit -m "feat(web): manage linked accounts from Settings"
```

---

### Task 13: "It's me" highlights across the web app

**Files:**
- Modify: `apps/web/app/pages/matches/[id].vue`
- Modify: `apps/web/app/components/players/ProfileDetail.vue`
- Modify: `apps/web/app/pages/draft/index.vue`
- Modify: `apps/web/app/components/draft/DraftTeamColumn.vue`
- Modify: `apps/web/app/components/ProComparisonView.vue`
- Modify: `apps/web/app/components/spatial/SpatialSlotGroup.vue`
- Modify: `apps/web/app/components/spatial/SpatialHistorySlotConfig.vue`
- Modify: `apps/web/app/utils/coachAnalysis.ts` (if `buildScoreboardRows` takes a single battletag)

**Interfaces:**
- Consumes: `useAuthUser().accounts` (Task 10).
- Produces: every "is this me" test becomes a set-membership test.

- [ ] **Step 1: Add one shared helper**

Create `apps/web/app/utils/myAccounts.ts`:

```ts
import type { PlayerAccount } from "@hots-stats/shared-types";

/** Every BattleTag owned by the viewer, lowercased for comparison. */
export function myBattletagSet(accounts: PlayerAccount[] | undefined, fallback: string | null): Set<string> {
  const set = new Set((accounts ?? []).map((account) => account.battletag.toLowerCase()));
  if (set.size === 0 && fallback) set.add(fallback.toLowerCase());
  return set;
}

export function isMine(battletag: string | null | undefined, mine: Set<string>): boolean {
  return Boolean(battletag) && mine.has(battletag!.toLowerCase());
}
```

- [ ] **Step 2: `matches/[id].vue`**

Replace `const myBattletag = computed(() => authData.value?.user?.battletag ?? null);` with:

```ts
const myBattletags = computed(() =>
  myBattletagSet(authData.value?.user?.accounts, authData.value?.user?.battletag ?? null),
);
```

and pass `myBattletags` where `myBattletag` was passed (l.62, l.213). Update `buildScoreboardRows` in `app/utils/coachAnalysis.ts` to accept `Set<string>` and use `isMine(row.battletag, mine)` instead of string equality; update its existing unit test accordingly.

- [ ] **Step 3: `ProfileDetail.vue`**

```ts
const myTags = computed(() =>
  myBattletagSet(authData.value?.user?.accounts, authData.value?.user?.battletag ?? null),
);
const isSelf = computed(() => isMine(props.battletag, myTags.value));
```

- [ ] **Step 4: draft pages/components**

`draft/index.vue` (l.14, 55-57, 100) and `DraftTeamColumn.vue` (l.8, 21): `ownBattletag: string | null` becomes `ownBattletags: Set<string>` and the comparisons become `isMine(slot.effectiveBattletag, ownBattletags)`. The "enemy team" computation becomes "the team that contains none of my accounts".

- [ ] **Step 5: `ProComparisonView.vue` + spatial slots**

`myBattletag` (l.34, 81) becomes the set; the heatmap slot picker defaults to one of the viewer's accounts present in the options list:

```ts
heatmap.selectedBattletagA.value =
  options.find((option) => ownTags.value.has(option.battletag.toLowerCase()))?.battletag ??
  options[0]!.battletag;
```

`SpatialSlotGroup.vue` / `SpatialHistorySlotConfig.vue`: the prop type becomes `myBattletags?: Set<string>` and passes through unchanged otherwise.

- [ ] **Step 6: Typecheck, test, commit**

```bash
bun run --filter './apps/web' typecheck && bun run --filter './apps/web' test
git add apps/web/app
git commit -m "feat(web): treat every linked account as self across the UI"
```


---

## Phase D — Daemon

### Task 14: `accounts_discovery`

**Files:**
- Create: `daemon-python/src/accounts_discovery.py`
- Create: `daemon-python/tests/test_accounts_discovery.py`

**Interfaces:**
- Produces: `AccountFolder(account_id, toon_handle, replays_dir)`, `WatchDir(path, toon_handle)`, `discover_account_folders(hots_dir)`, `watch_dirs(hots_dir, extra_replay_dirs=())`.

- [ ] **Step 1: Write the failing tests**

```python
# daemon-python/tests/test_accounts_discovery.py
from pathlib import Path

from src.accounts_discovery import discover_account_folders, watch_dirs


def _make_account(root: Path, account_id: str, toon: str, queues=("Multiplayer",)) -> Path:
    replays = root / "Accounts" / account_id / toon / "Replays"
    for queue in queues:
        (replays / queue).mkdir(parents=True, exist_ok=True)
    return replays


def test_discovers_every_account_folder(tmp_path):
    _make_account(tmp_path, "415612224", "2-Hero-1-4929240")
    _make_account(tmp_path, "1112776579", "2-Hero-1-13560393")
    folders = discover_account_folders(tmp_path)
    assert [f.toon_handle for f in folders] == ["2-Hero-1-13560393", "2-Hero-1-4929240"]
    assert folders[0].account_id == "1112776579"


def test_ignores_non_toon_folders(tmp_path):
    (tmp_path / "Accounts" / "415612224" / "Hotkeys").mkdir(parents=True)
    _make_account(tmp_path, "415612224", "2-Hero-1-4929240")
    assert len(discover_account_folders(tmp_path)) == 1


def test_missing_accounts_root_is_empty(tmp_path):
    assert discover_account_folders(tmp_path) == []


def test_watch_dirs_covers_every_queue_and_keeps_toon(tmp_path):
    _make_account(tmp_path, "415612224", "2-Hero-1-4929240", queues=("Multiplayer", "Custom"))
    dirs = watch_dirs(tmp_path)
    assert {(d.path.name, d.toon_handle) for d in dirs} == {
        ("Multiplayer", "2-Hero-1-4929240"),
        ("Custom", "2-Hero-1-4929240"),
    }


def test_watch_dirs_appends_extra_dirs_without_toon(tmp_path):
    extra = tmp_path / "elsewhere" / "Replays" / "Multiplayer"
    extra.mkdir(parents=True)
    dirs = watch_dirs(tmp_path, [extra])
    assert [d.path for d in dirs] == [extra]
    assert dirs[0].toon_handle is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd daemon-python && pytest tests/test_accounts_discovery.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.accounts_discovery'`.

- [ ] **Step 3: Implement it**

```python
"""Discovers every Heroes of the Storm account folder that can hold replays.

Layout: Documents/Heroes of the Storm/Accounts/<battlenetAccountId>/<toonHandle>/Replays/<queue>/

The folder named <toonHandle> is exactly the string that parser._toon_handle()
builds (<region>-Hero-<realm>-<id>), and the same identity the replay's own player
list uses -- which is what makes "which account wrote this replay?" deterministic.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class AccountFolder:
    account_id: str
    toon_handle: str
    replays_dir: Path


@dataclass(frozen=True)
class WatchDir:
    path: Path
    # None for a manually-configured extra folder: no account can be derived
    # from it, so those replays upload without a selfBattletag.
    toon_handle: str | None


def discover_account_folders(hots_dir: Path) -> list[AccountFolder]:
    """Every Accounts/<id>/<toon>/Replays folder under hots_dir."""
    accounts_root = hots_dir / "Accounts"
    if not accounts_root.is_dir():
        return []
    found: list[AccountFolder] = []
    for account in sorted(accounts_root.iterdir()):
        if not account.is_dir():
            continue
        for toon in sorted(account.iterdir()):
            # "2-Hero-1-4929240": the toon handle, not a sibling like Hotkeys/.
            if not toon.is_dir() or "-Hero-" not in toon.name:
                continue
            replays = toon / "Replays"
            if replays.is_dir():
                found.append(AccountFolder(account.name, toon.name, replays))
    return found


def replay_queues(replays_dir: Path) -> list[Path]:
    """The per-queue subfolders (Multiplayer, Custom, ...) of a Replays folder."""
    try:
        queues = [path for path in sorted(replays_dir.iterdir()) if path.is_dir()]
    except OSError:
        return []
    return queues or [replays_dir]


def watch_dirs(hots_dir: Path, extra_replay_dirs: Iterable[Path] = ()) -> list[WatchDir]:
    """Every directory to watch, deduped, each tagged with its account toon."""
    dirs: list[WatchDir] = []
    seen: set[str] = set()
    for folder in discover_account_folders(hots_dir):
        for queue in replay_queues(folder.replays_dir):
            key = str(queue)
            if key in seen:
                continue
            seen.add(key)
            dirs.append(WatchDir(queue, folder.toon_handle))
    for extra in extra_replay_dirs:
        if not extra.is_dir() or str(extra) in seen:
            continue
        seen.add(str(extra))
        dirs.append(WatchDir(extra, None))
    return dirs
```

- [ ] **Step 4: Run the tests**

Run: `cd daemon-python && pytest tests/test_accounts_discovery.py -q`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/accounts_discovery.py daemon-python/tests/test_accounts_discovery.py
git commit -m "feat(daemon): discover every HotS account replay folder"
```

---

### Task 15: Config — `hotsDir` + legacy migration

**Files:**
- Modify: `daemon-python/src/config.py`
- Modify: `daemon-python/tests/test_config.py`

**Interfaces:**
- Produces: `Config.hots_dir: Path`, `Config.extra_replay_dirs: tuple[Path, ...]`, `default_hots_dir()`, `derive_hots_dir_from_replays_dir(path)`, `save_config(api_base_url, access_token, hots_dir, extra_replay_dirs=(), ...)`.

- [ ] **Step 1: Write the failing tests**

Add to `daemon-python/tests/test_config.py`:

```python
def test_derive_hots_dir_from_legacy_replays_dir():
    legacy = Path(
        "C:/Users/x/Documents/Heroes of the Storm/Accounts/415612224/2-Hero-1-4929240/Replays/Multiplayer"
    )
    assert derive_hots_dir_from_replays_dir(legacy) == Path("C:/Users/x/Documents/Heroes of the Storm")


def test_derive_hots_dir_returns_none_when_unknown():
    assert derive_hots_dir_from_replays_dir(Path("D:/somewhere/else")) is None


def test_load_config_migrates_legacy_replays_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("APPDATA", str(tmp_path))
    legacy = (
        tmp_path / "Docs" / "Heroes of the Storm" / "Accounts" / "1"
        / "1-Hero-1-1" / "Replays" / "Multiplayer"
    )
    legacy.mkdir(parents=True)
    config_file = tmp_path / "hots-analytics" / "config.json"
    config_file.parent.mkdir(parents=True, exist_ok=True)
    config_file.write_text(
        json.dumps({"apiBaseUrl": "http://x", "accessToken": "t", "replaysDir": str(legacy)}),
        encoding="utf-8",
    )
    config = load_config()
    assert config.hots_dir == tmp_path / "Docs" / "Heroes of the Storm"
    # The legacy folder stays watched so nothing stops uploading.
    assert legacy in config.extra_replay_dirs
```

Update every existing test that sets `HOTS_REPLAYS_DIR` or `replaysDir`: the new env var is `HOTS_DIR` and the new key is `hotsDir`. Keep one test proving `HOTS_REPLAYS_DIR` still works as an extra replay dir.

- [ ] **Step 2: Run to verify they fail**

Run: `cd daemon-python && pytest tests/test_config.py -q`
Expected: FAIL — ImportError on `derive_hots_dir_from_replays_dir`.

- [ ] **Step 3: Implement the config changes**

Replace `Config.replays_dir` with:

```python
@dataclass(frozen=True)
class Config:
    api_base_url: str
    access_token: str
    # Documents/Heroes of the Storm -- the root, not one account's Replays dir.
    hots_dir: Path
    # Extra folders to watch verbatim (legacy replaysDir, exotic setups).
    extra_replay_dirs: tuple[Path, ...] = ()
    draft_feature_enabled: bool = True
    draft_hotkey: str = DEFAULT_DRAFT_HOTKEY
    auto_update_enabled: bool = True
```

Add:

```python
def default_hots_dir() -> Path | None:
    """~/Documents/Heroes of the Storm when it exists, else None."""
    candidate = Path.home() / "Documents" / "Heroes of the Storm"
    return candidate if candidate.is_dir() else None


def derive_hots_dir_from_replays_dir(replays_dir: Path) -> Path | None:
    """Walk up until a folder is named Accounts, then take its parent.

    Handles the legacy .../Accounts/<id>/<toon>/Replays/<queue> value.
    """
    for parent in [replays_dir, *replays_dir.parents]:
        if parent.name == "Accounts":
            return parent.parent
    return None
```

and rewrite the replays-dir part of `load_config()`:

```python
    hots_dir_value = os.environ.get("HOTS_DIR") or file_values.get("hotsDir")
    legacy_value = os.environ.get("HOTS_REPLAYS_DIR") or file_values.get("replaysDir")

    if hots_dir_value:
        hots_dir = Path(hots_dir_value)
    elif legacy_value:
        # Migration: a config saved before hotsDir existed pointed at one
        # account's Replays/<queue>; derive the root from it.
        hots_dir = derive_hots_dir_from_replays_dir(Path(legacy_value)) or default_hots_dir()
    else:
        hots_dir = default_hots_dir()

    if hots_dir is None:
        raise ConfigError(
            "Could not autodetect the Heroes of the Storm folder. Set HOTS_DIR or hotsDir in "
            + str(config_file_path())
            + "."
        )

    extra_replay_dirs: list[Path] = []
    if legacy_value:
        legacy_path = Path(legacy_value)
        if legacy_path.is_dir() and legacy_path != hots_dir and not legacy_path.is_relative_to(hots_dir):
            extra_replay_dirs.append(legacy_path)
```

and `save_config(api_base_url, access_token, hots_dir, extra_replay_dirs=(), draft_feature_enabled=True, draft_hotkey=..., auto_update_enabled=True)` writing `hotsDir` + `extraReplayDirs` and no longer writing `replaysDir`.

- [ ] **Step 4: Run the tests**

Run: `cd daemon-python && pytest tests/test_config.py -q`
Expected: PASS.

- [ ] **Step 5: Fix the remaining call sites**

Run: `cd daemon-python && grep -rn "replays_dir" src/`

Update `app.py` (`config.replays_dir` becomes the watch-dir list, Task 17), `main.py` (`--resync`, Task 18) and `gui.py` (Task 18). Do not commit until the whole daemon imports.

- [ ] **Step 6: Commit**

```bash
git add daemon-python/src/config.py daemon-python/tests/test_config.py
git commit -m "feat(daemon): configure the HotS root and migrate legacy replaysDir"
```

---

### Task 16: Parser — `selfBattletag`

**Files:**
- Modify: `daemon-python/src/parser.py`
- Modify: `daemon-python/tests/test_parser.py`

**Interfaces:**
- Produces: `parse_replay(path, calibrations=None, expected_toon_handle=None)` returning a payload that may carry `selfBattletag`.

- [ ] **Step 1: Write the failing test**

Add to `daemon-python/tests/test_parser.py`, next to the existing replay fixtures:

```python
def test_payload_carries_self_battletag_for_the_expected_toon(replay_path):
    payload = parse_replay(replay_path, expected_toon_handle="2-Hero-1-4929240")
    assert payload.get("selfBattletag") == "aife#21170"


def test_payload_omits_self_battletag_when_the_toon_is_absent(replay_path):
    payload = parse_replay(replay_path, expected_toon_handle="9-Hero-9-999999")
    assert "selfBattletag" not in payload
```

Adapt the fixture name and the expected BattleTag to whatever fixtures already exist in that file; the two assertions are the contract.

- [ ] **Step 2: Run to verify they fail**

Run: `cd daemon-python && pytest tests/test_parser.py -k self_battletag -q`
Expected: FAIL — `parse_replay() got an unexpected keyword argument`.

- [ ] **Step 3: Implement it**

In `parser.py`:
- add `expected_toon_handle: str | None = None` to `parse_replay` and forward it to `build_payload`;
- add the same parameter to `build_payload`;
- where the payload dict is assembled (after the `players` dict exists), add:

```python
    self_battletag: str | None = None
    if expected_toon_handle:
        entry = players.get(expected_toon_handle)
        if entry is None:
            logger.info(
                "Account folder toon %s is not in this replay's player list; "
                "no selfBattletag will be sent.",
                expected_toon_handle,
            )
        else:
            self_battletag = entry["battletag"]
```

- and include the key **only when set**, so the API's optional field stays absent rather than null:

```python
    if self_battletag:
        payload["selfBattletag"] = self_battletag
```

- **do not touch `PARSER_VERSION`.**

- [ ] **Step 4: Run the tests**

Run: `cd daemon-python && pytest tests/test_parser.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/parser.py daemon-python/tests/test_parser.py
git commit -m "feat(daemon): report the account folder's battletag with each replay"
```

---

### Task 17: Watch and sync every folder

**Files:**
- Modify: `daemon-python/src/watcher.py`
- Modify: `daemon-python/src/app.py`
- Modify: `daemon-python/src/ingestion.py`
- Create: `daemon-python/tests/test_watcher.py` (or extend it)

**Interfaces:**
- Consumes: `WatchDir` (Task 14), `Config.hots_dir` (Task 15), `parse_replay` (Task 16).
- Produces: `watch_replays(replays_dirs, on_replay_ready, stop_event=None, known_paths=None)`; `ingest_file(..., toon_handle=None)`.

- [ ] **Step 1: Widen the watcher**

- change the signature to `replays_dirs: Sequence[Path]`;
- schedule the handler once per directory:

```python
    for replays_dir in replays_dirs:
        observer.schedule(handler, str(replays_dir), recursive=False)
```

- make the periodic scan iterate every directory:

```python
            with seen_lock:
                missed = [
                    path
                    for replays_dir in replays_dirs
                    for path in _scan_for_new_replays(replays_dir, seen)
                ]
```

- log the folder count rather than one path.

- [ ] **Step 2: Widen `ingest_file`**

`ingestion.py`: add `toon_handle: str | None = None` and pass it through:

```python
        payload = replay_parser.parse_replay(
            path, calibrations=calibrations, expected_toon_handle=toon_handle
        )
```

Also update the resync helper to accept the same parameter per folder.

- [ ] **Step 3: Widen `_run_sync_loop`**

`app.py`: the signature becomes `_run_sync_loop(watch_dirs, ingest, stop_event, status, sync_state=None, on_initial_scan=None)` where `ingest` is `Callable[[Path, str | None], None]`:

```python
    existing: list[Path] = []
    toon_by_path: dict[str, str | None] = {}
    for watch_dir in watch_dirs:
        for path in sorted(watch_dir.path.glob("*.StormReplay")):
            existing.append(path)
            toon_by_path[str(path)] = watch_dir.toon_handle
```

and the initial pool submits `pool.submit(ingest, path, toon_by_path.get(str(path)))`, while the watcher callback reuses the same map plus a directory lookup for files created after startup:

```python
    toon_by_dir = {str(watch_dir.path): watch_dir.toon_handle for watch_dir in watch_dirs}

    def _on_new_replay(path: Path) -> None:
        status.bump_found()
        toon_handle = toon_by_path.get(str(path), toon_by_dir.get(str(path.parent)))
        ingest(path, toon_handle)
```

- `_DaemonRunner.start` builds the list once:

```python
        from . import accounts_discovery

        watch_dirs = accounts_discovery.watch_dirs(config.hots_dir, config.extra_replay_dirs)
        if not watch_dirs:
            logger.warning("No replay folder found under %s", config.hots_dir)
```

- `_ingest_and_track(path, toon_handle)` forwards `toon_handle` to `ingest_file`.

- [ ] **Step 4: Test it**

```python
# daemon-python/tests/test_watcher.py
import threading
from pathlib import Path

from src.watcher import watch_replays


def test_watches_every_directory(tmp_path):
    first = tmp_path / "a"
    second = tmp_path / "b"
    first.mkdir()
    second.mkdir()
    seen: list[Path] = []
    ready = threading.Event()

    def on_ready(path: Path) -> None:
        seen.append(path)
        ready.set()

    stop = threading.Event()
    thread = threading.Thread(
        target=watch_replays,
        args=([first, second], on_ready),
        kwargs={"stop_event": stop},
        daemon=True,
    )
    thread.start()
    try:
        (second / "new.StormReplay").write_bytes(b"x")
        assert ready.wait(10)
    finally:
        stop.set()
        thread.join(timeout=10)
    assert seen == [second / "new.StormReplay"]
```

Run: `cd daemon-python && pytest tests/test_watcher.py -q`

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/watcher.py daemon-python/src/app.py daemon-python/src/ingestion.py daemon-python/tests/test_watcher.py
git commit -m "feat(daemon): watch and sync every HotS account folder"
```

---

### Task 18: CLI, settings window, and daemon smoke test

**Files:**
- Modify: `daemon-python/src/main.py`
- Modify: `daemon-python/src/gui.py`
- Modify: `daemon-python/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a shippable daemon.

- [ ] **Step 1: `--resync`**

`main.py` l.44: with no argument, resync every discovered folder (each replay ingested with its folder's toon handle); with an explicit path, keep today's single-folder behaviour (`toon_handle=None`).

- [ ] **Step 2: Settings window**

In `gui.py`:
- relabel the field (l.694 area and the section header) to "Dossier Heroes of the Storm" and validate that it contains an `Accounts` subfolder (`_check_replays_dir`, l.1680);
- `_browse_replays_dir` keeps its `askdirectory` behaviour, just targets the new field;
- prefill from `existing.get("hotsDir")` with `default_hots_dir()` as the fallback (l.1655-1663);
- when saving (l.2040+), pass `hots_dir` + `extra_replay_dirs` to `save_config`;
- add a read-only "Comptes détectés" list under the field, built from `accounts_discovery.discover_account_folders(Path(hots_dir))` (toon handle + replay count), refreshed when the field changes. It must never raise on a missing or invalid path — show "aucun compte détecté" instead;
- if the API is reachable, also show the linked accounts from `GET /ingest/accounts` via `api_client` (best-effort, silent on failure), distinguishing "vérifié par le démon" from "non lié".

- [ ] **Step 3: Update the README**

`daemon-python/README.md` l.28-35: document `hotsDir`, `HOTS_DIR`, the automatic discovery, and note that the old `replaysDir` / `HOTS_REPLAYS_DIR` still work as an extra folder.

- [ ] **Step 4: Full daemon test suite**

Run: `cd daemon-python && pytest -q`
Expected: PASS.

- [ ] **Step 5: Live smoke test on this machine**

Run: `cd daemon-python && python -m src.main --resync`
Expected: both accounts are discovered; the log mentions replays from BOTH `2-Hero-1-13560393` and `2-Hero-1-4929240`; `GET /ingest/accounts` then returns two BattleTags for this user.

- [ ] **Step 6: Commit**

```bash
git add daemon-python
git commit -m "feat(daemon): HotS-root settings UI, cross-account resync, docs"
```

---

## Phase E — Final verification

### Task 19: Whole-repo gates, then push

**Files:** none (verification only).

- [ ] **Step 1: Every gate, in order**

```bash
bun install
bun run --filter './packages/db' generate    # expect "no changes" -- the migration already exists
bun run --filter './packages/db' migrate
bun run typecheck
bun run build
bun run --filter './apps/web' test
bun test apps/api
cd daemon-python && pytest -q
```

Expected: all PASS. `generate` must produce no new migration; if it does, the schema and the committed migration have drifted.

- [ ] **Step 2: Manual end-to-end smoke**

1. `/settings`: both accounts listed, one marked "principal", the daemon-linked one marked "vérifié par le démon".
2. Header switcher: selecting only the primary changes the dashboard counts; selecting both merges them (counts add up).
3. `/players`: the smurf does **not** appear as an encountered player.
4. `/matches`: the merged view shows games from both accounts, including games uploaded by someone else that contain the smurf.
5. Reload: the selection is remembered.
6. Unlink the smurf: the merged count drops back; the primary keeps working.

- [ ] **Step 3: Confirm nothing is left dirty**

```bash
git status --short
grep -rn "matchPlayers.userId" apps/api/src
grep -rn "replays_dir" daemon-python/src
```

Expected: clean tree; `matchPlayers.userId` only in `uploads-diagnostics.service.ts` + `replay-upsert.service.ts`; no `config.replays_dir` reads left.

- [ ] **Step 4: Push**

```bash
git push origin main
```

Only after every step above passes.

