import { type User, db, heroes, matchPlayers, matches, maps } from "@hots-stats/db";
import { heroStatsScopeSchema } from "@hots-stats/shared-types";
import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { authSession, requireUser } from "../middleware/auth-session";
import {
  areFriends,
  cancelFriendRequest,
  findUserByBattletag,
  findUserById,
  listFriends,
  listIncomingRequests,
  listOutgoingRequests,
  removeFriend,
  respondToFriendRequest,
  searchUsers,
  sendFriendRequest,
} from "../services/friendships.service";
import {
  getPlayerOverviewStats,
  getRoleDistribution,
  getSignatureHeroes,
  getSynergyStats,
} from "../services/face-a-face.service";
import { getStatsSummary } from "../services/stats.service";
import { getHeroSummaries } from "../services/talents.service";

type Env = { Variables: { user: User } };

const sendRequestSchema = z
  .object({ userId: z.string().uuid().optional(), battletag: z.string().optional() })
  .refine((data) => Boolean(data.userId) !== Boolean(data.battletag), {
    message: "Fournir userId ou battletag, pas les deux",
  });

const searchQuerySchema = z.object({ q: z.string().default("") });

const scopeQuerySchema = z.object({ scope: heroStatsScopeSchema.optional() });

const matchesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
});

export const friendsRoute = new Hono<Env>()
  .use("*", authSession, requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    const friends = await listFriends(user.id);
    return c.json({ friends });
  })
  .get("/requests", async (c) => {
    const user = c.get("user");
    const [incoming, outgoing] = await Promise.all([
      listIncomingRequests(user.id),
      listOutgoingRequests(user.id),
    ]);
    return c.json({ incoming, outgoing });
  })
  .get("/search", async (c) => {
    const user = c.get("user");
    const parsed = searchQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const results = await searchUsers(parsed.data.q, user.id);
    return c.json({ results });
  })
  .post("/requests", async (c) => {
    const user = c.get("user");
    const parsed = sendRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const target = parsed.data.userId
      ? await findUserById(parsed.data.userId)
      : await findUserByBattletag(parsed.data.battletag as string);

    if (!target) {
      return c.json({ error: "Joueur introuvable" }, 404);
    }

    const result = await sendFriendRequest(user.id, target.id);
    if (result.outcome === "error") {
      return c.json({ error: result.message }, 409);
    }
    return c.json(result, result.outcome === "requested" ? 201 : 200);
  })
  .post("/requests/:id/accept", async (c) => {
    const user = c.get("user");
    const ok = await respondToFriendRequest(user.id, c.req.param("id"), true);
    if (!ok) return c.json({ error: "Demande introuvable" }, 404);
    return c.json({ status: "ok" });
  })
  .post("/requests/:id/decline", async (c) => {
    const user = c.get("user");
    const ok = await respondToFriendRequest(user.id, c.req.param("id"), false);
    if (!ok) return c.json({ error: "Demande introuvable" }, 404);
    return c.json({ status: "ok" });
  })
  .delete("/requests/:id", async (c) => {
    const user = c.get("user");
    const ok = await cancelFriendRequest(user.id, c.req.param("id"));
    if (!ok) return c.json({ error: "Demande introuvable" }, 404);
    return c.json({ status: "ok" });
  })
  .delete("/:userId", async (c) => {
    const user = c.get("user");
    const ok = await removeFriend(user.id, c.req.param("userId"));
    if (!ok) return c.json({ error: "Amitié introuvable" }, 404);
    return c.json({ status: "ok" });
  })
  .get("/:userId/summary", async (c) => {
    const user = c.get("user");
    const friendId = c.req.param("userId");

    if (!(await areFriends(user.id, friendId))) {
      return c.json({ error: "Vous n'êtes pas ami avec ce joueur" }, 403);
    }

    const friend = await findUserById(friendId);
    if (!friend) return c.json({ error: "Joueur introuvable" }, 404);

    const parsed = scopeQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const scope = parsed.data.scope ?? user.heroStatsScope;

    const [summary, heroSummaries] = await Promise.all([
      getStatsSummary(friendId, scope),
      getHeroSummaries(friendId, undefined, scope),
    ]);

    return c.json({ friend, summary, heroes: heroSummaries, scope });
  })
  .get("/:userId/face-a-face", async (c) => {
    const user = c.get("user");
    const friendId = c.req.param("userId");

    if (!(await areFriends(user.id, friendId))) {
      return c.json({ error: "Vous n'êtes pas ami avec ce joueur" }, 403);
    }
    const friend = await findUserById(friendId);
    if (!friend) return c.json({ error: "Joueur introuvable" }, 404);

    const [myOverview, myRoles, mySignature, friendOverview, friendRoles, friendSignature, synergy] =
      await Promise.all([
        getPlayerOverviewStats(user.id),
        getRoleDistribution(user.id),
        getSignatureHeroes(user.id),
        getPlayerOverviewStats(friendId),
        getRoleDistribution(friendId),
        getSignatureHeroes(friendId),
        getSynergyStats(user.id, friendId),
      ]);

    return c.json({
      me: {
        userId: user.id,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        battletag: user.battletag,
        overview: myOverview,
        roleDistribution: myRoles,
        signatureHeroes: mySignature,
      },
      friend: {
        userId: friend.id,
        displayName: friend.displayName,
        avatarUrl: friend.avatarUrl,
        battletag: friend.battletag,
        overview: friendOverview,
        roleDistribution: friendRoles,
        signatureHeroes: friendSignature,
      },
      synergy,
    });
  })
  .get("/:userId/matches", async (c) => {
    const user = c.get("user");
    const friendId = c.req.param("userId");

    if (!(await areFriends(user.id, friendId))) {
      return c.json({ error: "Vous n'êtes pas ami avec ce joueur" }, 403);
    }

    const parsed = matchesQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { page, pageSize } = parsed.data;
    const where = eq(matchPlayers.userId, friendId);

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: matches.id,
          playedAt: matches.playedAt,
          durationSeconds: matches.durationSeconds,
          gameMode: matches.gameMode,
          mapId: matches.mapId,
          mapName: maps.name,
          winner: matchPlayers.winner,
          heroId: matchPlayers.heroId,
          heroName: heroes.name,
        })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .innerJoin(maps, eq(maps.id, matches.mapId))
        .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
        .where(where)
        .orderBy(desc(matches.playedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .where(where),
    ]);

    return c.json({ matches: rows, page, pageSize, total: countRows[0]?.count ?? 0 });
  });
