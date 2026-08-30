import type { User } from "@hots-stats/db";
import { Hono } from "hono";
import { z } from "zod";
import { authSession, requireUser } from "../middleware/auth-session";
import { getSpatialAggregate } from "../services/spatial-aggregate.service";

type Env = { Variables: { user?: User } };

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
 * `GET /spatial/aggregate` -- reads a "Historique" Slot (see
 * tasks/epic-10-analyse-spatiale.md's Slot model), session-authed like the
 * rest of the web-facing API (not the daemon's Bearer-PAT `/spatial/*`
 * routes, see routes/spatial.ts -- mounted at the same `/spatial` prefix
 * via a second `app.route()` call since the two sub-paths never overlap).
 */
export const spatialAggregateRoute = new Hono<Env>()
  .use("*", authSession, requireUser)
  .get("/aggregate", async (c) => {
    const parsed = aggregateQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const { mapId, layer, heroId, role, battletag, global, outcome } = parsed.data;
    const result = await getSpatialAggregate({ mapId, layer: layer ?? null, heroId, role, battletag, global, outcome });
    return c.json(result);
  });
