import type { User } from "@hots-stats/db";
import { Hono } from "hono";
import type { Scope } from "../lib/account-selection";
import { accountScope } from "../middleware/account-scope";
import { authSession, requireUser } from "../middleware/auth-session";
import {
  getMapWeaknesses,
  getMatchupWeaknesses,
  getOverperformingTalents,
  getUnderperformingTalents,
} from "../services/weaknesses.service";

type Env = { Variables: { user: User; scope: Scope } };

/** Personal diagnostic data for the "Diagnostic" page -- everything the
 * connected user needs is fetched in one round trip since the page renders
 * a synthesis of all four as soon as it loads. */
export const weaknessesRoute = new Hono<Env>()
  .use("*", authSession, requireUser, accountScope)
  .get("/", async (c) => {
  const user = c.get("user");
  const [maps, matchups, talents, talentStrengths] = await Promise.all([
    getMapWeaknesses(c.get("scope")),
    getMatchupWeaknesses(c.get("scope")),
    getUnderperformingTalents(c.get("scope")),
    getOverperformingTalents(c.get("scope")),
  ]);
  return c.json({ maps, matchups, talents, talentStrengths });
});
