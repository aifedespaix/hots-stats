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
