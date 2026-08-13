import { z } from "zod";

/** Whether hero stats are computed from only the profile owner's matches, or every match the app has recorded. */
export const heroStatsScopeSchema = z.enum(["personal", "global"]);
export type HeroStatsScope = z.infer<typeof heroStatsScopeSchema>;

export interface HeroSummaryStats {
  heroId: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgKillParticipation: number;
}

export interface TalentTierStats {
  tier: 1 | 4 | 7 | 10 | 13 | 16 | 20;
  talentId: string;
  talentName: string;
  pickRate: number;
  winrate: number;
}

/** A connected user's win rate on one map, over their own ranked games only. */
export interface MapWeaknessStats {
  mapId: string;
  mapName: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
}

/** A connected user's win rate across their own ranked games where a given
 * *enemy* hero was on the opposing team -- "how do I do when I face X",
 * not "how does X perform overall". */
export interface MatchupWeaknessStats {
  heroId: string;
  heroName: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
}

/** A talent a user picks often at a given tier (their de facto default)
 * despite it underperforming relative to their own overall win rate on that
 * hero -- a habit worth reconsidering, not just a rarely-tried dud. */
export interface UnderperformingTalentStats {
  heroId: string;
  heroName: string;
  tier: 1 | 4 | 7 | 10 | 13 | 16 | 20;
  talentId: string;
  talentName: string;
  picks: number;
  /** Share of the user's own picks at this tier, for this hero, that are this talent. */
  pickRate: number;
  talentWinrate: number;
  /** The user's overall win rate on this hero (all talents), as the comparison baseline. */
  heroWinrate: number;
}

/** A talent a user picks often at a given tier (their de facto default)
 * that *outperforms* whatever else they picked instead at the same
 * tier/hero -- the mirror of `UnderperformingTalentStats`, surfaced as a
 * strength rather than a habit worth reconsidering. */
export type OverperformingTalentStats = UnderperformingTalentStats;

/** A weakness only counts as a "habit" worth flagging once picked at least
 * this many times -- one bad game with a rarely-tried talent isn't a pattern. */
export const TALENT_HABIT_MIN_PICKS = 3;
/** ...and only when it's the user's dominant choice at that tier (their
 * actual default), not a talent they're still experimenting with. */
export const TALENT_HABIT_MIN_PICK_RATE = 0.5;
/** Minimum win-rate gap (percentage points, as a ratio) below the hero's
 * overall win rate before an underperforming talent is worth surfacing. */
export const TALENT_HABIT_MIN_WINRATE_GAP = 0.15;

export type PlayerFriendshipStatus = "none" | "friends" | "pending_outgoing" | "pending_incoming" | "self";

export interface PlayerEncounterStats {
  battletag: string;
  gamesTogether: number;
  gamesAsAlly: number;
  gamesAsOpponent: number;
  winsAsAlly: number;
  winsAsOpponent: number;
  // Set when this battletag belongs to a registered account, so the UI can offer to add them as a friend.
  accountUserId: string | null;
  friendshipStatus: PlayerFriendshipStatus;
}

/** A hero needs at least this many games before it's eligible as a "signature
 * hero" ranking -- keeps one lucky game from parading as someone's best.
 * Kept distinct from `DRAFT_MIN_RANKED_GAMES_FOR_RANKING`: this codebase
 * keeps small-sample floors per-feature rather than sharing one constant. */
export const FACE_A_FACE_MIN_GAMES_FOR_SIGNATURE_HERO = 5;
/** Duo hero-combo samples are inherently smaller than solo hero samples
 * (they need both players on the same team on the same pick), so the floor
 * for a "best combo" ranking is lower than the signature-hero one. */
export const FACE_A_FACE_MIN_GAMES_FOR_COMBO = 2;

/** Account-wide (not per-hero) aggregate for one side of a Face-à-Face
 * comparison -- powers both the Tale of the Tape and the raw inputs to the
 * playstyle radar. Deliberately not scope-able to "global": a comparison
 * between two specific people only ever makes sense over their own games. */
export interface FaceAFaceOverviewStats {
  gamesPlayed: number;
  wins: number;
  winrate: number;
  totalDurationSeconds: number;
  avgDurationSeconds: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  kda: number;
  avgHeroDamage: number;
  avgSiegeDamage: number;
  avgHealing: number;
  avgDamageTaken: number;
  avgExperienceContribution: number;
  avgKillParticipation: number;
}

/** Share of a player's games spent on each hero role -- `role` is nullable
 * because a hero can have an unknown role (see heroes.ts's schema comment). */
export interface FaceAFaceRoleDistributionEntry {
  role: string | null;
  gamesPlayed: number;
  percentage: number;
}

export interface FaceAFaceSignatureHero {
  heroId: string;
  heroName: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  kda: number;
  /** True when this hero is a backfilled "most played" pick because fewer
   * than 3 heroes cleared `FACE_A_FACE_MIN_GAMES_FOR_SIGNATURE_HERO`. */
  smallSample: boolean;
}

/** One hero pairing the two players won/lost together while on the same team. */
export interface FaceAFaceHeroCombo {
  myHeroId: string;
  myHeroName: string;
  friendHeroId: string;
  friendHeroName: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  smallSample: boolean;
}

/** Stats for games where the two players were on the same team. */
export interface FaceAFaceSynergyStats {
  gamesPlayed: number;
  wins: number;
  winrate: number;
  /** Up to 3 best duo combos meeting `FACE_A_FACE_MIN_GAMES_FOR_COMBO`, best
   * winrate first -- empty (not backfilled) when none qualify, since "not
   * enough games together yet" is a normal, honest state to show as-is. */
  topCombos: FaceAFaceHeroCombo[];
}

export interface FaceAFacePlayerSide {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  battletag: string | null;
  overview: FaceAFaceOverviewStats;
  roleDistribution: FaceAFaceRoleDistributionEntry[];
  signatureHeroes: FaceAFaceSignatureHero[];
}
