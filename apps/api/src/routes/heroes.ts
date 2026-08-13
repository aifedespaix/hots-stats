import type { User } from "@hots-stats/db";
import type { HeroStatsScope } from "@hots-stats/shared-types";
import { heroStatsScopeSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { z } from "zod";
import { gameModeListSchema } from "../lib/query";
import { authSession, requireUser } from "../middleware/auth-session";
import { getHeroSummaries, getHeroSummary, getTalentTierStats } from "../services/talents.service";

type Env = { Variables: { user: User } };

const listQuerySchema = z.object({ mode: gameModeListSchema.optional(), scope: heroStatsScopeSchema.optional() });

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
    const otherScope: HeroStatsScope = scope === "personal" ? "global" : "personal";
    const heroId = c.req.param("heroId");
    // `other` carries the opposite scope's numbers so the frontend can show a
    // personal-vs-global comparison (tooltip) without a second round trip.
    const [hero, other] = await Promise.all([
      getHeroSummary(user.id, heroId, scope),
      getHeroSummary(user.id, heroId, otherScope),
    ]);
    if (!hero) {
      return c.json({ error: "Hero not found" }, 404);
    }
    return c.json({ hero, other, scope });
  })
  .get("/:heroId/talents", async (c) => {
    const user = c.get("user");
    const talents = await getTalentTierStats(user.id, c.req.param("heroId"));
    return c.json({ talents });
  });
