import type { User } from "@hots-stats/db";
import { heroStatsScopeSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { z } from "zod";
import { type Scope, accountsQuerySchema, withStatsScope } from "../lib/account-selection";
import { gameModeListSchema } from "../lib/query";
import { accountScope } from "../middleware/account-scope";
import { authSession, requireUser } from "../middleware/auth-session";
import { getHeroMatchup, getHeroMatchups } from "../services/hero-matchups.service";
import { getHeroSummaries, getHeroSummary, getTalentTierStats } from "../services/talents.service";

type Env = { Variables: { user: User; scope: Scope } };

const listQuerySchema = z.object({
  mode: gameModeListSchema.optional(),
  scope: heroStatsScopeSchema.optional(),
  accounts: accountsQuerySchema,
  // Cross-filter for the Talent Analyzer's Hero select: when set, only
  // heroes actually played on this map are returned.
  mapId: z.string().min(1).optional(),
});

export const heroesRoute = new Hono<Env>()
  .use("*", authSession, requireUser, accountScope)
  .get("/", async (c) => {
    const user = c.get("user");
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const scope = withStatsScope(c.get("scope"), parsed.data.scope, user.heroStatsScope);
    const heroes = await getHeroSummaries(scope, parsed.data.mode, parsed.data.mapId);
    return c.json({ heroes, scope });
  })
  .get("/:heroId", async (c) => {
    const user = c.get("user");
    const parsed = z
      .object({ scope: heroStatsScopeSchema.optional(), accounts: accountsQuerySchema, mode: gameModeListSchema.optional() })
      .safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const scope = withStatsScope(c.get("scope"), parsed.data.scope, user.heroStatsScope);
    // "other" is the opposite of the current scope: a personal view compares
    // against the global population and vice versa.
    const otherScope: Scope = scope.mode === "global" ? c.get("scope") : { mode: "global" };
    const heroId = c.req.param("heroId");
    // `other` carries the opposite scope's numbers so the frontend can show a
    // personal-vs-global comparison (tooltip) without a second round trip.
    const [hero, other] = await Promise.all([
      getHeroSummary(scope, heroId, parsed.data.mode),
      getHeroSummary(otherScope, heroId, parsed.data.mode),
    ]);
    if (!hero) {
      return c.json({ error: "Hero not found" }, 404);
    }
    return c.json({ hero, other, scope });
  })
  .get("/:heroId/talents", async (c) => {
    const user = c.get("user");
    const parsed = z.object({ mode: gameModeListSchema.optional() }).safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const talents = await getTalentTierStats(c.get("scope"), c.req.param("heroId"), parsed.data.mode);
    return c.json({ talents });
  })
  .get("/:heroId/matchups", async (c) => {
    const user = c.get("user");
    const parsed = z
      .object({ scope: heroStatsScopeSchema.optional(), accounts: accountsQuerySchema, mode: gameModeListSchema.optional() })
      .safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const scope = withStatsScope(c.get("scope"), parsed.data.scope, user.heroStatsScope);
    const matchups = await getHeroMatchups(scope, c.req.param("heroId"), parsed.data.mode);
    return c.json({ ...matchups, scope });
  })
  .get("/:heroId/matchups/:opponentHeroId", async (c) => {
    const user = c.get("user");
    const parsed = z
      .object({ scope: heroStatsScopeSchema.optional(), accounts: accountsQuerySchema, mode: gameModeListSchema.optional() })
      .safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const scope = withStatsScope(c.get("scope"), parsed.data.scope, user.heroStatsScope);
    const matchup = await getHeroMatchup(
      scope,
      c.req.param("heroId"),
      c.req.param("opponentHeroId"),
      parsed.data.mode,
    );
    if (!matchup) return c.json({ error: "Hero not found" }, 404);
    return c.json({ ...matchup, scope });
  });
