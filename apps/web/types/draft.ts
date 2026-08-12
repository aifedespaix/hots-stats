import type { DraftHeroStat, DraftPlayerSlot, DraftPlayerStats, DraftSnapshot } from "@hots-stats/shared-types";

export type { DraftHeroStat, DraftPlayerSlot, DraftPlayerStats, DraftSnapshot };

export interface DraftPlayerStatsResponse {
  stats: DraftPlayerStats;
}
