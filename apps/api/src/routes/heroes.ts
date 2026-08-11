import type { User } from "@hots-stats/db";
import { gameModeSchema, heroStatsScopeSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { z } from "zod";
import { authSession, requireUser } from "../middleware/auth-session";
import { getHeroSummaries, getHeroSummary, getTalentTierStats } from "../services/talents.service";

type Env = { Variables: { user: User } };

const listQuerySchema = z.object({ mode: gameModeSchema.optional(), scope: heroStatsScopeSchema.optional() });

export const heroesRoute = new Hono<Env>()
  .use("*", authSession, requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const scope = parsed.data.scope ?? user.heroStatsScope;
    const heroes = await getHeroSummaries(user.id, parsed.data.mode, scope);
    return c.json({ heroes, scope });
  })
  .get("/:heroId", async (c) => {
    const user = c.get("user");
    const parsed = z.object({ scope: heroStatsScopeSchema.optional() }).safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const scope = parsed.data.scope ?? user.heroStatsScope;
    const hero = await getHeroSummary(user.id, c.req.param("heroId"), scope);
    if (!hero) {
      return c.json({ error: "Hero not found" }, 404);
    }
    return c.json({ hero, scope });
  })
  .get("/:heroId/talents", async (c) => {
    const user = c.get("user");
    const talents = await getTalentTierStats(user.id, c.req.param("heroId"));
    return c.json({ talents });
  });
