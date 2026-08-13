import type { MapWeaknessStats, MatchupWeaknessStats, UnderperformingTalentStats } from "@hots-stats/shared-types";

export type { MapWeaknessStats, MatchupWeaknessStats, UnderperformingTalentStats };

export interface WeaknessesResponse {
  maps: MapWeaknessStats[];
  matchups: MatchupWeaknessStats[];
  talents: UnderperformingTalentStats[];
}
