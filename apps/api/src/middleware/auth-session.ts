import { type User, db, users } from "@hots-stats/db";
import { eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../lib/session";

type Env = { Variables: { user?: User } };

/** Attaches the current user from the session cookie, if any. Never rejects the request. */
export const authSession = createMiddleware<Env>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (token) {
    const userId = await verifySessionToken(token);
    if (userId) {
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (user) c.set("user", user);
    }
  }
  await next();
});

/** Rejects with 401 unless `authSession` already attached a user upstream. */
export const requireUser = createMiddleware<Env>(async (c, next) => {
  if (!c.get("user")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});
