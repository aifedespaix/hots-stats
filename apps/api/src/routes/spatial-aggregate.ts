import type { User } from "@hots-stats/db";
import { heroStatsScopeSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { z } from "zod";
import { type Scope, accountsQuerySchema, withStatsScope } from "../lib/account-selection";
import { accountScope } from "../middleware/account-scope";
import { authSession, requireUser } from "../middleware/auth-session";
import { getDeathMap } from "../services/death-map.service";
import { getSpatialAggregate } from "../services/spatial-aggregate.service";

type Env = { Variables: { user: User; scope: Scope } };

const deathMapQuerySchema = z.object({
  mapId: z.string().min(1),
  heroId: z.string().optional(),
  layer: z.string().optional(),
  scope: heroStatsScopeSchema.optional(),
  accounts: accountsQuerySchema,
});

const heroRoleSchema = z.enum(["Tank", "Bruiser", "RangedAssassin", "MeleeAssassin", "Healer", "Support"]);

const aggregateQuerySchema = z
  .object({
    mapId: z.string().min(1),
    layer: z.string().optional(),
    heroId: z.string().optional(),
    role: heroRoleSchema.optional(),
    battletag: z.string().optional(),
    // Query params arrive as strings; only "true" opts into the global Slot.
    global: z
      .string()
      .optional()
      .transform((v) => v === "true"),
    outcome: z.enum(["win", "loss", "all"]).default("all"),
  })
  .refine((v) => Boolean(v.heroId) !== Boolean(v.role), {
    message: "Exactly one of heroId or role is required",
  })
  .refine((v) => Boolean(v.battletag) !== v.global, {
    message: "Exactly one of battletag or global=true is required",
  });

/**
 * Web-facing spatial reads: the aggregated death map (C1) and a History
 * Slot's combined grid. Session-authed like the rest of the dashboard, not
 * the daemon's Bearer-PAT routes in routes/spatial.ts.
 *
 * The auth middleware is applied PER ROUTE, never via use("*"). Hono mounts a
 * sub-app's wildcard middleware on the parent for the whole mount prefix, so
 * a use("*") here would 401 the daemon's /spatial/calibrations and /samples
 * routes -- and routes/spatial.ts's own use("*") would just as surely 401
 * these dashboard routes if it ran first. index.ts therefore mounts this
 * router BEFORE routes/spatial.ts: its exact routes win, and the daemon's
 * wildcard remains the fallback that guards its own paths. One pre-existing
 * consequence of the two wildcards was that /spatial/aggregate was
 * unreachable from the browser; the per-route middleware here restores it.
 */
export const spatialAggregateRoute = new Hono<Env>()
  .get("/death-map", authSession, requireUser, accountScope, async (c) => {
    const parsed = deathMapQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    // "Ou est-ce que je meurs ?" is personal by default; an omitted scope
    // falls back to the caller's own accounts. scope=global is allowed and
    // produces the community heatmap, exactly like /spatial/aggregate's
    // global Slot.
    const scope = withStatsScope(c.get("scope"), parsed.data.scope);
    const result = await getDeathMap(scope, parsed.data.mapId, {
      heroId: parsed.data.heroId,
      layer: parsed.data.layer ?? null,
    });
    return c.json(result);
  })
  .get("/aggregate", authSession, requireUser, accountScope, async (c) => {
    const parsed = aggregateQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const { mapId, layer, heroId, role, battletag, global, outcome } = parsed.data;
    const result = await getSpatialAggregate({ mapId, layer: layer ?? null, heroId, role, battletag, global, outcome });
    return c.json(result);
  });
