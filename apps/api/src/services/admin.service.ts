import { type User, db, users } from "@hots-stats/db";
import { eq, or } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Promotes a user to the `admin` role, matched by id (if `identifier` looks
 * like a UUID), battletag, or email -- whichever the caller has at hand.
 * Deliberately not exposed as an API route: this is only ever run by hand
 * via `bun run promote-admin <identifier>` (scripts/promote-admin.ts),
 * against a specific real account, never automatically.
 */
export async function promoteUserToAdmin(identifier: string): Promise<User | null> {
  const where = UUID_RE.test(identifier)
    ? eq(users.id, identifier)
    : or(eq(users.battletag, identifier), eq(users.email, identifier));

  const [updated] = await db.update(users).set({ role: "admin", updatedAt: new Date() }).where(where).returning();
  return updated ?? null;
}
