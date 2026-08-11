import { db, personalAccessTokens } from "@hots-stats/db";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { generatePersonalAccessToken, hashToken } from "../lib/tokens";
import { authSession, requireUser } from "../middleware/auth-session";

const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
});

export const tokensRoute = new Hono()
  .use("*", authSession, requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const rows = await db
      .select({
        id: personalAccessTokens.id,
        name: personalAccessTokens.name,
        lastUsedAt: personalAccessTokens.lastUsedAt,
        createdAt: personalAccessTokens.createdAt,
        revokedAt: personalAccessTokens.revokedAt,
      })
      .from(personalAccessTokens)
      .where(eq(personalAccessTokens.userId, user.id))
      .orderBy(desc(personalAccessTokens.createdAt));

    return c.json({ tokens: rows });
  })
  .post("/", async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const parsed = createTokenSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const rawToken = generatePersonalAccessToken();
    const [created] = await db
      .insert(personalAccessTokens)
      .values({ userId: user.id, name: parsed.data.name, tokenHash: hashToken(rawToken) })
      .returning({
        id: personalAccessTokens.id,
        name: personalAccessTokens.name,
        createdAt: personalAccessTokens.createdAt,
      });

    if (!created) {
      return c.json({ error: "Failed to create token" }, 500);
    }

    // The raw token is only ever returned here — only its hash is stored.
    return c.json({ token: rawToken, ...created }, 201);
  })
  .delete("/:id", async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    await db
      .update(personalAccessTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(personalAccessTokens.id, c.req.param("id")), eq(personalAccessTokens.userId, user.id)));

    return c.json({ status: "ok" });
  });
