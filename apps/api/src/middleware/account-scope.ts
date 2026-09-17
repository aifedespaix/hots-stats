import type { User } from "@hots-stats/db";
import { createMiddleware } from "hono/factory";
import { type Scope, ScopeError, resolveScope } from "../lib/account-scope";

type Env = { Variables: { user: User; scope: Scope } };

/**
 * Resolves `?accounts=` once per request and exposes it as `c.get("scope")`.
 * Mount after authSession/requireUser on every personal route group. Absent
 * parameter means "all accounts linked to this user"; a tag the user does not
 * own is a 400 (see intersectSelection).
 */
export const accountScope = createMiddleware<Env>(async (c, next) => {
  const user = c.get("user");
  try {
    c.set("scope", await resolveScope(user.id, c.req.query("accounts")));
  } catch (err) {
    if (err instanceof ScopeError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }
  await next();
});
