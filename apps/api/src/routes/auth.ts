import { type User, db, users } from "@hots-stats/db";
import { generateCodeVerifier, generateState } from "arctic";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { env } from "../lib/env";
import { google } from "../lib/oauth";
import { SESSION_COOKIE_MAX_AGE, SESSION_COOKIE_NAME, createSessionToken } from "../lib/session";
import { authSession, requireUser } from "../middleware/auth-session";
import { authToken } from "../middleware/auth-token";

const OAUTH_STATE_COOKIE = "hots_oauth_state";
const OAUTH_VERIFIER_COOKIE = "hots_oauth_verifier";
const OAUTH_COOKIE_MAX_AGE = 600; // 10 minutes, just long enough for the Google round trip

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
});

interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

// Google's real name is never used as the account's public-facing pseudo -
// we seed a neutral placeholder instead and let the user pick their own.
function generateDefaultPseudo(): string {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `Joueur${suffix}`;
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
  });
