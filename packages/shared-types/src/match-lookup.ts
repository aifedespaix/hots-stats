import { z } from "zod";

export const MATCH_LOOKUP_MAX = 200;

/**
 * `POST /ingest/matches/lookup`: lets the daemon's Sync tab fill in map / hero / mode / date /
 * result for replays it synced before it tracked them locally, without re-parsing anything.
 * Synced rows are looked up by `matchIds` (the id the daemon stored when the upload was
 * confirmed -- when two players upload the same game the server dedups on gameFingerprint, so
 * the daemon's own `replayHash` is not necessarily in `matches`); quarantined replays have no
 * match yet and are looked up by `replayHashes`.
 */
export const matchLookupInputSchema = z
  .object({
    replayHashes: z.array(z.string().min(32).max(128)).default([]),
    matchIds: z.array(z.string().uuid()).default([]),
  })
  .refine((v) => v.replayHashes.length + v.matchIds.length > 0, { message: "Nothing to look up" })
  .refine((v) => v.replayHashes.length + v.matchIds.length <= MATCH_LOOKUP_MAX, {
    message: `At most ${MATCH_LOOKUP_MAX} ids per request`,
  });
export type MatchLookupInput = z.infer<typeof matchLookupInputSchema>;

export interface MatchLookupItem {
  matchId: string;
  replayHash: string;
  parserVersion: string;
  map: string;
  gameMode: string;
  playedAt: string;
  /** The requesting user's own hero in this match; null when none of their accounts played it. */
  hero: string | null;
  won: boolean | null;
}
