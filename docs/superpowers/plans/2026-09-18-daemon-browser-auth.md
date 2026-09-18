# Daemon Browser-Based Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the daemon's copy/paste PAT entry with a one-click browser handshake (loopback redirect + PKCE) that mints an ordinary personal access token.

**Architecture:** The web app (already session-authenticated) POSTs to a new `POST /auth/daemon/authorize`, which stores a short-lived single-use code; the browser is redirected to the daemon's loopback listener; the daemon exchanges that code plus its PKCE verifier at the public `POST /auth/daemon/token` for a PAT. Pure logic (redirect validation, PKCE, rate limiting) lives in `apps/api/src/lib/@ so it is unit-testable without a database; DB work lives in a service; the Hono route stays thin.

**Tech Stack:** Bun, Hono 4.13, zod 4.4, Drizzle ORM 0.45 + Postgres, Nuxt 3 + Nuxt UI (Vitest), Python 3 stdlib (`http.server`, `hashlib`, `secrets`, `webbrowser`) + `requests`, pytest.

**Spec:** `docs/superpowers/specs/2026-09-18-daemon-browser-auth-design.md`

## Global Constraints

- Token format `hots_pat_<64 hex>`, stored only as `sha256` hex. Reuse `generatePersonalAccessToken()` / `hashToken()` from `apps/api/src/lib/tokens.ts`. Never log or persist a raw token.
- `redirectUri` must be exactly `http://127.0.0.1:<port>/callback` or `http://localhost:<port>/callback`: explicit port, no query, no hash, `http` only. Nothing else is accepted.
- Authorization code: 32 random bytes base64url, 60-second TTL, single use, stored only as `sha256`.
- PKCE `S256` only. Every exchange failure answers HTTP 400 `{ "error": "invalid_grant" }` — never a distinct message.
- No new runtime dependency in any workspace, and none in the daemon (stdlib plus the already-present `requests`).
- API pure-logic tests are `bun test` files co-located in `apps/api/src/lib/@; DB-backed tests skip unless `DATABASE_URL` is set. Web tests are Vitest. Daemon tests are pytest with `from src.<module> import ...`.
- Code and comments are English; every user-facing string is French.
- **Release rule:** work only on branch `feat/daemon-browser-auth`. Never commit to or push `main`. A merge to `main` touching `daemon-python/**@ automatically bumps the daemon version, tags, builds and publishes a release.
- Every task ends with a commit. Push the branch after each green task.

## File Structure

Created:

- `packages/db/src/schema/daemon-authorization-codes.ts` — the authorization-code table.
- `apps/api/src/lib/daemon-auth.ts` — pure helpers: loopback validation, PKCE, code/hash generation, redirect URL building, device-name sanitization, zod schemas.
- `apps/api/src/lib/rate-limit.ts` — in-memory fixed-window limiter.
- `apps/api/src/services/daemon-auth.service.ts` — DB-backed create / exchange / cleanup.
- `apps/api/src/routes/daemon-auth.ts` — thin Hono routes.
- `apps/web/app/utils/daemonAuthorization.ts` — query-param validation and cancel URL builder (pure).
- `apps/web/app/composables/useDaemonAuthorization.ts` — API call wrapper.
- `apps/web/app/pages/daemon/authorize.vue` — consent screen.
- `daemon-python/src/auth_flow.py` — PKCE + loopback receiver + orchestration.
- Tests: `apps/api/src/lib/daemon-auth.test.ts`, `apps/api/src/lib/rate-limit.test.ts`, `apps/api/src/services/daemon-auth.service.test.ts`, `apps/api/src/routes/health.test.ts`, `apps/web/app/utils/daemonAuthorization.test.ts`, `daemon-python/tests/test_auth_flow.py`.

Modified:

- `packages/db/src/schema/index.ts` — export the new table.
- `apps/api/src/routes/health.ts` — add `webOrigin`.
- `apps/api/src/routes/tokens.ts` — include `name` in the list response.
- `apps/api/src/index.ts` — mount `/auth/daemon`.
- `apps/web/app/components/upload/TokenCard.vue`, `TokenManager.vue`, `DaemonOnboarding.vue`.
- `daemon-python/src/urls.py`, `daemon-python/src/api_client.py`, `daemon-python/src/gui.py`, `daemon-python/tests/test_urls.py`.

---

## Checkpoint A1 — API

### Task 1: `daemon_authorization_codes` table

**Files:**
- Create: `packages/db/src/schema/daemon-authorization-codes.ts`
- Modify: `packages/db/src/schema/index.ts`
- Generated: `packages/db/drizzle/00XX_*.sql` + `packages/db/drizzle/meta/00XX_snapshot.json`

**Interfaces:**
- Consumes: `users` from `./users`.
- Produces: `daemonAuthorizationCodes` table and the `DaemonAuthorizationCode` / `NewDaemonAuthorizationCode` types, imported by Task 4.

- [ ] **Step 1: Create the schema file**

```ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Short-lived, single-use authorization codes for the daemon's loopback
 * browser handshake (see docs/superpowers/specs/2026-09-18-daemon-browser-auth-design.md).
 * Only the sha256 of the code is stored; the raw code is returned once.
 */
