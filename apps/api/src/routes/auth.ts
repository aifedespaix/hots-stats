import { type User, db, users } from "@hots-stats/db";
import { heroStatsScopeSchema } from "@hots-stats/shared-types";
import { generateCodeVerifier, generateState } from "arctic";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { env } from "../lib/env";
import { battlenet, battlenetEnabled, google } from "../lib/oauth";
import { SESSION_COOKIE_MAX_AGE, SESSION_COOKIE_NAME, createSessionToken } from "../lib/session";
import { authSession, requireUser } from "../middleware/auth-session";
import { authToken } from "../middleware/auth-token";
import { resetUserData } from "../services/data-reset.service";

const OAUTH_STATE_COOKIE = "hots_oauth_state";
const OAUTH_VERIFIER_COOKIE = "hots_oauth_verifier";
const OAUTH_COOKIE_MAX_AGE = 600; // 10 minutes, just long enough for the OAuth round trip

const oauthCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "Lax" as const,
  path: "/",
};

function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    battletag: user.battletag,
    publicHandle: user.publicHandle,
    heroStatsScope: user.heroStatsScope,
  };
}

const updateMeSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "2 caractères minimum")
    .max(24, "24 caractères maximum")
    .optional(),
  battletag: z
    .string()
    .regex(/^.{2,24}#\d{4,10}$/, "Format attendu : Pseudo#12345")
    .optional(),
  publicHandle: z
    .string()
    .regex(/^[a-z0-9-]{3,32}$/, "3 à 32 caractères : lettres minuscules, chiffres, tirets")
    .optional(),
  heroStatsScope: heroStatsScopeSchema.optional(),
});

interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

// Battle.net's OAuth userinfo (https://oauth.battle.net/userinfo) is far
// terser than Google's OIDC one -- no email, no avatar, just enough to
// identify the account.
interface BattleNetUserInfo {
  sub: string;
  id: number;
  battletag: string;
}

// Google's real name is never used as the account's public-facing pseudo -
// we seed a neutral placeholder instead and let the user pick their own.
function generateDefaultPseudo(): string {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `Joueur${suffix}`;
}

// Unlike Google's name, a BattleTag is already the account's public gaming
// handle, so it doubles as a reasonable default pseudo -- just the name part
// before the "#NNNN" discriminator.
function defaultDisplayNameFromBattleTag(battletag: string): string {
  const name = battletag.split("#")[0]?.trim();
  return name && name.length >= 2 && name.length <= 24 ? name : generateDefaultPseudo();
}

async function isBattleTagTaken(battletag: string): Promise<boolean> {
  const [conflicting] = await db.select({ id: users.id }).from(users).where(eq(users.battletag, battletag)).limit(1);
  return Boolean(conflicting);
}

