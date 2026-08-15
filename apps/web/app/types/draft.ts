import type {
  DraftHeroStat,
  DraftPlayerSlot,
  DraftPlayerStats,
  DraftRecentGame,
  DraftSnapshot,
  TeamThreatEntry,
} from "@hots-stats/shared-types";

export type { DraftHeroStat, DraftPlayerSlot, DraftPlayerStats, DraftRecentGame, DraftSnapshot, TeamThreatEntry };

export interface DraftPlayerStatsResponse {
  stats: DraftPlayerStats;
}

export interface TeamThreatsResponse {
  threats: TeamThreatEntry[];
}
