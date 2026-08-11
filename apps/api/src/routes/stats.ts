import type { User } from "@hots-stats/db";
import { Hono } from "hono";
import { authSession, requireUser } from "../middleware/auth-session";
import { getStatsSummary } from "../services/stats.service";

type Env = { Variables: { user: User } };

export const statsRoute = new Hono<Env>().use("*", authSession, requireUser).get("/summary", async (c) => {
  const user = c.get("user");
  return c.json(await getStatsSummary(user.id));
});
