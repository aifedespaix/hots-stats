import { db, playerAnnotations } from "@hots-stats/db";
import type { PlayerAnnotation, PlayerAnnotationInput } from "@hots-stats/shared-types";
import { and, eq, inArray } from "drizzle-orm";

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

/**
 * Bulk lookup for list/draft/match views showing many battletags at once --
 * one query instead of N, returned in the same order as `battletags` with
 * defaults filled in for battletags that have no annotation yet.
 */
export async function listPlayerAnnotations(
  viewerUserId: string,
  battletags: string[],
): Promise<PlayerAnnotation[]> {
  if (battletags.length === 0) return [];

  const rows = await db
    .select({
      battletag: playerAnnotations.battletag,
      isFdp: playerAnnotations.isFdp,
      isPgm: playerAnnotations.isPgm,
      note: playerAnnotations.note,
    })
    .from(playerAnnotations)
    .where(and(eq(playerAnnotations.viewerUserId, viewerUserId), inArray(playerAnnotations.battletag, battletags)));

  const byBattletag = new Map(rows.map((row) => [row.battletag, row]));
  return battletags.map((battletag) => toPlayerAnnotation(battletag, byBattletag.get(battletag)));
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
