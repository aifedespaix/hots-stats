import type { User } from "@hots-stats/db";
import { Hono } from "hono";
import { z } from "zod";
import { gameModeListSchema } from "../lib/query";
import { authSession, requireUser } from "../middleware/auth-session";
import {
  getOpponentHeroBreakdown,
  getPlayerEncounter,
  getPlayerHeroBreakdown,
  getPlayerMapBreakdown,
  listPlayerEncounters,
} from "../services/players.service";

type Env = { Variables: { user: User } };

const listQuerySchema = z.object({
  sortBy: z
    .enum(["battletag", "gamesTogether", "gamesAsAlly", "gamesAsOpponent", "wins", "losses"])
    .default("gamesTogether"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  mode: gameModeListSchema.optional(),
});

export const playersRoute = new Hono<Env>()
  .use("*", authSession, requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const players = await listPlayerEncounters(
      user.id,
      parsed.data.sortBy,
      parsed.data.sortDir,
      parsed.data.mode,
    );
    return c.json({ players });
  })
  .get("/:battletag", async (c) => {
    const user = c.get("user");
    const encounter = await getPlayerEncounter(user.id, c.req.param("battletag"));
    if (!encounter) {
      return c.json({ error: "No shared games with this player" }, 404);
    }
    const battletag = c.req.param("battletag");
    const [heroBreakdown, opponentHeroBreakdown, mapBreakdown] = await Promise.all([
      getPlayerHeroBreakdown(user.id, battletag),
      getOpponentHeroBreakdown(user.id, battletag),
      getPlayerMapBreakdown(user.id, battletag),
    ]);
    return c.json({ player: encounter, heroBreakdown, opponentHeroBreakdown, mapBreakdown });
  });
