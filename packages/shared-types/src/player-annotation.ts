import { z } from "zod";

/** A viewer's private "FDP"/"Sympa" flags, 1-5 star rating (null = not rated) and free-text
 * note on a battletag, surfaced wherever that battletag appears (players list, live draft,
 * match detail) -- see apps/api/src/services/player-annotations.service.ts. Always present for
 * a requested battletag, defaulting to the "no annotation yet" shape (both flags false, no
 * rating, empty note) rather than null. */
export interface PlayerAnnotation {
  battletag: string;
  isFdp: boolean;
  isPgm: boolean;
  rating: number | null;
  note: string;
}

export const playerAnnotationInputSchema = z.object({
  isFdp: z.boolean(),
  isPgm: z.boolean(),
  rating: z.number().int().min(1).max(5).nullable(),
  note: z.string().max(2000),
});
export type PlayerAnnotationInput = z.infer<typeof playerAnnotationInputSchema>;

/** One friend's (or the viewer's own) annotation on a battletag, with authorship for display. */
export interface PlayerAnnotationEntry {
  authorId: string;
  authorName: string;
  isMine: boolean;
  isFdp: boolean;
  isPgm: boolean;
  rating: number | null;
  note: string;
}

/** Aggregated view of a battletag's annotations across the viewer and their accepted friends --
 * see `listSharedPlayerAnnotations` in apps/api/src/services/player-annotations.service.ts.
 * `entries` only includes authors who left free-text (used by the "notes" modal); FDP/rating
 * counts are computed over every annotation regardless of whether a note was left. */
export interface SharedPlayerAnnotation {
  battletag: string;
  fdpCount: number;
  pgmCount: number;
  ratingCount: number;
  ratingAverage: number | null;
  mine: { isFdp: boolean; isPgm: boolean; rating: number | null; note: string };
  entries: PlayerAnnotationEntry[];
}