export const daemonAuthorizationCodes = pgTable("daemon_authorization_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  codeChallenge: text("code_challenge").notNull(),
  codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
  redirectUri: text("redirect_uri").notNull(),
  deviceName: text("device_name"),
  tokenName: text("token_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export type DaemonAuthorizationCode = typeof daemonAuthorizationCodes.$inferSelect;
export type NewDaemonAuthorizationCode = typeof daemonAuthorizationCodes.$inferInsert;
```

- [ ] **Step 2: Export it from the schema barrel**

Add to `packages/db/src/schema/index.ts`:

```ts
export * from "./daemon-authorization-codes";
```

- [ ] **Step 3: Generate the migration**

Run: `bun run --filter './packages/db' generate`
Expected: a new `packages/db/drizzle/00XX_*.sql` creating `daemon_authorization_codes` with the FK to `users` and a unique index on `code_hash`.

- [ ] **Step 4: Inspect the generated SQL**

Read the new `.sql` file and confirm it contains `CREATE TABLE "daemon_authorization_codes"`, `REFERENCES "users"("id") ON DELETE cascade`, and a unique constraint on `code_hash`. If any is missing, fix the schema and regenerate.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/daemon-authorization-codes.ts packages/db/src/schema/index.ts packages/db/drizzle
git commit -m "feat(db): add daemon_authorization_codes table"
```

---

### Task 2: Pure daemon-auth helpers

**Files:**
- Create: `apps/api/src/lib/daemon-auth.ts`
- Test: `apps/api/src/lib/daemon-auth.test.ts`

**Interfaces:**
- Produces (all pure, no DB):
  - `isLoopbackRedirectUri(raw: string): boolean`
  - `deriveCodeChallenge(verifier: string): string`
  - `verifyCodeChallenge(verifier: string, challenge: string): boolean`
  - `generateAuthorizationCode(): string`
  - `hashAuthorizationCode(code: string): string`
  - `buildRedirectUrl(redirectUri: string, code: string, state: string): string`
  - `buildCancelRedirectUrl(redirectUri: string, state: string, error?: string): string`
  - `sanitizeDeviceName(raw: unknown): string`
  - `authorizeInputSchema`, `tokenExchangeInputSchema` (zod) and the `AuthorizeInput` / `TokenExchangeInput` inferred types.

- [ ] **Step 1: Write the failing test**

`apps/api/src/lib/daemon-auth.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  authorizeInputSchema,
  buildCancelRedirectUrl,
  buildRedirectUrl,
  deriveCodeChallenge,
  isLoopbackRedirectUri,
  sanitizeDeviceName,
  verifyCodeChallenge,
} from "./daemon-auth";

// RFC 7636, Appendix B.
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("deriveCodeChallenge", () => {
  test("matches the RFC 7636 Appendix B vector", () => {
    expect(deriveCodeChallenge(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
  });
});

describe("verifyCodeChallenge", () => {
  test("accepts the matching verifier", () => {
    expect(verifyCodeChallenge(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true);
  });

  test("rejects a different verifier", () => {
    expect(verifyCodeChallenge("x".repeat(43), RFC_CHALLENGE)).toBe(false);
  });

  test("rejects a challenge of a different length without throwing", () => {
    expect(verifyCodeChallenge(RFC_VERIFIER, "short")).toBe(false);
  });
});

describe("isLoopbackRedirectUri", () => {
  test("accepts 127.0.0.1 with an explicit port", () => {
    expect(isLoopbackRedirectUri("http://127.0.0.1:51337/callback")).toBe(true);
  });

  test("accepts localhost with an explicit port", () => {
    expect(isLoopbackRedirectUri("http://localhost:8080/callback")).toBe(true);
  });

  test("rejects https", () => {
    expect(isLoopbackRedirectUri("https://127.0.0.1:51337/callback")).toBe(false);
  });

  test("rejects a non-loopback host", () => {
    expect(isLoopbackRedirectUri("http://evil.example.com:51337/callback")).toBe(false);
  });

  test("rejects a missing port", () => {
    expect(isLoopbackRedirectUri("http://127.0.0.1/callback")).toBe(false);
  });

  test("rejects a different path", () => {
    expect(isLoopbackRedirectUri("http://127.0.0.1:51337/steal")).toBe(false);
  });

  test("rejects a query or a hash", () => {
    expect(isLoopbackRedirectUri("http://127.0.0.1:51337/callback?x=1")).toBe(false);
    expect(isLoopbackRedirectUri("http://127.0.0.1:51337/callback#frag")).toBe(false);
  });

  test("rejects garbage", () => {
    expect(isLoopbackRedirectUri("not a url")).toBe(false);
  });
});

describe("buildRedirectUrl", () => {
  test("appends code and state", () => {
    expect(buildRedirectUrl("http://127.0.0.1:51337/callback", "abc", "state1234")).toBe(
      "http://127.0.0.1:51337/callback?code=abc&state=state1234",
    );
  });
});

describe("buildCancelRedirectUrl", () => {
  test("appends access_denied and state", () => {
    expect(buildCancelRedirectUrl("http://127.0.0.1:51337/callback", "state1234")).toBe(
      "http://127.0.0.1:51337/callback?error=access_denied&state=state1234",
    );
  });
});

describe("sanitizeDeviceName", () => {
  test("keeps letters, digits, spaces, dot, dash and underscore", () => {
    expect(sanitizeDeviceName("DESKTOP-ABC_1.local")).toBe("DESKTOP-ABC_1.local");
  });

  test("strips control and quote characters", () => {
    expect(sanitizeDeviceName('bad"name
<svg>')).toBe("badnamesvg");
  });

  test("falls back to Daemon for empty or non-string input", () => {
    expect(sanitizeDeviceName("")).toBe("Daemon");
    expect(sanitizeDeviceName(undefined)).toBe("Daemon");
    expect(sanitizeDeviceName(42)).toBe("Daemon");
  });

  test("caps the length at 64 characters", () => {
    expect(sanitizeDeviceName("a".repeat(200)).length).toBe(64);
  });
});

describe("authorizeInputSchema", () => {
  const valid = {
    redirectUri: "http://127.0.0.1:51337/callback",
    state: "state1234",
    codeChallenge: RFC_CHALLENGE,
    codeChallengeMethod: "S256" as const,
  };

  test("accepts a valid body", () => {
    expect(authorizeInputSchema.safeParse(valid).success).toBe(true);
  });

  test("rejects a non-loopback redirectUri", () => {
    expect(
      authorizeInputSchema.safeParse({ ...valid, redirectUri: "https://example.com/callback" }).success,
    ).toBe(false);
  });

  test("rejects a method other than S256", () => {
    expect(authorizeInputSchema.safeParse({ ...valid, codeChallengeMethod: "plain" }).success).toBe(false);
  });

  test("rejects a too-short state", () => {
    expect(authorizeInputSchema.safeParse({ ...valid, state: "short" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/lib/daemon-auth.test.ts`
Expected: FAIL — the module `./daemon-auth` cannot be resolved.

- [ ] **Step 3: Write the implementation**

`apps/api/src/lib/daemon-auth.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** base64url of a SHA-256 digest: 43 characters, URL-safe alphabet. */
const BASE64URL_43_128 = /^[A-Za-z0-9_-]{43,128}$/;
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

/**
 * The only redirect targets the consent page may hand a code back to: a
 * loopback address with an explicit port and exactly the /callback path.
 * Anything else could turn the consent page into an open redirect.
 */
export function isLoopbackRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "http:" &&
    LOOPBACK_HOSTNAMES.has(url.hostname) &&
    url.port !== "" &&
    url.pathname === "/callback" &&
    url.search === "" &&
    url.hash === ""
  );
}

/** RFC 7636 S256: base64url(SHA-256(ASCII(code_verifier))). */
export function deriveCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyCodeChallenge(verifier: string, challenge: string): boolean {
  const derived = Buffer.from(deriveCodeChallenge(verifier));
  const expected = Buffer.from(challenge);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function generateAuthorizationCode(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAuthorizationCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function buildRedirectUrl(redirectUri: string, code: string, state: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  url.searchParams.set("state", state);
  return url.toString();
}

export function buildCancelRedirectUrl(redirectUri: string, state: string, error = "access_denied"): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("state", state);
  return url.toString();
}

/** Keeps a hostname safe as a display label and as part of a token name. */
export function sanitizeDeviceName(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";
  const cleaned = value
    .replace(/[^\p{L}\p{N} ._-]/gu, "")
    .trim()
    .slice(0, 64);
  return cleaned || "Daemon";
}

export const authorizeInputSchema = z.object({
  redirectUri: z
    .string()
    .min(1)
    .max(2048)
    .refine(
      isLoopbackRedirectUri,
      "redirectUri must be http://127.0.0.1:<port>/callback or http://localhost:<port>/callback",
    ),
  state: z.string().min(8).max(128),
  codeChallenge: z.string().regex(BASE64URL_43_128),
  codeChallengeMethod: z.literal("S256"),
  deviceName: z.string().max(128).optional(),
});

export const tokenExchangeInputSchema = z.object({
  code: z.string().min(16).max(256),
  codeVerifier: z.string().min(43).max(128),
});

export type AuthorizeInput = z.infer<typeof authorizeInputSchema>;
export type TokenExchangeInput = z.infer<typeof tokenExchangeInputSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/lib/daemon-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/daemon-auth.ts apps/api/src/lib/daemon-auth.test.ts
git commit -m "feat(api): add pure daemon authorization helpers (PKCE, loopback validation)"
```

---

### Task 3: In-memory fixed-window rate limiter

**Files:**
- Create: `apps/api/src/lib/rate-limit.ts`
- Test: `apps/api/src/lib/rate-limit.test.ts`

**Interfaces:**
- Produces: `createFixedWindowLimiter(opts: { limit: number; windowMs: number }): FixedWindowLimiter` where `FixedWindowLimiter` is `{ allow(key: string, now?: number): boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { createFixedWindowLimiter } from "./rate-limit";

describe("createFixedWindowLimiter", () => {
  test("allows up to the limit inside one window", () => {
    const limiter = createFixedWindowLimiter({ limit: 3, windowMs: 1000 });
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 100)).toBe(true);
    expect(limiter.allow("a", 200)).toBe(true);
  });

  test("rejects the request past the limit", () => {
    const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 1000 });
    limiter.allow("a", 0);
    limiter.allow("a", 1);
    expect(limiter.allow("a", 2)).toBe(false);
  });

  test("resets once the window elapses", () => {
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 500)).toBe(false);
    expect(limiter.allow("a", 1000)).toBe(true);
  });

  test("keys are independent", () => {
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("b", 0)).toBe(true);
    expect(limiter.allow("a", 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/lib/rate-limit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Minimal per-process fixed-window rate limiter. Deliberately in-memory and
 * approximate behind multiple API instances -- the real backstop for the
 * daemon auth endpoints is the 60-second single-use authorization code.
 */
export interface FixedWindowLimiter {
  /** @param now injectable so tests do not depend on the wall clock. */
  allow(key: string, now?: number): boolean;
}

export function createFixedWindowLimiter(opts: { limit: number; windowMs: number }): FixedWindowLimiter {
  const windows = new Map<string, { windowStart: number; count: number }>();
  return {
    allow(key, now = Date.now()) {
      const existing = windows.get(key);
      if (!existing || now - existing.windowStart >= opts.windowMs) {
        windows.set(key, { windowStart: now, count: 1 });
        return true;
      }
      if (existing.count >= opts.limit) {
        return false;
      }
      existing.count += 1;
      return true;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/lib/rate-limit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/rate-limit.ts apps/api/src/lib/rate-limit.test.ts
git commit -m "feat(api): add in-memory fixed-window rate limiter"
```

### Task 4: `daemon-auth` service (create / exchange / cleanup)

**Files:**
- Create: `apps/api/src/services/daemon-auth.service.ts`
- Test: `apps/api/src/services/daemon-auth.service.test.ts`

**Interfaces:**
- Consumes: `daemonAuthorizationCodes` (Task 1); `generateAuthorizationCode`, `hashAuthorizationCode`, `verifyCodeChallenge`, `buildRedirectUrl` (Task 2); `generatePersonalAccessToken`, `hashToken` from `../lib/tokens`.
- Produces:
  - `createAuthorizationCode(userId: string, input: { redirectUri: string; state: string; codeChallenge: string; deviceName: string }): Promise<{ code: string; expiresAt: Date; redirectUrl: string }>`
  - `exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<{ token: string; tokenId: string; createdAt: Date; tokenName: string } | null>`
  - `deleteStaleAuthorizationCodes(): Promise<number>`

- [ ] **Step 1: Write the failing test**

DB-backed; the whole suite skips when `DATABASE_URL` is unset so CI without a database still passes.

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { daemonAuthorizationCodes, db, personalAccessTokens, users } from "@hots-stats/db";
import { deriveCodeChallenge } from "../lib/daemon-auth";
import { hashToken } from "../lib/tokens";
import { createAuthorizationCode, exchangeAuthorizationCode } from "./daemon-auth.service";

const maybe = process.env.DATABASE_URL ? describe : describe.skip;
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = deriveCodeChallenge(VERIFIER);

const input = {
  redirectUri: "http://127.0.0.1:51337/callback",
  state: "state1234",
  codeChallenge: CHALLENGE,
  deviceName: "TEST-BOX",
};

maybe("daemon-auth service", () => {
  let userId = "";

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ displayName: "daemon-auth-test" })
      .returning({ id: users.id });
    userId = user!.id;
  });

  afterAll(async () => {
    if (userId) await db.delete(users).where(eq(users.id, userId));
  });

  test("creates a code row and returns a redirect carrying code and state", async () => {
    const created = await createAuthorizationCode(userId, input);
    expect(created.redirectUrl).toBe(
      "http://127.0.0.1:51337/callback?code=" + encodeURIComponent(created.code) + "&state=state1234",
    );
    const rows = await db
      .select()
      .from(daemonAuthorizationCodes)
      .where(eq(daemonAuthorizationCodes.userId, userId));
    expect(rows.length).toBe(1);
    expect(rows[0]!.tokenName).toBe("Daemon — TEST-BOX");
    expect(rows[0]!.codeHash).not.toBe(created.code);
  });

  test("exchanges a valid code for a PAT whose hash is stored", async () => {
    const created = await createAuthorizationCode(userId, input);
    const result = await exchangeAuthorizationCode(created.code, VERIFIER);
    expect(result).not.toBeNull();
    expect(result!.token.startsWith("hots_pat_")).toBe(true);
    const [row] = await db
      .select()
      .from(personalAccessTokens)
      .where(eq(personalAccessTokens.id, result!.tokenId));
    expect(row!.tokenHash).toBe(hashToken(result!.token));
    expect(row!.name).toBe("Daemon — TEST-BOX");
  });

  test("rejects a wrong verifier", async () => {
    const created = await createAuthorizationCode(userId, input);
    expect(await exchangeAuthorizationCode(created.code, "x".repeat(43))).toBeNull();
  });

  test("rejects a second exchange of the same code", async () => {
    const created = await createAuthorizationCode(userId, input);
    expect(await exchangeAuthorizationCode(created.code, VERIFIER)).not.toBeNull();
    expect(await exchangeAuthorizationCode(created.code, VERIFIER)).toBeNull();
  });

  test("rejects an unknown code", async () => {
    expect(await exchangeAuthorizationCode("unknown-code-value-1234", VERIFIER)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run docker:dev:up` then `cd apps/api && bun test src/services/daemon-auth.service.test.ts`
Expected: FAIL — the module `./daemon-auth.service` cannot be resolved.

- [ ] **Step 3: Write the implementation**

`apps/api/src/services/daemon-auth.service.ts`:

```ts
import { daemonAuthorizationCodes, db, personalAccessTokens } from "@hots-stats/db";
import { and, eq, isNull, lt } from "drizzle-orm";
import {
  buildRedirectUrl,
  generateAuthorizationCode,
  hashAuthorizationCode,
  verifyCodeChallenge,
} from "../lib/daemon-auth";
import { generatePersonalAccessToken, hashToken } from "../lib/tokens";

/** Short enough that a leaked redirect URL is almost useless. */
const CODE_TTL_MS = 60_000;
/** Consumed or expired codes are swept this long after expiring. */
const STALE_CODE_GRACE_MS = 10 * 60_000;

export interface CreateAuthorizationCodeInput {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  deviceName: string;
}

export interface CreatedAuthorizationCode {
  code: string;
  expiresAt: Date;
  redirectUrl: string;
}

export async function createAuthorizationCode(
  userId: string,
  input: CreateAuthorizationCodeInput,
): Promise<CreatedAuthorizationCode> {
  const code = generateAuthorizationCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await db.insert(daemonAuthorizationCodes).values({
    userId,
    codeHash: hashAuthorizationCode(code),
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: "S256",
    redirectUri: input.redirectUri,
    deviceName: input.deviceName,
    tokenName: "Daemon — " + input.deviceName,
    expiresAt,
  });
  return { code, expiresAt, redirectUrl: buildRedirectUrl(input.redirectUri, code, input.state) };
}

export interface ExchangedAuthorizationCode {
  token: string;
  tokenId: string;
  createdAt: Date;
  tokenName: string;
}

/**
 * Verifies PKCE, atomically consumes the code, then mints an ordinary PAT.
 * Returns null for every failure so the route can answer a single
 * invalid_grant without leaking which check failed.
 */
export async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
): Promise<ExchangedAuthorizationCode | null> {
  const [row] = await db
    .select()
    .from(daemonAuthorizationCodes)
    .where(eq(daemonAuthorizationCodes.codeHash, hashAuthorizationCode(code)))
    .limit(1);

  if (!row || row.consumedAt !== null || row.expiresAt.getTime() <= Date.now()) return null;
  if (row.codeChallengeMethod !== "S256") return null;
  if (!verifyCodeChallenge(codeVerifier, row.codeChallenge)) return null;

  const [consumed] = await db
    .update(daemonAuthorizationCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(daemonAuthorizationCodes.id, row.id), isNull(daemonAuthorizationCodes.consumedAt)))
    .returning({
      userId: daemonAuthorizationCodes.userId,
      tokenName: daemonAuthorizationCodes.tokenName,
    });
  if (!consumed) return null;

  const rawToken = generatePersonalAccessToken();
  const [created] = await db
    .insert(personalAccessTokens)
    .values({
      userId: consumed.userId,
      name: consumed.tokenName,
      tokenHash: hashToken(rawToken),
    })
    .returning({ id: personalAccessTokens.id, createdAt: personalAccessTokens.createdAt });
  if (!created) return null;

  return {
    token: rawToken,
    tokenId: created.id,
    createdAt: created.createdAt,
    tokenName: consumed.tokenName,
  };
}

/** Opportunistic sweep, called from the authorize route. */
export async function deleteStaleAuthorizationCodes(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_CODE_GRACE_MS);
  const deleted = await db
    .delete(daemonAuthorizationCodes)
    .where(lt(daemonAuthorizationCodes.expiresAt, cutoff))
    .returning({ id: daemonAuthorizationCodes.id });
  return deleted.length;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/services/daemon-auth.service.test.ts`
Expected: PASS with a database reachable; the suite is skipped (not failed) without `DATABASE_URL`.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/daemon-auth.service.ts apps/api/src/services/daemon-auth.service.test.ts
git commit -m "feat(api): add daemon authorization code service"
```

---

### Task 5: Routes, health `webOrigin`, and mounting

**Files:**
- Create: `apps/api/src/routes/daemon-auth.ts`
- Modify: `apps/api/src/routes/health.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/src/routes/health.test.ts`

**Interfaces:**
- Consumes: `authorizeInputSchema`, `tokenExchangeInputSchema`, `sanitizeDeviceName` (Task 2); `createAuthorizationCode`, `exchangeAuthorizationCode`, `deleteStaleAuthorizationCodes` (Task 4); `createFixedWindowLimiter` (Task 3); `authSession`, `requireUser` from `../middleware/auth-session`.
- Produces: mounted `POST /auth/daemon/authorize` and `POST /auth/daemon/token`; `GET /health` now returns `{ status, webOrigin }`.

- [ ] **Step 1: Write the failing test for `webOrigin`**

The route module imports `lib/env`, which parses and validates `process.env` at import time. Provide test-safe values before a dynamic import so the test does not depend on the shell environment.

`apps/api/src/routes/health.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

// lib/env validates the whole process environment at import time; supply
// test-safe values before dynamically importing anything that reaches it.
process.env.DATABASE_URL ??= "postgres://localhost:5432/hots-stats-test";
process.env.GOOGLE_CLIENT_ID ??= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-chars";
process.env.CLAUDE_INTERNAL_SECRET ??= "test-internal-secret-at-least-32-chars";

describe("GET /health", () => {
  test("reports status and the web origin", async () => {
    const { healthRoute } = await import("./health");
    const { env } = await import("../lib/env");
    const res = await healthRoute.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", webOrigin: env.WEB_ORIGIN });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && bun test src/routes/health.test.ts`
Expected: FAIL — the JSON body is `{ status: "ok" }` without `webOrigin`.

- [ ] **Step 3: Add `webOrigin` to the `/health` handler**

In `apps/api/src/routes/health.ts`, import `env` from `../lib/env` and replace the first handler only:

```ts
// BEFORE
.get("/", (c) => c.json({ status: "ok" }))

// AFTER
// webOrigin is what lets the daemon -- which holds no token yet -- open the
// right consent page for the browser handshake.
.get("/", (c) => c.json({ status: "ok", webOrigin: env.WEB_ORIGIN }))
```

Leave the `/db` handler untouched.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/api && bun test src/routes/health.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the routes**

`apps/api/src/routes/daemon-auth.ts`:

```ts
import type { User } from "@hots-stats/db";
import { Hono } from "hono";
import { authorizeInputSchema, sanitizeDeviceName, tokenExchangeInputSchema } from "../lib/daemon-auth";
import { createFixedWindowLimiter } from "../lib/rate-limit";
import { authSession, requireUser } from "../middleware/auth-session";
import {
  createAuthorizationCode,
  deleteStaleAuthorizationCodes,
  exchangeAuthorizationCode,
} from "../services/daemon-auth.service";

type Env = { Variables: { user?: User } };

const authorizeLimiter = createFixedWindowLimiter({ limit: 10, windowMs: 60_000 });
const exchangeLimiter = createFixedWindowLimiter({ limit: 20, windowMs: 300_000 });

export const daemonAuthRoute = new Hono<Env>()
  .post("/authorize", authSession, requireUser, async (c) => {
    const user = c.get("user")!;
    if (!authorizeLimiter.allow(user.id)) {
      return c.json({ error: "Too many authorization requests" }, 429);
    }

    const parsed = authorizeInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    await deleteStaleAuthorizationCodes();

    const created = await createAuthorizationCode(user.id, {
      redirectUri: parsed.data.redirectUri,
      state: parsed.data.state,
      codeChallenge: parsed.data.codeChallenge,
      deviceName: sanitizeDeviceName(parsed.data.deviceName),
    });

    return c.json(
      {
        code: created.code,
        expiresAt: created.expiresAt.toISOString(),
        redirectUrl: created.redirectUrl,
      },
      201,
    );
  })
  .post("/token", async (c) => {
    const clientKey = c.req.header("x-forwarded-for") ?? "local";
    if (!exchangeLimiter.allow(clientKey)) {
      return c.json({ error: "Too many requests" }, 429);
    }

    const parsed = tokenExchangeInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid_grant" }, 400);
    }

    const exchanged = await exchangeAuthorizationCode(parsed.data.code, parsed.data.codeVerifier);
    if (!exchanged) {
      return c.json({ error: "invalid_grant" }, 400);
    }

    return c.json(
      {
        token: exchanged.token,
        tokenId: exchanged.tokenId,
        createdAt: exchanged.createdAt.toISOString(),
        tokenName: exchanged.tokenName,
      },
      201,
    );
  });
```

- [ ] **Step 6: Mount the route**

In `apps/api/src/index.ts` add the import next to the other route imports, and register it near `app.route("/auth", authRoute)`:

```ts
import { daemonAuthRoute } from "./routes/daemon-auth";
// ...
app.route("/auth/daemon", daemonAuthRoute);
```

Registering it after `/auth` is fine: Hono matches the more specific `/auth/daemon` prefix independently.

- [ ] **Step 7: Typecheck and build**

Run: `bun run typecheck && bun run build`
Expected: PASS.

- [ ] **Step 8: Verify the rejection path by hand**

With the dev API running (`bun run dev:api`):

```bash
curl -s -X POST http://localhost:3001/auth/daemon/token -H 'content-type: application/json' -d '{"code":"unknown-code-value-1234","codeVerifier":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
```

Expected: HTTP 400 with `{"error":"invalid_grant"}`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/daemon-auth.ts apps/api/src/routes/health.ts apps/api/src/routes/health.test.ts apps/api/src/index.ts
git commit -m "feat(api): add daemon authorize and token endpoints, expose webOrigin on /health"
```

**Checkpoint A1 reached.** The API is complete and nothing calls it yet: the daemon still authenticates with a manually pasted token, so this is safe to merge and release on its own.

---

## Checkpoint A2 — Web consent flow

### Task 6: Pure consent-query helpers

**Files:**
- Create: `apps/web/app/utils/daemonAuthorization.ts`
- Test: `apps/web/app/utils/daemonAuthorization.test.ts`

**Interfaces:**
- Produces:
  - `AuthorizeParams = { redirectUri: string; state: string; codeChallenge: string; codeChallengeMethod: "S256"; deviceName: string }`
  - `ReadAuthorizeResult = { ok: true; params: AuthorizeParams } | { ok: false; reason: string }`
  - `readAuthorizeParams(query: Record<string, unknown>): ReadAuthorizeResult`
  - `isPlausibleLoopbackRedirect(raw: string): boolean`
  - `buildCancelUrl(redirectUri: string, state: string): string`

This duplicates the API's loopback rule on purpose: the web app and the API are separate bundles, and the web copy exists only to avoid showing actionable buttons for obviously invalid links. The API remains the authority.

- [ ] **Step 1: Write the failing test**

`apps/web/app/utils/daemonAuthorization.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCancelUrl, isPlausibleLoopbackRedirect, readAuthorizeParams } from "./daemonAuthorization";

