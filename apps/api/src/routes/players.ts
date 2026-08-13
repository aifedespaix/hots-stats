import type { User } from "@hots-stats/db";
import { playerAnnotationInputSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { z } from "zod";
import { gameModeListSchema } from "../lib/query";
import { authSession, requireUser } from "../middleware/auth-session";
import {
  getPlayerAnnotation,
  listPlayerAnnotations,
  upsertPlayerAnnotation,
} from "../services/player-annotations.service";
import {
  getOpponentHeroBreakdown,
  getPlayerEncounter,
  getPlayerHeroBreakdown,
  getPlayerMapBreakdown,
  listPlayerEncounters,
} from "../services/players.service";
import { getStatsSummary } from "../services/stats.service";
import { getHeroSummaries } from "../services/talents.service";

type Env = { Variables: { user: User } };

const listQuerySchema = z.object({
  sortBy: z
    .enum(["battletag", "gamesTogether", "gamesAsAlly", "gamesAsOpponent", "wins", "losses"])
    .default("gamesTogether"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  mode: gameModeListSchema.optional(),
});

// Comma-joined battletags, same convention as draft.ts's team-threats query.
const annotationsBulkQuerySchema = z.object({ battletags: z.string().min(1) });

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
  .get("/annotations", async (c) => {
    const user = c.get("user");
    const parsed = annotationsBulkQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const battletags = [
      ...new Set(
        parsed.data.battletags
          .split(",")
          .map((battletag) => battletag.trim())
          .filter(Boolean),
      ),
    ];
    const annotations = await listPlayerAnnotations(user.id, battletags);
    return c.json({ annotations: Object.fromEntries(annotations.map((a) => [a.battletag, a])) });
  })
  .get("/:battletag/annotation", async (c) => {
    const user = c.get("user");
    const annotation = await getPlayerAnnotation(user.id, c.req.param("battletag"));
    return c.json({ annotation });
  })
  .put("/:battletag/annotation", async (c) => {
    const user = c.get("user");
    const parsed = playerAnnotationInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const annotation = await upsertPlayerAnnotation(user.id, c.req.param("battletag"), parsed.data);
    return c.json({ annotation });
  })
  .get("/:battletag", async (c) => {
    const user = c.get("user");
    const encounter = await getPlayerEncounter(user.id, c.req.param("battletag"));
    if (!encounter) {
      return c.json({ error: "No shared games with this player" }, 404);
    }
    const battletag = c.req.param("battletag");
    const [heroBreakdown, opponentHeroBreakdown, mapBreakdown, ownStats] = await Promise.all([
      getPlayerHeroBreakdown(user.id, battletag),
      getOpponentHeroBreakdown(user.id, battletag),
      getPlayerMapBreakdown(user.id, battletag),
      getOwnStats(encounter),
    ]);
    return c.json({ player: encounter, ownStats, heroBreakdown, opponentHeroBreakdown, mapBreakdown });
  });

/**
 * A player's own real stats (all their games, not just the ones shared with
 * the connected user) -- only fetched when they have a registered account
 * AND are a friend (or the connected user themselves): their full history
 * is a friends-only privilege, not something any past teammate/opponent can see.
 */
async function getOwnStats(encounter: { accountUserId: string | null; friendshipStatus: string }) {
  if (!encounter.accountUserId) return null;
  if (encounter.friendshipStatus !== "friends" && encounter.friendshipStatus !== "self") return null;

  const [summary, heroes] = await Promise.all([
    getStatsSummary(encounter.accountUserId, "personal"),
    getHeroSummaries(encounter.accountUserId, undefined, "personal"),
  ]);
  return { summary, topHeroes: heroes.sort((a, b) => b.gamesPlayed - a.gamesPlayed) };
}
