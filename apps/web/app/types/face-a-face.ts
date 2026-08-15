import type { FaceAFaceMatchupStats, FaceAFacePlayerSide, FaceAFaceSynergyStats } from "@hots-stats/shared-types";

export interface FaceAFaceResponse {
  me: FaceAFacePlayerSide;
  /** The compared player -- any battletag ever seen in a recorded match, not just a friend. */
  opponent: FaceAFacePlayerSide;
  synergy: FaceAFaceSynergyStats;
  matchups: FaceAFaceMatchupStats;
}
