import type { User } from "@hots-stats/db";
import { heroStatsScopeSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { z } from "zod";
import { authSession, requireUser } from "../middleware/auth-session";
import { getStatsSummary } from "../services/stats.service";

type Env = { Variables: { user: User } };

const summaryQuerySchema = z.object({ scope: heroStatsScopeSchema.optional() });

export const statsRoute = new Hono<Env>().use("*", authSession, requireUser).get("/summary", async (c) => {
  const user = c.get("user");
  const parsed = summaryQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const scope = parsed.data.scope ?? user.heroStatsScope;
  return c.json(await getStatsSummary(user.id, scope));
});
