import { type User, db, matchPlayers, matches } from "@hots-stats/db";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { authSession, requireUser } from "../middleware/auth-session";

type Env = { Variables: { user: User } };

export const statsRoute = new Hono<Env>().use("*", authSession, requireUser).get("/summary", async (c) => {
  const user = c.get("user");

  const [row] = await db
    .select({
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
      avgDurationSeconds: sql<number>`coalesce(avg(${matches.durationSeconds}), 0)::int`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(eq(matchPlayers.userId, user.id));

  const gamesPlayed = row?.gamesPlayed ?? 0;
  const wins = row?.wins ?? 0;

  return c.json({
    gamesPlayed,
    wins,
    winrate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
    avgDurationSeconds: row?.avgDurationSeconds ?? 0,
  });
});
