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
