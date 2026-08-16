import type { User } from "@hots-stats/db";
import { createMiddleware } from "hono/factory";

type Env = { Variables: { user?: User } };

/** Rejects with 403 unless `authSession` attached an admin user upstream. Chain after `requireUser`. */
export const requireAdmin = createMiddleware<Env>(async (c, next) => {
  const user = c.get("user");
  if (!user || user.role !== "admin") {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
});
