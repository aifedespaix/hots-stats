import type { HeroStatsScope, PlayerEncounterStats, TalentTierStats } from "@hots-stats/shared-types";

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

export interface PlayerDetailResponse {
  player: PlayerEncounterStats;
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
