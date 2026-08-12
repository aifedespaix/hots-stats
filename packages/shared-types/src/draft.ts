import { z } from "zod";

/**
 * Game modes counted as "classé" for the live-draft stats panel -- the same
 * grouping the web app already uses for its "Classé" filter option (see
 * apps/web/composables/useFormat.ts's `gameModeFilterGroups`), duplicated
 * here as a plain array so both the API (draft.service.ts) and the daemon's
 * docs can reference the same definition without a web -> api dependency.
 */
export const DRAFT_RANKED_MODES = ["UnrankedDraft", "HeroLeague", "TeamLeague", "StormLeague"] as const;

/** A hero needs at least this many ranked games (for that battletag) before
 * it's eligible for the winrate/KDA rankings -- keeps a single lucky game
 * from parading as someone's "best" hero. "Most played" has no floor: it's
 * meaningful even from a handful of games. */
export const DRAFT_MIN_RANKED_GAMES_FOR_RANKING = 5;

export const draftSlotStatusSchema = z.enum(["ok", "unreadable"]);
export type DraftSlotStatus = z.infer<typeof draftSlotStatusSchema>;

/**
 * One player slot as read off the draft screen by the daemon's OCR step.
 * `rawName` is the bare in-game display name (never a `#tag` -- HotS doesn't
 * show battletags on that screen), null when OCR couldn't read it at all
 * (`status: "unreadable"`) so a bad crop degrades gracefully instead of
 * dropping the whole snapshot.
 */
export const draftSlotInputSchema = z.object({
  slot: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  rawName: z.string().min(1).max(64).nullable(),
  status: draftSlotStatusSchema,
});
export type DraftSlotInput = z.infer<typeof draftSlotInputSchema>;

const draftTeamInputSchema = z.array(draftSlotInputSchema).length(5);

/** Payload POSTed by the Python daemon to `/draft/snapshot` (Bearer-authed,
 * same personal access token as `/ingest`) every time the user presses the
 * capture hotkey. */
export const draftSnapshotInputSchema = z.object({
  capturedAt: z.string().datetime(),
  teamLeft: draftTeamInputSchema,
  teamRight: draftTeamInputSchema,
});
export type DraftSnapshotInput = z.infer<typeof draftSnapshotInputSchema>;

/** A resolved slot as sent from the API to the web app: `candidates` lists
 * every full battletag whose name part matches `rawName` (0 = never seen
 * that name in any recorded match, 1 = unambiguous, 2+ = the front must ask
 * the viewer which one it is). `effectiveBattletag` is the API's best guess
 * for *this* recipient -- the single candidate, or their remembered
 * preference among several -- null when the viewer still needs to pick. */
export interface DraftPlayerSlot {
  slot: 1 | 2 | 3 | 4 | 5;
  rawName: string | null;
  status: DraftSlotStatus;
  candidates: string[];
  effectiveBattletag: string | null;
}

export interface DraftSnapshot {
  id: string;
  capturedAt: string;
  teamLeft: DraftPlayerSlot[];
  teamRight: DraftPlayerSlot[];
}

export const draftPreferenceInputSchema = z.object({
  pseudo: z.string().min(1).max(64),
  battletag: z.string().min(1),
});
export type DraftPreferenceInput = z.infer<typeof draftPreferenceInputSchema>;

export interface DraftHeroStat {
  heroId: string;
  heroName: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  kda: number;
}

export interface DraftPlayerStats {
  battletag: string;
  /** How many games the *connected viewer* has shared with this battletag (ally or opponent). */
  encounters: number;
  rankedGamesTotal: number;
  topPlayed: DraftHeroStat[];
  topWinrate: DraftHeroStat[];
  topKda: DraftHeroStat[];
}