export const authRoute = new Hono()
  .get("/google", (c) => {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const url = google.createAuthorizationURL(state, codeVerifier, ["openid", "email", "profile"]);

    setCookie(c, OAUTH_STATE_COOKIE, state, { ...oauthCookieOptions, maxAge: OAUTH_COOKIE_MAX_AGE });
    setCookie(c, OAUTH_VERIFIER_COOKIE, codeVerifier, {
      ...oauthCookieOptions,
      maxAge: OAUTH_COOKIE_MAX_AGE,
    });

    return c.redirect(url.toString());
  })
  .get("/google/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const storedState = getCookie(c, OAUTH_STATE_COOKIE);
    const codeVerifier = getCookie(c, OAUTH_VERIFIER_COOKIE);

    deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/" });
    deleteCookie(c, OAUTH_VERIFIER_COOKIE, { path: "/" });

    if (!code || !state || !storedState || state !== storedState || !codeVerifier) {
      return c.json({ error: "Invalid OAuth state" }, 400);
    }

    const tokens = await google.validateAuthorizationCode(code, codeVerifier);
    const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.accessToken()}` },
    });
    if (!userInfoResponse.ok) {
      return c.json({ error: "Failed to fetch Google profile" }, 502);
    }
    const googleUser = (await userInfoResponse.json()) as GoogleUserInfo;

    const [existing] = await db.select().from(users).where(eq(users.googleId, googleUser.sub)).limit(1);

    const user =
      existing ??
      (
        await db
          .insert(users)
          .values({
            googleId: googleUser.sub,
            email: googleUser.email,
            displayName: generateDefaultPseudo(),
            avatarUrl: googleUser.picture,
          })
          .returning()
      )[0];

    if (!user) {
      return c.json({ error: "Failed to create user" }, 500);
    }

    const sessionToken = await createSessionToken(user.id);
    setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE,
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    });

    return c.redirect(env.WEB_ORIGIN);
  })
  .get("/battlenet", (c) => {
    if (!battlenet) {
      return c.json({ error: "Battle.net login is not configured on this server" }, 404);
    }

    const state = generateState();
    const url = battlenet.createAuthorizationURL(state);

    setCookie(c, OAUTH_STATE_COOKIE, state, { ...oauthCookieOptions, maxAge: OAUTH_COOKIE_MAX_AGE });

    return c.redirect(url.toString());
  })
  .get("/battlenet/callback", async (c) => {
    if (!battlenet) {
      return c.json({ error: "Battle.net login is not configured on this server" }, 404);
    }

    const code = c.req.query("code");
    const state = c.req.query("state");
    const storedState = getCookie(c, OAUTH_STATE_COOKIE);

    deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/" });

    // No PKCE cookie to check here -- Battle.net's OAuth doesn't support it
    // (see lib/oauth.ts), so `state` is the only CSRF guard for this flow.
    if (!code || !state || !storedState || state !== storedState) {
      return c.json({ error: "Invalid OAuth state" }, 400);
    }

    const tokens = await battlenet.validateAuthorizationCode(code);
    const userInfoResponse = await fetch("https://oauth.battle.net/userinfo", {
      headers: { Authorization: `Bearer ${tokens.accessToken()}` },
    });
    if (!userInfoResponse.ok) {
      return c.json({ error: "Failed to fetch Battle.net profile" }, 502);
    }
    const battlenetUser = (await userInfoResponse.json()) as BattleNetUserInfo;
    const battlenetId = String(battlenetUser.id);

    const [existing] = await db.select().from(users).where(eq(users.battlenetId, battlenetId)).limit(1);

    let user = existing;
    if (!user) {
      // A Google account may already have self-reported this exact tag by
      // hand (see PATCH /me below, which doesn't verify Blizzard ownership)
      // -- don't let that block the real owner's signup, just skip the
      // auto-fill and let them claim it manually from Settings instead.
      const battletagTaken = await isBattleTagTaken(battlenetUser.battletag);

      [user] = await db
        .insert(users)
        .values({
          battlenetId,
          displayName: defaultDisplayNameFromBattleTag(battlenetUser.battletag),
          battletag: battletagTaken ? null : battlenetUser.battletag,
        })
        .returning();
    } else if (!user.battletag && !(await isBattleTagTaken(battlenetUser.battletag))) {
      // Retry the auto-fill skipped at signup (see above) on every login
      // where it's still empty, in case the conflicting account has since
      // freed it up. Never overwrites a battletag that's already set, auto-
      // filled or hand-edited in Settings alike.
      [user] = await db
        .update(users)
        .set({ battletag: battlenetUser.battletag, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
    }

    if (!user) {
      return c.json({ error: "Failed to create user" }, 500);
    }

    const sessionToken = await createSessionToken(user.id);
    setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE,
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    });

    return c.redirect(env.WEB_ORIGIN);
  })
  // Tells the frontend which login buttons to show (see /login) without
  // leaking whether specific secrets are set.
  .get("/providers", (c) => c.json({ google: true, battlenet: battlenetEnabled }))
  .post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE_NAME, {
      path: "/",
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    });
    return c.json({ status: "ok" });
  })
  .get("/me", authSession, (c) => {
    const user = c.get("user");
    return c.json({ user: user ? toPublicUser(user) : null });
  })
  .patch("/me", authSession, requireUser, async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const parsed = updateMeSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    if (parsed.data.battletag) {
      const conflicting = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.battletag, parsed.data.battletag))
        .limit(1);
      if (conflicting[0] && conflicting[0].id !== user.id) {
        return c.json({ error: "Ce BattleTag est déjà lié à un autre compte" }, 409);
      }
    }

    if (parsed.data.publicHandle) {
      const conflicting = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.publicHandle, parsed.data.publicHandle))
        .limit(1);
      if (conflicting[0] && conflicting[0].id !== user.id) {
        return c.json({ error: "Ce nom public est déjà pris" }, 409);
      }
    }

    const [updated] = await db
      .update(users)
      .set({
        ...(parsed.data.displayName ? { displayName: parsed.data.displayName } : {}),
        ...(parsed.data.battletag ? { battletag: parsed.data.battletag } : {}),
        ...(parsed.data.publicHandle ? { publicHandle: parsed.data.publicHandle } : {}),
        ...(parsed.data.heroStatsScope ? { heroStatsScope: parsed.data.heroStatsScope } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    return c.json({ user: updated ? toPublicUser(updated) : null });
  })
  // Lets the daemon confirm its configured token is valid before it starts watching replays.
  .get("/verify-token", authToken, (c) => {
    const user = c.get("user");
    return c.json({ user: toPublicUser(user) });
  })
  // "Zone dangereuse" of the Settings page: deletes every match this account
  // uploaded and stamps `dataResetAt` so the daemon (see GET /ingest/version)
  // knows to forget its local sync state and re-upload everything from the
  // `.StormReplay` files still on disk -- the escape hatch for corrupted
  // history left over from a since-fixed parser bug.
  .post("/me/reset-data", authSession, requireUser, async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { deletedMatches, dataResetAt } = await resetUserData(user.id);
    return c.json({ deletedMatches, dataResetAt: dataResetAt.toISOString() });
  });
