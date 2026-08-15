import { db, personalAccessTokens } from "@hots-stats/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { generatePersonalAccessToken, hashToken } from "../lib/tokens";
import { authSession, requireUser } from "../middleware/auth-session";

/** "Token du 15/08/2026 à 14:32" -- the token's only "name": there is no
 * naming form anymore (see the frictionless creation UX on /upload), so this
 * is generated server-side purely as a stable, human-readable label for the
 * (non-nullable) `name` column. The UI itself always displays `createdAt`
 * directly rather than reading this field. */
function timestampedTokenName(date: Date): string {
  const datePart = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "Europe/Paris" }).format(date);
  const timePart = new Intl.DateTimeFormat("fr-FR", {
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(date);
  return `Token du ${datePart} à ${timePart}`;
}

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
        lastUsedAt: personalAccessTokens.lastUsedAt,
        createdAt: personalAccessTokens.createdAt,
      })
      .from(personalAccessTokens)
      // Legacy soft-revoked rows (from before DELETE became a hard delete)
      // must stay hidden -- deleted/revoked tokens never reappear in the UI.
      .where(and(eq(personalAccessTokens.userId, user.id), isNull(personalAccessTokens.revokedAt)))
      .orderBy(desc(personalAccessTokens.createdAt));

    return c.json({ tokens: rows });
  })
  .post("/", async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Zero-friction creation: no request body, no name to type -- one click,
    // one token. `createdAt` (returned below) is what the UI actually shows.
    const now = new Date();
    const rawToken = generatePersonalAccessToken();
    const [created] = await db
      .insert(personalAccessTokens)
      .values({ userId: user.id, name: timestampedTokenName(now), tokenHash: hashToken(rawToken) })
      .returning({ id: personalAccessTokens.id, createdAt: personalAccessTokens.createdAt });

    if (!created) {
      return c.json({ error: "Failed to create token" }, 500);
    }

    // The raw token is only ever returned here -- only its hash is stored.
    return c.json({ token: rawToken, ...created }, 201);
  })
  .post("/:id/renew", async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Rotates the secret in place (same row, same position in the list) --
    // this is what lets "Copier" work again on a token whose raw value was
    // only ever shown once at creation and is never stored. Any client still
    // using the old secret starts getting 401s immediately, same as a delete.
    const rawToken = generatePersonalAccessToken();
    const [renewed] = await db
      .update(personalAccessTokens)
      .set({ tokenHash: hashToken(rawToken), lastUsedAt: null })
      .where(
        and(
          eq(personalAccessTokens.id, c.req.param("id")),
          eq(personalAccessTokens.userId, user.id),
          isNull(personalAccessTokens.revokedAt),
        ),
      )
      .returning({ id: personalAccessTokens.id, createdAt: personalAccessTokens.createdAt });

    if (!renewed) {
      return c.json({ error: "Token not found" }, 404);
    }

    return c.json({ token: rawToken, ...renewed });
  })
  .delete("/:id", async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Definitive: hard-deleted, not soft-revoked -- it must vanish from the
    // list instantly and never come back as a "deleted token" entry.
    await db
      .delete(personalAccessTokens)
      .where(and(eq(personalAccessTokens.id, c.req.param("id")), eq(personalAccessTokens.userId, user.id)));

    return c.json({ status: "ok" });
  });
