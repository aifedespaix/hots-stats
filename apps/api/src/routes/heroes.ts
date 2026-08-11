import type { User } from "@hots-stats/db";
import { Hono } from "hono";
import { authSession, requireUser } from "../middleware/auth-session";
import { getHeroSummaries, getHeroSummary, getTalentTierStats } from "../services/talents.service";

type Env = { Variables: { user: User } };

export const heroesRoute = new Hono<Env>()
  .use("*", authSession, requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    const heroes = await getHeroSummaries(user.id);
    return c.json({ heroes });
  })
  .get("/:heroId", async (c) => {
    const user = c.get("user");
    const hero = await getHeroSummary(user.id, c.req.param("heroId"));
    if (!hero) {
      return c.json({ error: "Hero not found" }, 404);
    }
    return c.json({ hero });
  })
  .get("/:heroId/talents", async (c) => {
    const user = c.get("user");
    const talents = await getTalentTierStats(user.id, c.req.param("heroId"));
    return c.json({ talents });
  });
