import type { HeroStatsScope, PlayerEncounterStats, TalentTierStats } from "@hots-stats/shared-types";
import type { StatsSummary } from "./matches";

export interface HeroStats {
  heroId: string;
  heroName: string;
  heroRole: string | null;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgKillParticipation: number;
}

export interface HeroListResponse {
  heroes: HeroStats[];
}

export interface HeroDetailResponse {
  hero: HeroStats;
  /** Same hero's stats for the opposite scope (personal vs. global), for comparison UI. */
  other: HeroStats | null;
  scope: HeroStatsScope;
}

export interface HeroTalentsResponse {
  talents: TalentTierStats[];
}

export interface PlayerListResponse {
  players: PlayerEncounterStats[];
}

export interface PlayerHeroBreakdown {
  heroId: string;
  heroName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
}

export interface PlayerMapBreakdown {
  mapId: string;
  mapName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winrate: number;
}

export interface PlayerOwnStats {
  summary: StatsSummary;
  topHeroes: HeroStats[];
}

export interface PlayerDetailResponse {
  player: PlayerEncounterStats;
  /** The player's own real stats (all their games, not just shared ones) --
   * only present when they have a registered account AND are a friend
   * (or the connected user themselves): sharing your full history is a
   * friends-only privilege, not something any stranger you've matched with can see. */
  ownStats: PlayerOwnStats | null;
  heroBreakdown: PlayerHeroBreakdown[];
  opponentHeroBreakdown: PlayerHeroBreakdown[];
  mapBreakdown: PlayerMapBreakdown[];
}

export interface PublicProfileResponse {
  profile: {
    displayName: string;
    avatarUrl: string | null;
    battletag: string | null;
    publicHandle: string | null;
  };
  summary: {
    gamesPlayed: number;
    wins: number;
    winrate: number;
    avgDurationSeconds: number;
  };
  topHeroes: HeroStats[];
}
