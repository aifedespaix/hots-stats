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
