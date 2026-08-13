import { z } from "zod";

/** A viewer's private "FDP"/"PGM" flags and free-text note on a battletag,
 * surfaced wherever that battletag appears (players list, live draft, match
 * detail) -- see apps/api/src/services/player-annotations.service.ts.
 * Always present for a requested battletag, defaulting to the "no
 * annotation yet" shape (both flags false, empty note) rather than null. */
export interface PlayerAnnotation {
  battletag: string;
  isFdp: boolean;
  isPgm: boolean;
  note: string;
}

export const playerAnnotationInputSchema = z.object({
  isFdp: z.boolean(),
  isPgm: z.boolean(),
  note: z.string().max(2000),
});
export type PlayerAnnotationInput = z.infer<typeof playerAnnotationInputSchema>;

/** One friend's (or the viewer's own) note on a battletag, with authorship for display. */
export interface PlayerAnnotationEntry {
  authorId: string;
  authorName: string;
  isMine: boolean;
  isFdp: boolean;
  isPgm: boolean;
  note: string;
}

/** Aggregated view of a battletag's annotations across the viewer and their accepted friends --
 * see `listSharedPlayerAnnotations` in apps/api/src/services/player-annotations.service.ts. */
export interface SharedPlayerAnnotation {
  battletag: string;
  fdpCount: number;
  pgmCount: number;
  mine: { isFdp: boolean; isPgm: boolean; note: string };
  entries: PlayerAnnotationEntry[];
}
