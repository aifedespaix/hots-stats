import type { User } from "@hots-stats/db";
import { Hono } from "hono";
import { authSession, requireUser } from "../middleware/auth-session";
import { getMapWeaknesses, getMatchupWeaknesses, getUnderperformingTalents } from "../services/weaknesses.service";

type Env = { Variables: { user: User } };

/** Personal diagnostic data for the "Diagnostic" page -- everything the
 * connected user needs is fetched in one round trip since the page renders
 * a synthesis of all three as soon as it loads. */
export const weaknessesRoute = new Hono<Env>().use("*", authSession, requireUser).get("/", async (c) => {
  const user = c.get("user");
  const [maps, matchups, talents] = await Promise.all([
    getMapWeaknesses(user.id),
    getMatchupWeaknesses(user.id),
    getUnderperformingTalents(user.id),
  ]);
  return c.json({ maps, matchups, talents });
});
