import { createHash } from "node:crypto";
import type { ReplayPayload } from "@hots-stats/shared-types";

/**
 * Content-based identity for the underlying game, independent of *which*
 * player's daemon uploaded it. `replayHash` (see replay-upsert.service.ts)
 * is a hash of the raw `.StormReplay` file bytes -- but every participant's
 * game client writes its own local copy of that file, and those copies
 * aren't byte-identical to each other. So when two different players each
 * upload their own replay of the same game, `replayHash` alone doesn't
 * catch it and the match gets inserted twice.
 *
 * This fingerprint is built only from data that's shared/deterministic
 * across every participant's replay: the map, the simulated match length
 * (`durationSeconds`, derived from the lockstep game-loop count, not a
 * wall-clock reading that could skew between clients), and the full roster
 * (battletag + hero). Deliberately excludes `playedAt`, which *is* a
 * per-client wall-clock timestamp and could differ by a second or two
 * between two players' own replay files of the same game.
 */
export function computeGameFingerprint(payload: Pick<ReplayPayload, "map" | "durationSeconds" | "players">): string {
  const roster = payload.players
    .map((player) => `${player.battletag}:${player.heroId}`)
    .sort()
    .join(",");
  const source = `${payload.map}|${payload.durationSeconds}|${roster}`;
  return createHash("sha256").update(source).digest("hex");
}
