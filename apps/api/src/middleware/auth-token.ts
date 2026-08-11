import { type User, db, personalAccessTokens, users } from "@hots-stats/db";
import { and, eq, isNull } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { hashToken } from "../lib/tokens";

type Env = { Variables: { user: User } };

/** Authenticates the daemon via `Authorization: Bearer <personal access token>`. */
export const authToken = createMiddleware<Env>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Missing bearer token" }, 401);
  }

  const tokenHash = hashToken(header.slice("Bearer ".length));

  const [row] = await db
    .select({ tokenId: personalAccessTokens.id, user: users })
    .from(personalAccessTokens)
    .innerJoin(users, eq(users.id, personalAccessTokens.userId))
    .where(and(eq(personalAccessTokens.tokenHash, tokenHash), isNull(personalAccessTokens.revokedAt)))
    .limit(1);

  if (!row) {
    return c.json({ error: "Invalid or revoked token" }, 401);
  }

  await db
    .update(personalAccessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(personalAccessTokens.id, row.tokenId));

  c.set("user", row.user);
  await next();
});
