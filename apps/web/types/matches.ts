import type { GameMode } from "@hots-stats/shared-types";

export interface MatchListItem {
  id: string;
  playedAt: string;
  durationSeconds: number;
  gameMode: GameMode;
  mapId: string;
  mapName: string;
  winner: boolean;
  heroId: string;
  heroName: string;
}

export interface MatchListResponse {
  matches: MatchListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface StatsSummary {
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgDurationSeconds: number;
}

export interface MatchDetailPlayer {
  id: string;
  userId: string | null;
  battletag: string;
  heroId: string;
  heroName: string;
  heroRole: string | null;
  team: number;
  winner: boolean;
  kills: number;
  deaths: number;
  assists: number;
  heroDamage: number;
  siegeDamage: number;
  healing: number;
  selfHealing: number;
  damageTaken: number;
  experienceContribution: number;
  talents: { tier: number; talentId: string; talentName: string }[];
}

export interface MatchDetailResponse {
  match: {
    id: string;
    playedAt: string;
    durationSeconds: number;
    gameMode: GameMode;
    mapId: string;
    mapName: string;
    region: string;
  };
  teams: { team: number; players: MatchDetailPlayer[] }[];
}