const VALID = {
  redirectUri: "http://127.0.0.1:51337/callback",
  state: "state1234",
  codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  codeChallengeMethod: "S256",
  deviceName: "TEST-BOX",
};

describe("readAuthorizeParams", () => {
  it("accepts a complete query", () => {
    const result = readAuthorizeParams({ ...VALID });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params.deviceName).toBe("TEST-BOX");
  });

  it("defaults a missing device name to Daemon", () => {
    const result = readAuthorizeParams({ ...VALID, deviceName: undefined });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params.deviceName).toBe("Daemon");
  });

  it("rejects a missing state", () => {
    const result = readAuthorizeParams({ ...VALID, state: undefined });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-loopback redirect", () => {
    const result = readAuthorizeParams({ ...VALID, redirectUri: "https://example.com/callback" });
    expect(result.ok).toBe(false);
  });

  it("rejects a method other than S256", () => {
    const result = readAuthorizeParams({ ...VALID, codeChallengeMethod: "plain" });
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed code challenge", () => {
    const result = readAuthorizeParams({ ...VALID, codeChallenge: "short" });
    expect(result.ok).toBe(false);
  });
});

describe("buildCancelUrl", () => {
  it("appends access_denied and the state", () => {
    expect(buildCancelUrl("http://127.0.0.1:51337/callback", "state1234")).toBe(
      "http://127.0.0.1:51337/callback?error=access_denied&state=state1234",
    );
  });
});

