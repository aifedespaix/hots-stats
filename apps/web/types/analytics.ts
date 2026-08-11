import type { PlayerEncounterStats, TalentTierStats } from "@hots-stats/shared-types";

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

export interface PlayerDetailResponse {
  player: PlayerEncounterStats;
  heroBreakdown: PlayerHeroBreakdown[];
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
