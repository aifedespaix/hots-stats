import { db, playerAnnotations, users } from "@hots-stats/db";
import type { PlayerAnnotation, PlayerAnnotationInput, SharedPlayerAnnotation } from "@hots-stats/shared-types";
import { and, eq, inArray } from "drizzle-orm";
import { listFriends } from "./friendships.service";

const DEFAULT_ANNOTATION = { isFdp: false, isPgm: false, rating: null, note: "" };

type AnnotationRow = { isFdp: boolean; isPgm: boolean; rating: number | null; note: string };

function toPlayerAnnotation(battletag: string, row?: AnnotationRow): PlayerAnnotation {
  return { battletag, ...(row ?? DEFAULT_ANNOTATION) };
}

export async function getPlayerAnnotation(viewerUserId: string, battletag: string): Promise<PlayerAnnotation> {
  const [row] = await db
    .select({
      isFdp: playerAnnotations.isFdp,
      isPgm: playerAnnotations.isPgm,
      rating: playerAnnotations.rating,
      note: playerAnnotations.note,
    })
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
    .returning({
      isFdp: playerAnnotations.isFdp,
      isPgm: playerAnnotations.isPgm,
      rating: playerAnnotations.rating,
      note: playerAnnotations.note,
    });

  return toPlayerAnnotation(battletag, row);
}

/**
 * Friend-aware view used everywhere annotations are *displayed* (players list, live draft,
 * player detail, match detail, and a player's own "what my friends think of me" view):
 * for each battletag, aggregates the viewer's own annotation together with every accepted
 * friend's annotation on that same battletag -- FDP/Sympa vote counts, average star rating,
 * and the individual notes with their author, so a battletag tagged by several friends
 * surfaces all of their input instead of just the viewer's own.
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
      rating: playerAnnotations.rating,
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
    const rowsForBattletag = byBattletag.get(battletag) ?? [];
    const mineRow = rowsForBattletag.find((entry) => entry.authorId === viewerUserId);
    const ratedRows = rowsForBattletag.filter((entry) => entry.rating !== null);
    const ratingAverage = ratedRows.length
      ? Math.round((ratedRows.reduce((sum, entry) => sum + (entry.rating ?? 0), 0) / ratedRows.length) * 10) / 10
      : null;

    return {
      battletag,
      fdpCount: rowsForBattletag.filter((entry) => entry.isFdp).length,
      pgmCount: rowsForBattletag.filter((entry) => entry.isPgm).length,
      ratingCount: ratedRows.length,
      ratingAverage,
      mine: mineRow
        ? { isFdp: mineRow.isFdp, isPgm: mineRow.isPgm, rating: mineRow.rating, note: mineRow.note }
        : DEFAULT_ANNOTATION,
      entries: rowsForBattletag
        .filter((entry) => entry.note.trim().length > 0)
        .map((entry) => ({
          authorId: entry.authorId,
          authorName: entry.authorName,
          isMine: entry.authorId === viewerUserId,
          isFdp: entry.isFdp,
          isPgm: entry.isPgm,
          rating: entry.rating,
          note: entry.note,
        })),
    };
  });
}
