import type { FaceAFacePlayerSide, FaceAFaceSynergyStats } from "@hots-stats/shared-types";

export interface FaceAFaceResponse {
  me: FaceAFacePlayerSide;
  friend: FaceAFacePlayerSide;
  synergy: FaceAFaceSynergyStats;
}
