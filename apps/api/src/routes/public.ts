import { db, users } from "@hots-stats/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { type Scope, linkedBattletags } from "../lib/account-scope";
import { getStatsSummary } from "../services/stats.service";
import { getHeroSummaries } from "../services/talents.service";

/** Unauthenticated routes for the public/shareable profile page (`/u/:handle`). */
export const publicRoute = new Hono().get("/u/:handle", async (c) => {
  const handle = c.req.param("handle");

  const [user] = await db.select().from(users).where(eq(users.publicHandle, handle)).limit(1);
  if (!user) {
    return c.json({ error: "Profile not found" }, 404);
  }

  // A public profile shows every account the owner has linked, merged.
  const profileScope: Scope = { mode: "personal", battletags: await linkedBattletags(user.id) };
  const [summary, heroes] = await Promise.all([
    getStatsSummary(profileScope),
    getHeroSummaries(profileScope),
  ]);

  const topHeroes = [...heroes].sort((a, b) => b.gamesPlayed - a.gamesPlayed).slice(0, 5);

  return c.json({
    profile: {
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      battletag: user.battletag,
      publicHandle: user.publicHandle,
    },
    summary,
    topHeroes,
  });
});
