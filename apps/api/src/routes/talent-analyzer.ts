import type { User } from "@hots-stats/db";
import {
  TALENT_ANALYZER_MIN_GAMES_DEFAULT,
  TALENT_TIERS,
  heroStatsScopeSchema,
  type TalentAnalyzerPin,
  type TalentTier,
} from "@hots-stats/shared-types";
import { Hono } from "hono";
import { z } from "zod";
import { type Scope, accountsQuerySchema, withStatsScope } from "../lib/account-selection";
import { gameModeListSchema } from "../lib/query";
import { accountScope } from "../middleware/account-scope";
import { authSession, requireUser } from "../middleware/auth-session";
import { getTalentAnalysis } from "../services/talent-analyzer.service";

type Env = { Variables: { user: User; scope: Scope } };

const querySchema = z.object({
  heroId: z.string().min(1),
  mapId: z.string().min(1).optional(),
  scope: heroStatsScopeSchema.optional(),
  accounts: accountsQuerySchema,
  mode: gameModeListSchema.optional(),
  // "tier:talentId,tier:talentId" -- see `parsePins`.
  pins: z.string().optional(),
  minGames: z.coerce.number().int().min(1).max(500).optional(),
});

const isTalentTier = (value: number): value is TalentTier => (TALENT_TIERS as readonly number[]).includes(value);

/** Malformed segments (bad tier, empty talent id) are dropped rather than
 * rejected outright -- a stale/edited query string shouldn't 400 the whole
 * board, it should just fail to lock that one tier. */
function parsePins(raw: string | undefined): TalentAnalyzerPin[] {
  if (!raw) return [];
  const pins: TalentAnalyzerPin[] = [];
  for (const part of raw.split(",")) {
    const [tierPart, talentId] = part.split(":");
    const tier = Number(tierPart);
    if (!talentId || !isTalentTier(tier)) continue;
    pins.push({ tier, talentId });
  }
  return pins;
}

/** The Talent Analyzer: conditional talent winrate for a hero, a map, or
 * both, with cascading recompute as the player pins talents tier by tier,
 * plus a top-builds leaderboard. See the "Talents & Terrain" design doc's
 * Mission 1. */
export const talentAnalyzerRoute = new Hono<Env>()
  .use("*", authSession, requireUser, accountScope)
  .get("/", async (c) => {
  const user = c.get("user");
  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const { heroId, mapId, scope, mode, pins, minGames } = parsed.data;
  const result = await getTalentAnalysis({
    heroId,
    mapId,
    scope: withStatsScope(c.get("scope"), scope, user.heroStatsScope),
    mode,
    pins: parsePins(pins),
    minGames: minGames ?? TALENT_ANALYZER_MIN_GAMES_DEFAULT,
  });

  return c.json(result);
});
