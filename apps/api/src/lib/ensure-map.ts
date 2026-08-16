import { db, maps } from "@hots-stats/db";
import { eq } from "drizzle-orm";

/**
 * Slug ("industrial-district") -> best-effort display name ("Industrial
 * District"), used to auto-create a placeholder row for a map the daemon
 * reports that isn't in the DB yet (a new map shipped in the game before the
 * seed list was updated). Good enough to be usable in the UI immediately;
 * can be corrected later with a real name/icon.
 */
export function displayNameFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Auto-creates a placeholder `maps` row for `mapId` if it doesn't exist yet.
 * Shared by `upsertReplay` (POST /ingest) and `upsertRawSamples` (POST
 * /spatial/samples) -- both can be the first thing to ever mention a brand
 * new map slug, and both write rows that FK-reference `maps.id`.
 */
export async function ensureMapExists(mapId: string): Promise<void> {
  const [map] = await db.select({ id: maps.id }).from(maps).where(eq(maps.id, mapId)).limit(1);
  if (!map) {
    await db.insert(maps).values({ id: mapId, name: displayNameFromSlug(mapId) }).onConflictDoNothing();
  }
}