describe("isPlausibleLoopbackRedirect", () => {
  it("accepts a loopback callback with a port", () => {
    expect(isPlausibleLoopbackRedirect("http://localhost:8080/callback")).toBe(true);
  });

  it("rejects a missing port and a foreign host", () => {
    expect(isPlausibleLoopbackRedirect("http://127.0.0.1/callback")).toBe(false);
    expect(isPlausibleLoopbackRedirect("http://evil.test:8080/callback")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --filter './apps/web' test app/utils/daemonAuthorization.test.ts`
Expected: FAIL — `./daemonAuthorization` cannot be resolved.

- [ ] **Step 3: Write the implementation**

`apps/web/app/utils/daemonAuthorization.ts`:

```ts
export interface AuthorizeParams {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  deviceName: string;
}

export type ReadAuthorizeResult = { ok: true; params: AuthorizeParams } | { ok: false; reason: string };

/** base64url of a SHA-256 digest: 43 characters, URL-safe alphabet. */
const BASE64URL_43_128 = /^[A-Za-z0-9_-]{43,128}$/;

/**
 * Mirrors the API's rule closely enough to hide the action buttons for a
 * link that could never work; the API still re-validates and is the
 * authority. Kept in sync by hand -- see the C1 design doc.
 */
export function isPlausibleLoopbackRedirect(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
    url.port !== "" &&
    url.pathname === "/callback" &&
    url.search === "" &&
    url.hash === ""
  );
}

export function readAuthorizeParams(query: Record<string, unknown>): ReadAuthorizeResult {
  const redirectUri = typeof query.redirectUri === "string" ? query.redirectUri : "";
  const state = typeof query.state === "string" ? query.state : "";
  const codeChallenge = typeof query.codeChallenge === "string" ? query.codeChallenge : "";
  const method = typeof query.codeChallengeMethod === "string" ? query.codeChallengeMethod : "S256";
  const rawDeviceName = typeof query.deviceName === "string" ? query.deviceName.trim() : "";
  const deviceName = rawDeviceName ? rawDeviceName.slice(0, 64) : "Daemon";

  if (!isPlausibleLoopbackRedirect(redirectUri)) {
    return { ok: false, reason: "L'adresse de redirection est invalide." };
  }
  if (state.length < 8 || state.length > 128) {
    return { ok: false, reason: "Le paramètre de sécurité (state) est invalide." };
  }
  if (!BASE64URL_43_128.test(codeChallenge)) {
    return { ok: false, reason: "Le défi PKCE est invalide." };
  }
  if (method !== "S256") {
    return { ok: false, reason: "Méthode PKCE non supportée." };
  }

  return {
    ok: true,
    params: { redirectUri, state, codeChallenge, codeChallengeMethod: "S256", deviceName },
  };
}

export function buildCancelUrl(redirectUri: string, state: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", "access_denied");
  url.searchParams.set("state", state);
  return url.toString();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --filter './apps/web' test app/utils/daemonAuthorization.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/utils/daemonAuthorization.ts apps/web/app/utils/daemonAuthorization.test.ts
git commit -m "feat(web): add daemon authorization query helpers"
```

---

### Task 7: `useDaemonAuthorization` composable

**Files:**
- Create: `apps/web/app/composables/useDaemonAuthorization.ts`

**Interfaces:**
- Consumes: `AuthorizeParams` (Task 6).
- Produces: `useDaemonAuthorization(): { authorizing: Ref<boolean>; authorize(input: AuthorizeParams): Promise<string> }` — resolves with the `redirectUrl` to navigate to.

- [ ] **Step 1: Write the composable**

It mirrors `useTokens()`'s call style (`$fetch` against `config.public.apiBase` with `credentials: "include"`).

```ts
import type { AuthorizeParams } from "~/utils/daemonAuthorization";

interface AuthorizeResponse {
  code: string;
  expiresAt: string;
  redirectUrl: string;
}

/**
 * Creates a daemon authorization code for the browser handshake and returns
 * the loopback URL the browser must navigate to next. Session-cookie auth
 * (same as useTokens); the API revalidates the PKCE challenge and the
 * redirect target before storing anything.
 */
export function useDaemonAuthorization() {
  const config = useRuntimeConfig();
  const authorizing = ref(false);

  async function authorize(input: AuthorizeParams): Promise<string> {
    authorizing.value = true;
    try {
      const res = await $fetch<AuthorizeResponse>("/auth/daemon/authorize", {
        method: "POST",
        baseURL: config.public.apiBase,
        credentials: "include",
        body: input,
      });
      return res.redirectUrl;
    } finally {
      authorizing.value = false;
    }
  }

  return { authorizing, authorize };
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run --filter './apps/web' typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/composables/useDaemonAuthorization.ts
git commit -m "feat(web): add useDaemonAuthorization composable"
```

---

### Task 8: Consent page `/daemon/authorize`

**Files:**
- Create: `apps/web/app/pages/daemon/authorize.vue`

**Interfaces:**
- Consumes: `readAuthorizeParams`, `buildCancelUrl` (Task 6), `useDaemonAuthorization` (Task 7).
- Produces: the user-visible consent screen; navigation to `redirectUrl` or to the cancel URL.

- [ ] **Step 1: Write the page**

```vue
<script setup lang="ts">
import { buildCancelUrl, readAuthorizeParams } from "~/utils/daemonAuthorization";

definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Autoriser le daemon",
  robots: "noindex, nofollow",
});

const route = useRoute();
const { authorizing, authorize } = useDaemonAuthorization();
const failure = ref<string | null>(null);

const parsed = computed(() => readAuthorizeParams(route.query as Record<string, unknown>));

async function onApprove() {
  if (!parsed.value.ok) return;
  failure.value = null;
  try {
    const redirectUrl = await authorize(parsed.value.params);
    window.location.href = redirectUrl;
  } catch {
    failure.value =
      "L'autorisation a échoué. Retourne dans le daemon et relance la connexion.";
  }
}

function onCancel() {
  if (!parsed.value.ok) return;
  window.location.href = buildCancelUrl(parsed.value.params.redirectUri, parsed.value.params.state);
}
</script>

<template>
  <div class="mx-auto max-w-lg space-y-4 rounded-lg border border-border bg-surface p-5">
    <div class="flex items-center gap-2">
      <span class="flex h-8 w-8 items-center justify-center rounded-full bg-brand/15 text-brand">
        <UIcon name="i-heroicons-shield-check" class="h-4 w-4" />
      </span>
      <h1 class="font-heading text-lg font-medium">Autoriser un daemon sur cet ordinateur</h1>
    </div>

    <template v-if="parsed.ok">
      <p class="text-sm text-muted">
        Une application locale (<span class="text-foreground">{{ parsed.params.deviceName }}</span>) demande à
        envoyer tes replays Heroes of the Storm à ton compte HotS Analytics.
      </p>

      <div class="rounded-lg bg-background/60 p-3 text-xs text-muted">
        <p>
          Destination :
          <span class="font-mono text-foreground">{{ parsed.params.redirectUri }}</span>
        </p>
        <p class="mt-1">
          N'autorise que si tu viens de cliquer sur « Connecter ce PC » dans ce daemon.
        </p>
      </div>

      <p v-if="failure" class="text-sm text-error">{{ failure }}</p>

      <div class="flex flex-col gap-2 sm:flex-row">
        <UButton block size="lg" :loading="authorizing" @click="onApprove">Autoriser ce PC</UButton>
        <UButton block size="lg" variant="soft" color="neutral" :disabled="authorizing" @click="onCancel">
          Annuler
        </UButton>
      </div>

      <p class="text-xs text-muted">
        Tu peux révoquer cet accès à tout moment depuis la liste des tokens, plus bas sur la page Upload.
      </p>
    </template>

    <template v-else>
      <p class="text-sm text-error">{{ parsed.reason }}</p>
      <p class="text-sm text-muted">
        Relance la connexion depuis le daemon : le lien qu'il ouvre n'est valable que quelques minutes.
      </p>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Verify the page by hand**

Run: `bun run dev` (API + web), sign in, then open
`http://localhost:3000/daemon/authorize?redirectUri=http://127.0.0.1:51337/callback&state=state1234&codeChallenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&codeChallengeMethod=S256&deviceName=TEST-BOX`.

Expected: the consent card appears; "Autoriser ce PC" navigates to
`http://127.0.0.1:51337/callback?code=...&state=state1234` (the browser shows a connection error there, which is correct — no listener is running yet); "Annuler" navigates to the same URL with `error=access_denied`.

- [ ] **Step 3: Typecheck**

Run: `bun run --filter './apps/web' typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/pages/daemon/authorize.vue
git commit -m "feat(web): add daemon authorization consent page"
```

---

### Task 9: Token list shows the device, onboarding copy updated

**Files:**
- Modify: `apps/api/src/routes/tokens.ts`
- Modify: `apps/web/app/composables/useTokens.ts`
- Modify: `apps/web/app/components/upload/TokenCard.vue`
- Modify: `apps/web/app/components/upload/DaemonOnboarding.vue`

**Interfaces:**
- Produces: `GET /tokens` rows gain `name`; `TokenSummary` gains `name: string`; `TokenCard` renders the device label.

- [ ] **Step 1: Return `name` from `GET /tokens`**

In `apps/api/src/routes/tokens.ts`, add `name: personalAccessTokens.name` to the `.select({ ... })` of the `GET /` handler, next to `id`, `lastUsedAt` and `createdAt`.

- [ ] **Step 2: Widen `TokenSummary`**

In `apps/web/app/composables/useTokens.ts`:

```ts
export interface TokenSummary {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
}
```

- [ ] **Step 3: Render the device label**

In `apps/web/app/components/upload/TokenCard.vue`, replace the two `<p>` elements inside the `min-w-0 flex-1` block with a stack that leads with the token name:

```vue
      <p class="truncate text-sm font-medium text-foreground">{{ token.name }}</p>
      <p class="mt-0.5 truncate font-mono text-xs" :class="revealedValue ? 'text-foreground' : 'text-muted'">
        {{ revealedValue ? maskedPreview(revealedValue) : "Clé secrète (déjà copiée)" }}
      </p>
      <p class="mt-0.5 text-xs text-muted">
        Créé le {{ formatDate(token.createdAt) }}
        <template v-if="token.lastUsedAt"> · dernière utilisation {{ formatDate(token.lastUsedAt) }}</template>
        <template v-else> · jamais utilisé</template>
      </p>
```

- [ ] **Step 4: Update the onboarding copy**

In `apps/web/app/components/upload/DaemonOnboarding.vue`: change the second button's label from `Récupérer mon token` to `Connecter mon daemon` (keep `to="/upload#token-manager"`), and add one sentence under the feature grid:

```vue
    <p class="text-xs text-muted">
      Le daemon se connecte en un clic : il ouvre cette page dans ton navigateur, tu confirmes, c'est terminé.
      Plus besoin de copier une clé à la main.
    </p>
```

- [ ] **Step 5: Typecheck and web tests**

Run: `bun run typecheck && bun run --filter './apps/web' test`
Expected: PASS.

- [ ] **Step 6: Verify by hand**

With a daemon-minted token (or any token) in the list, open `/upload`: the card shows `Daemon — <hostname>` (or the legacy `Token du ...` label for older tokens) as its primary line.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/tokens.ts apps/web/app/composables/useTokens.ts apps/web/app/components/upload/TokenCard.vue apps/web/app/components/upload/DaemonOnboarding.vue
git commit -m "feat(web): show token device name and update daemon onboarding copy"
```

**Checkpoint A2 reached.** The consent page is live and the token list is clearer; no daemon uses the flow yet, so nothing user-visible can break.

---

## Checkpoint A3 — Daemon connect button

### Task 10: `urls.py` web-origin helpers

**Files:**
- Modify: `daemon-python/src/urls.py`
- Test: `daemon-python/tests/test_urls.py`

**Interfaces:**
- Produces: `guess_web_base_url(api_base_url: str) -> str`, `daemon_authorize_url(web_base_url: str) -> str`; `guess_settings_url` keeps its current signature and behavior.

- [ ] **Step 1: Write the failing tests**

Append to `daemon-python/tests/test_urls.py`:

```python
from src.urls import daemon_authorize_url, guess_settings_url, guess_web_base_url


def test_guess_web_base_url_strips_api_dash_prefix():
    assert guess_web_base_url("https://api-hots-stats.aifedespaix.com") == "https://hots-stats.aifedespaix.com"


def test_guess_web_base_url_replaces_api_dot_prefix_with_app():
    assert guess_web_base_url("https://api.mondomaine.fr") == "https://app.mondomaine.fr"


def test_guess_web_base_url_falls_back_for_unrecognized_host():
    assert guess_web_base_url("https://example.com") == "https://hots-stats.aifedespaix.com"


def test_guess_web_base_url_falls_back_for_empty_input():
    assert guess_web_base_url("") == "https://hots-stats.aifedespaix.com"


def test_daemon_authorize_url_appends_the_path():
    assert (
        daemon_authorize_url("https://hots-stats.aifedespaix.com")
        == "https://hots-stats.aifedespaix.com/daemon/authorize"
    )
```

Replace the existing `from src.urls import guess_settings_url` line with the import shown above; the five existing `guess_settings_url` tests stay unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd daemon-python && pytest tests/test_urls.py -q`
Expected: FAIL — cannot import name guess_web_base_url.

- [ ] **Step 3: Implement the helpers**

Rewrite `daemon-python/src/urls.py`:

```python
"""Helpers for the well-known URLs the daemon needs: the API's default base
URL, the web dashboard's origin (where the browser handshake happens), and
the dashboard's Settings page (where access tokens are listed)."""

from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

DEFAULT_API_BASE_URL = "https://api-hots-stats.aifedespaix.com"
_DEFAULT_FRONTEND_ORIGIN = "https://hots-stats.aifedespaix.com"


def guess_web_base_url(api_base_url: str) -> str:
    """Best-effort guess at the web dashboard's origin from the API's base URL,
    following this deployment's api-<domain> / api.<domain> subdomain
    convention (see DEPLOYMENT.md). Falls back to the production dashboard if
    the given URL looks like neither -- good enough to open the consent page,
    and the API's own webOrigin (GET /health) is preferred when reachable.
    """
    url = api_base_url.strip()
    if not url:
        return _DEFAULT_FRONTEND_ORIGIN
    if "://" not in url:
        url = f"https://{url}"

    parts = urlsplit(url)
    host = parts.netloc
    if host.startswith("api-"):
        frontend_host = host[len("api-") :]
    elif host.startswith("api."):
        frontend_host = "app." + host[len("api.") :]
    else:
        return _DEFAULT_FRONTEND_ORIGIN

    return urlunsplit((parts.scheme, frontend_host, "", "", ""))


def guess_settings_url(api_base_url: str) -> str:
    """The dashboard page where access tokens are generated and listed."""
    return f"{guess_web_base_url(api_base_url)}/settings"


def daemon_authorize_url(web_base_url: str) -> str:
    """The consent page the browser must open for the loopback handshake."""
    return f"{web_base_url.rstrip('/')}/daemon/authorize"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd daemon-python && pytest tests/test_urls.py -q`
Expected: PASS (10 tests: the 5 original `guess_settings_url` cases plus 5 new).

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/urls.py daemon-python/tests/test_urls.py
git commit -m "feat(daemon): add web-origin and authorize URL helpers"
```

---

### Task 11: `api_client` health and token-exchange calls

**Files:**
- Modify: `daemon-python/src/api_client.py`
- Test: `daemon-python/tests/test_api_client.py`

**Interfaces:**
- Produces:
  - `fetch_web_origin(base_url: str, timeout: float = 3.0) -> str | None`
  - `post_daemon_token(base_url: str, code: str, code_verifier: str, timeout: float = 15.0) -> str | None`

Both best-effort: never raise, return `None` on any failure.

- [ ] **Step 1: Write the failing tests**

Append to `daemon-python/tests/test_api_client.py` (it already imports `requests` and `api_client`; follow its existing monkeypatch style):

```python
class _FakeResponse:
    def __init__(self, status_code: int, body: object) -> None:
        self.status_code = status_code
        self._body = body

    def json(self) -> object:
        return self._body


def test_fetch_web_origin_returns_the_advertised_origin(monkeypatch):
    monkeypatch.setattr(
        api_client.requests,
        "get",
        lambda *a, **k: _FakeResponse(200, {"status": "ok", "webOrigin": "https://web.test"}),
    )
    assert api_client.fetch_web_origin("https://api.test") == "https://web.test"


def test_fetch_web_origin_returns_none_on_failure(monkeypatch):
    def boom(*_a, **_k):
        raise api_client.requests.RequestException("down")

    monkeypatch.setattr(api_client.requests, "get", boom)
    assert api_client.fetch_web_origin("https://api.test") is None


def test_fetch_web_origin_returns_none_when_absent(monkeypatch):
    monkeypatch.setattr(
        api_client.requests, "get", lambda *a, **k: _FakeResponse(200, {"status": "ok"})
    )
    assert api_client.fetch_web_origin("https://api.test") is None


def test_post_daemon_token_sends_the_verifier_and_returns_the_token(monkeypatch):
    captured = {}

    def fake_post(url, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        return _FakeResponse(201, {"token": "hots_pat_deadbeef"})

    monkeypatch.setattr(api_client.requests, "post", fake_post)
    token = api_client.post_daemon_token("https://api.test/", "the-code", "the-verifier")
    assert token == "hots_pat_deadbeef"
    assert captured["url"] == "https://api.test/auth/daemon/token"
    assert captured["json"] == {"code": "the-code", "codeVerifier": "the-verifier"}


def test_post_daemon_token_returns_none_on_invalid_grant(monkeypatch):
    monkeypatch.setattr(
        api_client.requests, "post", lambda *a, **k: _FakeResponse(400, {"error": "invalid_grant"})
    )
    assert api_client.post_daemon_token("https://api.test", "c", "v") is None


def test_post_daemon_token_returns_none_on_network_error(monkeypatch):
    def boom(*_a, **_k):
        raise api_client.requests.RequestException("down")

    monkeypatch.setattr(api_client.requests, "post", boom)
    assert api_client.post_daemon_token("https://api.test", "c", "v") is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd daemon-python && pytest tests/test_api_client.py -q`
Expected: FAIL — module 'src.api_client' has no attribute 'fetch_web_origin'.

- [ ] **Step 3: Implement the helpers**

Append to `daemon-python/src/api_client.py`, next to the existing `ping_health`/`fetch_version` helpers:

```python
def fetch_web_origin(base_url: str, timeout: float = 3.0) -> str | None:
    """Reads the dashboard origin the API advertises on its public health
    endpoint. Used by the browser handshake, before the daemon holds any
    token (GET /ingest/version requires one, /health does not). Best-effort:
    returns None on any failure, so callers fall back to guessing."""
    try:
        response = requests.get(f"{base_url.rstrip('/')}/health", timeout=timeout)
    except requests.RequestException:
        return None
    if response.status_code != 200:
        return None
    try:
        body = response.json()
    except ValueError:
        return None
    origin = body.get("webOrigin") if isinstance(body, dict) else None
    return origin if isinstance(origin, str) and origin else None


def post_daemon_token(
    base_url: str, code: str, code_verifier: str, timeout: float = 15.0
) -> str | None:
    """Exchanges a one-time authorization code (plus its PKCE verifier) for a
    personal access token. Returns the raw token, or None on any failure --
    the caller turns that into a user-facing message, this never raises."""
    try:
        response = requests.post(
            f"{base_url.rstrip('/')}/auth/daemon/token",
            json={"code": code, "codeVerifier": code_verifier},
            timeout=timeout,
        )
    except requests.RequestException as err:
        logger.warning("Daemon token exchange failed: %s", err)
        return None

    if response.status_code != 201:
        logger.warning(
            "Daemon token exchange rejected (%d): %s", response.status_code, _safe_json(response)
        )
        return None

    try:
        token = response.json().get("token")
    except ValueError:
        return None
    return token if isinstance(token, str) and token else None
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd daemon-python && pytest tests/test_api_client.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/api_client.py daemon-python/tests/test_api_client.py
git commit -m "feat(daemon): add health webOrigin and daemon token exchange helpers"
```

---

### Task 12: `auth_flow.py` — PKCE and the loopback listener

**Files:**
- Create: `daemon-python/src/auth_flow.py`
- Test: `daemon-python/tests/test_auth_flow.py`

**Interfaces:**
- Consumes: `daemon_authorize_url`, `guess_web_base_url` (Task 10); `fetch_web_origin`, `post_daemon_token` (Task 11).
- Produces:
  - `AuthorizationResult(token: str | None = None, error: str | None = None)` (frozen dataclass)
  - `make_pkce_pair() -> tuple[str, str]`
  - `request_authorization(*, api_base_url: str, web_base_url: str | None = None, device_name: str | None = None, timeout: float = 180.0, cancel_event: threading.Event | None = None) -> AuthorizationResult`

- [ ] **Step 1: Write the failing tests**

`daemon-python/tests/test_auth_flow.py`:

```python
import threading
from urllib.parse import parse_qs, urlsplit
from urllib.request import urlopen

from src import auth_flow


def test_make_pkce_pair_matches_the_rfc7636_vector(monkeypatch):
    monkeypatch.setattr(
        auth_flow.secrets, "token_urlsafe", lambda _n: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    )
    verifier, challenge = auth_flow.make_pkce_pair()
    assert verifier == "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    assert challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


def _fake_open(behavior, captured):
    """Returns a webbrowser.open replacement that hits the loopback listener
    the same way a real browser would after the consent page redirects."""

    def _open(url):
        captured["authorize_url"] = url
        query = parse_qs(urlsplit(url).query)
        redirect_uri = query["redirectUri"][0]
        state = query["state"][0]
        target = behavior(redirect_uri, state)
        if target is not None:
            threading.Thread(target=lambda: urlopen(target, timeout=5).read(), daemon=True).start()
        return True

    return _open


def test_request_authorization_returns_the_token(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        auth_flow.webbrowser, "open", _fake_open(lambda r, s: f"{r}?code=the-code&state={s}", captured)
    )
    exchanged = {}

    def fake_exchange(api_base_url, code, verifier):
        exchanged["code"] = code
        exchanged["verifier"] = verifier
        return "hots_pat_deadbeef"

    monkeypatch.setattr(auth_flow.api_client, "post_daemon_token", fake_exchange)

    result = auth_flow.request_authorization(
        api_base_url="https://api.test", web_base_url="https://web.test", device_name="TEST-BOX"
    )

    assert result.token == "hots_pat_deadbeef"
    assert result.error is None
    assert captured["authorize_url"].startswith("https://web.test/daemon/authorize?")
    assert "deviceName=TEST-BOX" in captured["authorize_url"]
    assert "codeChallengeMethod=S256" in captured["authorize_url"]
    assert exchanged["code"] == "the-code"
    assert exchanged["verifier"]


def test_request_authorization_rejects_a_state_mismatch(monkeypatch):
    monkeypatch.setattr(
        auth_flow.webbrowser, "open", _fake_open(lambda r, _s: f"{r}?code=the-code&state=wrong1234", {})
    )
    monkeypatch.setattr(auth_flow.api_client, "post_daemon_token", lambda *a, **k: "hots_pat_x")
    result = auth_flow.request_authorization(
        api_base_url="https://api.test", web_base_url="https://web.test"
    )
    assert result.token is None
    assert result.error is not None


def test_request_authorization_reports_access_denied(monkeypatch):
    monkeypatch.setattr(
        auth_flow.webbrowser, "open", _fake_open(lambda r, s: f"{r}?error=access_denied&state={s}", {})
    )
    monkeypatch.setattr(auth_flow.api_client, "post_daemon_token", lambda *a, **k: "hots_pat_x")
    result = auth_flow.request_authorization(
        api_base_url="https://api.test", web_base_url="https://web.test"
    )
    assert result.token is None
    assert result.error is not None


def test_request_authorization_times_out_without_a_callback(monkeypatch):
    monkeypatch.setattr(auth_flow.webbrowser, "open", _fake_open(lambda r, s: None, {}))
    result = auth_flow.request_authorization(
        api_base_url="https://api.test", web_base_url="https://web.test", timeout=0.3
    )
    assert result.token is None
    assert result.error is not None


def test_request_authorization_honours_a_pre_set_cancel_event(monkeypatch):
    monkeypatch.setattr(auth_flow.webbrowser, "open", _fake_open(lambda r, s: None, {}))
    cancel = threading.Event()
    cancel.set()
    result = auth_flow.request_authorization(
        api_base_url="https://api.test",
        web_base_url="https://web.test",
        timeout=10.0,
        cancel_event=cancel,
    )
    assert result.token is None
    assert result.error is not None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd daemon-python && pytest tests/test_auth_flow.py -q`
Expected: FAIL — No module named 'src.auth_flow'.

- [ ] **Step 3: Write the implementation**

`daemon-python/src/auth_flow.py`:

```python
"""Browser-based authorization for the daemon: RFC 7636 PKCE plus a one-shot
loopback HTTP listener.

The daemon opens the web dashboard's consent page in the user's browser; the
browser (already signed in) authorizes this machine and is redirected to the
loopback listener with a short-lived, single-use code; the daemon exchanges
that code plus its PKCE verifier for an ordinary personal access token. See
docs/superpowers/specs/2026-09-18-daemon-browser-auth-design.md.
"""

from __future__ import annotations

import base64
import hashlib
import http.server
import logging
import secrets
import threading
import time
import webbrowser
from dataclasses import dataclass
from urllib.parse import parse_qs, urlencode, urlsplit

from . import api_client
from .urls import daemon_authorize_url, guess_web_base_url

logger = logging.getLogger(__name__)

_CALLBACK_PATH = "/callback"
_POLL_SECONDS = 0.2
_SUCCESS_HTML = (
    "<!doctype html><html lang='fr'><head><meta charset='utf-8'>"
    "<title>HotS Analytics</title></head>"
    "<body style='font-family:Segoe UI,sans-serif;background:#1c1f2e;color:#e8eaf6;"
    "display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>"
    "<div style='text-align:center'><h1 style='font-size:20px'>Daemon connecte</h1>"
    "<p style='color:#8b90ad'>Tu peux fermer cet onglet et revenir au daemon.</p>"
    "</div></body></html>"
).encode("utf-8")


@dataclass(frozen=True)
class AuthorizationResult:
    token: str | None = None
    error: str | None = None


def make_pkce_pair() -> tuple[str, str]:
    """Returns (code_verifier, code_challenge) per RFC 7636 S256."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def _make_handler(received: dict[str, str], done: threading.Event):
    class _Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 -- http.server's API
            parts = urlsplit(self.path)
            if parts.path != _CALLBACK_PATH:
                self.send_response(404)
                self.end_headers()
                return

            query = parse_qs(parts.query)
            for key in ("code", "state", "error"):
                values = query.get(key)
                if values:
                    received[key] = values[0]

            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(_SUCCESS_HTML)))
            self.end_headers()
            self.wfile.write(_SUCCESS_HTML)
            done.set()

        def log_message(self, *_args) -> None:
            """Keeps the daemon's console free of one-shot HTTP noise."""

    return _Handler


def request_authorization(
    *,
    api_base_url: str,
    web_base_url: str | None = None,
    device_name: str | None = None,
    timeout: float = 180.0,
    cancel_event: threading.Event | None = None,
) -> AuthorizationResult:
    """Runs the whole handshake. Never raises and never blocks a Tk thread for
    longer than the timeout; every failure is an AuthorizationResult whose
    error holds a ready-to-display French message."""
    verifier, challenge = make_pkce_pair()
    state = secrets.token_urlsafe(16)
    received: dict[str, str] = {}
    done = threading.Event()

    try:
        server = http.server.HTTPServer(("127.0.0.1", 0), _make_handler(received, done))
    except OSError as err:
        logger.warning("Could not bind the loopback authorization listener: %s", err)
        return AuthorizationResult(error="Impossible d'ouvrir le port local pour la connexion.")

    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, name="hots-auth-callback", daemon=True).start()

    base = (
        web_base_url or api_client.fetch_web_origin(api_base_url) or guess_web_base_url(api_base_url)
    )
    params = {
        "redirectUri": f"http://127.0.0.1:{port}{_CALLBACK_PATH}",
        "state": state,
        "codeChallenge": challenge,
        "codeChallengeMethod": "S256",
    }
    if device_name:
        params["deviceName"] = device_name
    authorize_url = f"{daemon_authorize_url(base)}?{urlencode(params)}"

    try:
        webbrowser.open(authorize_url)
    except Exception:  # noqa: BLE001 -- webbrowser can raise anything at all
        logger.debug("webbrowser.open failed", exc_info=True)

    try:
        deadline = time.monotonic() + timeout
        while not done.is_set():
            if cancel_event is not None and cancel_event.is_set():
                return AuthorizationResult(error="Connexion annulée.")
            if time.monotonic() >= deadline:
                return AuthorizationResult(error="Délai dépassé. Réessaie la connexion.")
            done.wait(_POLL_SECONDS)
    finally:
        server.shutdown()
        server.server_close()

    if received.get("state") != state:
        return AuthorizationResult(error="Réponse d'autorisation invalide. Réessaie la connexion.")
    if received.get("error"):
        return AuthorizationResult(error="Autorisation refusée dans le navigateur.")
    code = received.get("code")
    if not code:
        return AuthorizationResult(error="Réponse d'autorisation incomplète.")

    token = api_client.post_daemon_token(api_base_url, code, verifier)
    if not token:
        return AuthorizationResult(error="Le serveur a refusé l'échange du code d'autorisation.")
    return AuthorizationResult(token=token)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd daemon-python && pytest tests/test_auth_flow.py -q`
Expected: PASS (6 tests). The timeout and cancel cases finish in well under a second.

- [ ] **Step 5: Run the full daemon suite**

Run: `cd daemon-python && pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add daemon-python/src/auth_flow.py daemon-python/tests/test_auth_flow.py
git commit -m "feat(daemon): add browser authorization flow with PKCE loopback listener"
```

---

### Task 13: Settings-window "Connecter ce PC" button

**Files:**
- Modify: `daemon-python/src/gui.py`

**Interfaces:**
- Consumes: `auth_flow.request_authorization` (Task 12).
- Produces: a `Connecter ce PC via le navigateur` primary button in the Connexion section, a status line, and a cancel path when the window closes.

- [ ] **Step 1: Import the module**

At the top of `daemon-python/src/gui.py`, add `auth_flow` to the existing relative import block:

```python
from . import api_client, auth_flow, autostart, draft_capture, hotkey, updater
```

- [ ] **Step 2: Add the button and status to the Connexion section**

In `_build_connexion_section`, immediately before the first `_build_field` call, insert the connect row:

```python
        connect_row = ttk.Frame(inner, style="Panel.TFrame")
        connect_row.grid(row=1, column=0, columnspan=3, sticky="w", pady=(0, 4))

        self._connect_button = ttk.Button(
            connect_row,
            text="Connecter ce PC via le navigateur",
            style="Accent.TButton",
            command=self._connect_via_browser,
        )
        self._connect_button.pack(side="left")

        self._connect_status = ttk.Label(
            inner,
            text="",
            style="PanelMuted.TLabel",
            wraplength=_LABEL_WRAPLENGTH,
            justify="left",
        )
        self._connect_status.grid(row=2, column=0, columnspan=3, sticky="w", pady=(0, 12))
```

Then change the first two `_build_field` calls to start at row `3` instead of row `1` (pass `start_row=3`), leaving the token field and its management link in place below the connect button for now. C2 later moves the token field into an "Avancé" disclosure.

- [ ] **Step 3: Initialise the connect state**

In `_SettingsWindow.__init__`, alongside the other job/state fields, add:

```python
        self._connect_busy = False
        self._auth_cancel = threading.Event()
```

- [ ] **Step 4: Implement the connect action**

Add these three methods to `_SettingsWindow`, next to `_check_connection`:

```python
    def _connect_via_browser(self) -> None:
        """Starts the loopback browser handshake on a worker thread. The Tk
        thread only ever starts it and renders its result (see
        _after_if_open), matching this module's threading contract."""
        if self._connect_busy:
            return
        self._connect_busy = True
        self._auth_cancel = threading.Event()
        self._connect_button.configure(state="disabled")
        self._set_status(self._connect_status, "Ouverture du navigateur…", _NEUTRAL)
        threading.Thread(
            target=self._connect_worker, name="hots-browser-auth", daemon=True
        ).start()

    def _connect_worker(self) -> None:
        result = auth_flow.request_authorization(
            api_base_url=self._api_var.get().strip(),
            cancel_event=self._auth_cancel,
        )
        self._after_if_open(self._finish_connect, result)

    def _finish_connect(self, result: auth_flow.AuthorizationResult) -> None:
        self._connect_busy = False
        self._connect_button.configure(state="normal")
        if result.token:
            # Fill the field and reuse the existing debounced check, so the
            # user sees the token turn green before saving.
            self._token_var.set(result.token)
            self._set_status(self._connect_status, "✓ Connecté. Vérification du token…", _OK)
            self._on_api_or_token_changed()
        else:
            self._set_status(
                self._connect_status, f"✗ {result.error or 'Échec de la connexion.'}", _ERROR
            )
```

- [ ] **Step 5: Cancel a pending handshake on close**

In `_on_close`, before the existing teardown, add:

```python
        self._auth_cancel.set()
```

This releases the loopback listener's wait loop immediately instead of leaving the worker blocked for up to the full timeout.

- [ ] **Step 6: Verify by hand**

Run `python -m src.main` from `daemon-python/` with a valid API base URL (the field pre-fills `https://api-hots-stats.aifedespaix.com`).

Confirm, in order: the browser opens the consent page; "Autoriser ce PC" returns to a local page reading "Daemon connecte"; the daemon window shows a success line then a green token status; the token appears with a `Daemon — <hostname>` name in the web token list. Then repeat with "Annuler" on the consent page and confirm the window shows the refusal message.

- [ ] **Step 7: Commit**

```bash
git add daemon-python/src/gui.py
git commit -m "feat(daemon): add one-click browser authorization to the settings window"
```

**Checkpoint A3 reached — feature complete.** The daemon can now be connected from the settings window with one browser confirmation; manual token entry remains available as the fallback path.

---

## Self-review

**Spec coverage.** Every section of `2026-09-18-daemon-browser-auth-design.md` maps to a task:

- Table `daemon_authorization_codes` -> Task 1.
- Accepted loopback hijack risk / loopback-only rule / PKCE S256 -> Tasks 2 and 6 (both sides validate).
- `GET /health` `webOrigin` -> Task 5.
- `POST /auth/daemon/authorize` and `POST /auth/daemon/token` -> Tasks 4 and 5.
- Rate limiting (`lib/rate-limit.ts`) -> Task 3, applied in Task 5.
- Consent page and client-side validation -> Tasks 6, 7, 8.
- Token list showing the device name -> Task 9.
- `urls.py` `guess_web_base_url` / `daemon_authorize_url` -> Task 10.
- `api_client` `fetch_web_origin` / `post_daemon_token` -> Task 11.
- `auth_flow.py` PKCE + loopback receiver + cancellation -> Task 12.
- Connexion-section button, status, cancel-on-close, manual fallback retained -> Task 13.
- Onboarding copy -> Task 9.
- Decision 6 (persist through the normal Save path) -> Task 13 Step 4 fills the token field and reuses the existing debounced check instead of writing config directly.

**Placeholder scan.** No `TBD`, `TODO`, "implement later", "add error handling" or "similar to Task N" remains. Every code step carries its full code; the two places where a whole file is not reproduced (the `/db` handler in `health.ts`, the surrounding `TokenCard` markup) state the exact anchor to edit.

**Type consistency.** Names are consistent across tasks: `AuthorizationResult`, `make_pkce_pair`, `request_authorization` (daemon); `isLoopbackRedirectUri`, `deriveCodeChallenge`, `verifyCodeChallenge`, `generateAuthorizationCode`, `hashAuthorizationCode`, `buildRedirectUrl`, `buildCancelRedirectUrl`, `sanitizeDeviceName` (API lib); `createAuthorizationCode`, `exchangeAuthorizationCode`, `deleteStaleAuthorizationCodes` (service); `readAuthorizeParams`, `buildCancelUrl`, `isPlausibleLoopbackRedirect`, `AuthorizeParams` (web); `fetch_web_origin`, `post_daemon_token` (daemon client). The API's `authorizeInputSchema` fields (`redirectUri`, `state`, `codeChallenge`, `codeChallengeMethod`, `deviceName`) match exactly what the web `useDaemonAuthorization` sends as its body.

**Known duplication, deliberate.** The loopback rule exists in both `apps/api/src/lib/daemon-auth.ts` and `apps/web/app/utils/daemonAuthorization.ts`. They are separate bundles; the web copy only hides buttons for links that could not work, and the API re-validates as the authority.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-18-daemon-browser-auth.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration (requires `superpowers:subagent-driven-development`).
2. **Inline Execution** — execute tasks in this session with checkpoints (requires `superpowers:executing-plans`).

Whichever is chosen, the session prompt is the one in `docs/superpowers/specs/2026-09-18-daemon-platform-roadmap-design.md` under `Clean-session execution prompt`, with `<ID> = C1`, `<SPEC_DU_CHANTIER> = 2026-09-18-daemon-browser-auth-design.md`, `<PLAN_DU_CHANTIER> = 2026-09-18-daemon-browser-auth.md` and `<BRANCHE> = feat/daemon-browser-auth`.





