import type { User } from "@hots-stats/db";
import { heroStatsScopeSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { z } from "zod";
import type { Scope } from "../lib/account-selection";
import { accountsQuerySchema, withStatsScope } from "../lib/account-selection";
import { gameModeListSchema } from "../lib/query";
import { accountScope } from "../middleware/account-scope";
import { authSession, requireUser } from "../middleware/auth-session";
import { getPatterns } from "../services/patterns.service";
import { getStatsSummary } from "../services/stats.service";

type Env = { Variables: { user: User; scope: Scope } };

const summaryQuerySchema = z.object({
  scope: heroStatsScopeSchema.optional(),
  accounts: accountsQuerySchema,
  mode: gameModeListSchema.optional(),
});

const patternsQuerySchema = z.object({
  scope: heroStatsScopeSchema.optional(),
  accounts: accountsQuerySchema,
  mode: gameModeListSchema.optional(),
  heroId: z.string().optional(),
  mapId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const statsRoute = new Hono<Env>()
  .use("*", authSession, requireUser, accountScope)
  .get("/summary", async (c) => {
    const user = c.get("user");
    const parsed = summaryQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const scope = withStatsScope(c.get("scope"), parsed.data.scope, user.heroStatsScope);
    return c.json(await getStatsSummary(scope, parsed.data.mode));
  })
  .get("/patterns", async (c) => {
    const parsed = patternsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    // Combat patterns are inherently personal: there is no coherent subject
    // row to aggregate over the whole community, so an explicit global scope
    // is refused instead of silently returning an empty or invented series.
    // An omitted scope always falls back to the caller's own accounts.
    const scope = withStatsScope(c.get("scope"), parsed.data.scope ?? "personal");
    if (scope.mode === "global") {
      return c.json(
        { error: "Les patterns de combat ne sont disponibles que pour ton profil (scope=personal)." },
        400,
      );
    }

    return c.json(
      await getPatterns(scope, {
        mode: parsed.data.mode,
        heroId: parsed.data.heroId,
        mapId: parsed.data.mapId,
        from: parsed.data.from,
        to: parsed.data.to,
      }),
    );
  });
