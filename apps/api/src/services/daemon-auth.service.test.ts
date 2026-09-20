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
