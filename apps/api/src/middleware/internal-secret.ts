import { timingSafeEqual } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { env } from "../lib/env";

/**
 * Guards `/_internal/*` routes (debugging/tooling endpoints, not the
 * daemon or the web app) via `Authorization: Bearer <CLAUDE_INTERNAL_SECRET>`.
 * Deliberately separate from `authToken`/`authSession`: there's no user
 * account behind this, just a single shared secret held by whoever runs
 * `bun run check-build` or inspects quarantined replays.
 */
export const internalSecret = createMiddleware(async (c, next) => {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  const expected = Buffer.from(env.CLAUDE_INTERNAL_SECRET);
  const actual = Buffer.from(token ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});
