import type { GameMode } from "@hots-stats/shared-types";
import type { MatchTimelineData } from "./coach";

export interface MatchListItem {
  id: string;
  playedAt: string;
  durationSeconds: number;
  gameMode: GameMode;
  /** "major.minor.revision.baseBuild" (e.g. "2.55.15.96477"); null for a
   * match ingested before PARSER_VERSION 1.5, until it's resynced. */
  gameVersion: string | null;
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
  /**
   * Not sent by the API today (see `MatchTimelineData`'s doc comment) --
   * declared optional so the Coach tab's timeline-dependent insights start
   * working the day `GET /matches/:id` grows this field, with no front-end
   * change required. Always read as `data.timeline ?? null`.
   */
  timeline?: MatchTimelineData;
}

/** One filtered-vs-all-time-range metric powering a "Dashboard" radar chart axis. */
export interface DashboardPerformanceMetric {
  value: number;
  /** 0-100, the value scaled against the user's own all-time min/max for this metric. */
  normalized: number;
}

export interface DashboardOverviewStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winrate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  /** (kills+assists)/deaths averaged per game; null when the average death count is 0 (a "perfect" KDA). */
  kda: number | null;
}

export interface DashboardRoleStats {
  role: string | null;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  totalDurationSeconds: number;
}

export interface DashboardHeroStats {
  heroId: string;
  heroName: string;
  heroRole: string | null;
  gamesPlayed: number;
  wins: number;
  winrate: number;
}

export interface DashboardMapStats {
  mapId: string;
  mapName: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
}

export interface DashboardPerformanceProfile {
  gamesPlayed: number;
  damage: DashboardPerformanceMetric;
  healing: DashboardPerformanceMetric;
  xp: DashboardPerformanceMetric;
  survival: DashboardPerformanceMetric;
}

/** Response for `GET /matches/dashboard` -- powers the matches page's "Dashboard"
 * cards and, via `roles`/`maps`/`performance`, three of its four chart modals
 * (the fourth, winrate evolution, uses `GET /matches/trend` instead). */
export interface MatchesDashboardResponse {
  overview: DashboardOverviewStats;
  roles: DashboardRoleStats[];
  heroes: DashboardHeroStats[];
  maps: DashboardMapStats[];
  performance: DashboardPerformanceProfile;
}
