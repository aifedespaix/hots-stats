import { db, playerAnnotations, users } from "@hots-stats/db";
import type { PlayerAnnotation, PlayerAnnotationInput, SharedPlayerAnnotation } from "@hots-stats/shared-types";
import { and, eq, inArray } from "drizzle-orm";
import { listFriends } from "./friendships.service";

const DEFAULT_ANNOTATION = { isFdp: false, isPgm: false, note: "" };

type AnnotationRow = { isFdp: boolean; isPgm: boolean; note: string };

function toPlayerAnnotation(battletag: string, row?: AnnotationRow): PlayerAnnotation {
  return { battletag, ...(row ?? DEFAULT_ANNOTATION) };
}

export async function getPlayerAnnotation(viewerUserId: string, battletag: string): Promise<PlayerAnnotation> {
  const [row] = await db
    .select({ isFdp: playerAnnotations.isFdp, isPgm: playerAnnotations.isPgm, note: playerAnnotations.note })
    .from(playerAnnotations)
    .where(and(eq(playerAnnotations.viewerUserId, viewerUserId), eq(playerAnnotations.battletag, battletag)));

  return toPlayerAnnotation(battletag, row);
}

export async function upsertPlayerAnnotation(
  viewerUserId: string,
  battletag: string,
  input: PlayerAnnotationInput,
): Promise<PlayerAnnotation> {
  const [row] = await db
    .insert(playerAnnotations)
    .values({ viewerUserId, battletag, ...input })
    .onConflictDoUpdate({
      target: [playerAnnotations.viewerUserId, playerAnnotations.battletag],
      set: { ...input, updatedAt: new Date() },
    })
    .returning({ isFdp: playerAnnotations.isFdp, isPgm: playerAnnotations.isPgm, note: playerAnnotations.note });

  return toPlayerAnnotation(battletag, row);
}

/**
 * Friend-aware view used everywhere annotations are *displayed* (players list, live draft,
 * player detail, match detail): for each battletag, aggregates the viewer's own annotation
 * together with every accepted friend's annotation on that same battletag -- FDP/PGM vote
 * counts plus the individual notes with their author, so a battletag tagged by several
 * friends surfaces all of their input instead of just the viewer's own.
 */
export async function listSharedPlayerAnnotations(
  viewerUserId: string,
  battletags: string[],
): Promise<SharedPlayerAnnotation[]> {
  if (battletags.length === 0) return [];

  const friends = await listFriends(viewerUserId);
  const authorIds = [viewerUserId, ...friends.map((friend) => friend.id)];

  const rows = await db
    .select({
      authorId: playerAnnotations.viewerUserId,
      authorName: users.displayName,
      battletag: playerAnnotations.battletag,
      isFdp: playerAnnotations.isFdp,
      isPgm: playerAnnotations.isPgm,
      note: playerAnnotations.note,
    })
    .from(playerAnnotations)
    .innerJoin(users, eq(users.id, playerAnnotations.viewerUserId))
    .where(and(inArray(playerAnnotations.viewerUserId, authorIds), inArray(playerAnnotations.battletag, battletags)));

  const byBattletag = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = byBattletag.get(row.battletag);
    if (bucket) bucket.push(row);
    else byBattletag.set(row.battletag, [row]);
  }

  return battletags.map((battletag) => {
    const entries = byBattletag.get(battletag) ?? [];
    const mineRow = entries.find((entry) => entry.authorId === viewerUserId);
    return {
      battletag,
      fdpCount: entries.filter((entry) => entry.isFdp).length,
      pgmCount: entries.filter((entry) => entry.isPgm).length,
      mine: mineRow ? { isFdp: mineRow.isFdp, isPgm: mineRow.isPgm, note: mineRow.note } : DEFAULT_ANNOTATION,
      entries: entries
        .filter((entry) => entry.note.trim().length > 0)
        .map((entry) => ({
          authorId: entry.authorId,
          authorName: entry.authorName,
          isMine: entry.authorId === viewerUserId,
          isFdp: entry.isFdp,
          isPgm: entry.isPgm,
          note: entry.note,
        })),
    };
  });
}
