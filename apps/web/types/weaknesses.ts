import type {
  MapWeaknessStats,
  MatchupWeaknessStats,
  OverperformingTalentStats,
  UnderperformingTalentStats,
} from "@hots-stats/shared-types";

export type { MapWeaknessStats, MatchupWeaknessStats, OverperformingTalentStats, UnderperformingTalentStats };

export interface WeaknessesResponse {
  maps: MapWeaknessStats[];
  matchups: MatchupWeaknessStats[];
  talents: UnderperformingTalentStats[];
  talentStrengths: OverperformingTalentStats[];
}
