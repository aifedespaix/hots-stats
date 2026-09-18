import type { User } from "@hots-stats/db";
import { DEFAULT_TREND_WINDOW, heroStatsScopeSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { z } from "zod";
import type { Scope } from "../lib/account-selection";
import { accountsQuerySchema, withStatsScope } from "../lib/account-selection";
import { gameModeListSchema, gameVersionListSchema } from "../lib/query";
import { accountScope } from "../middleware/account-scope";
import { authSession, requireUser } from "../middleware/auth-session";
import { getDrivers } from "../services/drivers.service";
import { getPatterns } from "../services/patterns.service";
import { getStatsSummary } from "../services/stats.service";
import { getTrend } from "../services/trend.service";

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

const trendQuerySchema = z.object({
  scope: heroStatsScopeSchema.optional(),
  accounts: accountsQuerySchema,
  mode: gameModeListSchema.optional(),
  heroId: z.string().optional(),
  mapId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  gameVersion: gameVersionListSchema.optional(),
  window: z.coerce.number().int().min(1).max(200).default(DEFAULT_TREND_WINDOW),
  compareTo: z.string().datetime().optional(),
});

const driversQuerySchema = z.object({
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
  })
  .get("/trend", async (c) => {
    const parsed = trendQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    // "Am I improving?" only has a coherent subject when it is the caller's own
    // player row; a community-wide trend has no subject row to roll up, so an
    // explicit global scope is refused rather than faked (same rule as
    // /patterns). An omitted scope always falls back to the caller's accounts.
    const scope = withStatsScope(c.get("scope"), parsed.data.scope ?? "personal");
    if (scope.mode === "global") {
      return c.json(
        { error: "La tendance n'est disponible que pour ton profil (scope=personal)." },
        400,
      );
    }

    return c.json(await getTrend(scope, parsed.data));
  })
  .get("/drivers", async (c) => {
    const parsed = driversQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    // "Which of my stats correlate with my wins?" has no coherent community
    // subject, so an explicit global scope is refused rather than faked (same
    // rule as /patterns and /trend). An omitted scope always falls back to the
    // caller's accounts.
    const scope = withStatsScope(c.get("scope"), parsed.data.scope ?? "personal");
    if (scope.mode === "global") {
      return c.json(
        { error: "Les facteurs de victoire ne sont disponibles que pour ton profil (scope=personal)." },
        400,
      );
    }

    return c.json(
      await getDrivers(scope, {
        mode: parsed.data.mode,
        heroId: parsed.data.heroId,
        mapId: parsed.data.mapId,
        from: parsed.data.from,
        to: parsed.data.to,
      }),
    );
  });
