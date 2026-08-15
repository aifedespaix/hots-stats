import type { User } from "@hots-stats/db";
import { Hono } from "hono";
import { z } from "zod";
import { gameModeListSchema } from "../lib/query";
import { authSession, requireUser } from "../middleware/auth-session";
import { findUserByBattletag } from "../services/friendships.service";
import {
  getMatchupStats,
  getPlayerOverviewStats,
  getRoleDistribution,
  getSignatureHeroes,
  getSynergyStats,
  type FaceAFaceTarget,
} from "../services/face-a-face.service";

type Env = { Variables: { user: User } };

const compareQuerySchema = z.object({ mode: gameModeListSchema.optional() });

/**
 * Raw side-by-side comparison between the connected user and any battletag
 * ever seen in a recorded match -- not gated on friendship, unlike the old
 * `/friends/:userId/face-a-face` this replaces. The other side only needs a
 * registered account for its "me" perspective to be the connected user; the
 * opponent can be a bare battletag with no account at all.
 */
export const compareRoute = new Hono<Env>().use("*", authSession, requireUser).get("/:battletag", async (c) => {
  const user = c.get("user");
  const battletag = c.req.param("battletag");

  if (battletag === user.battletag) {
    return c.json({ error: "Impossible de se comparer à soi-même" }, 400);
  }

  const parsed = compareQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const mode = parsed.data.mode;

  const account = await findUserByBattletag(battletag);
  const target: FaceAFaceTarget = account ? { userId: account.id } : { battletag };

  const [myOverview, myRoles, mySignature, oppOverview, oppRoles, oppSignature, synergy, matchups] =
    await Promise.all([
      getPlayerOverviewStats({ userId: user.id }, mode),
      getRoleDistribution({ userId: user.id }, mode),
      getSignatureHeroes({ userId: user.id }, mode),
      getPlayerOverviewStats(target, mode),
      getRoleDistribution(target, mode),
      getSignatureHeroes(target, mode),
      getSynergyStats(user.id, battletag, mode),
      getMatchupStats(user.id, battletag, mode),
    ]);

  // No account and never seen in a recorded match: nothing to compare against,
  // most likely a typo'd battletag rather than a legitimate empty comparison.
  if (!account && oppOverview.gamesPlayed === 0) {
    return c.json({ error: "Joueur introuvable" }, 404);
  }

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
    opponent: {
      userId: account?.id ?? null,
      displayName: account?.displayName ?? battletag,
      avatarUrl: account?.avatarUrl ?? null,
      battletag,
      overview: oppOverview,
      roleDistribution: oppRoles,
      signatureHeroes: oppSignature,
    },
    synergy,
    matchups,
  });
});
