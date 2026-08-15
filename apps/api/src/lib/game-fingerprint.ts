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
 * across every participant's replay: the map and the full roster (battletag
 * + hero). Deliberately excludes:
 *  - `playedAt`, a per-client wall-clock timestamp that could differ by a
 *    second or two between two players' own replay files of the same game.
 *  - `durationSeconds`, which turned out *not* to be reliably identical
 *    either: it's derived from a "GatesOpen" tracker event whose detection
 *    has had bugs across daemon/parser versions, so the same real match can
 *    come out with two different durations depending on which version
 *    produced each upload (see migration 0015, which had to fix this after
 *    it let real duplicates slip past 0014's cleanup).
 * The exact same map plus the exact same battletag/hero pairing for every
 * player is already an extremely strong identity on its own.
 */
export function computeGameFingerprint(payload: Pick<ReplayPayload, "map" | "players">): string {
  const roster = payload.players
    .map((player) => `${player.battletag}:${player.heroId}`)
    .sort()
    .join(",");
  const source = `${payload.map}|${roster}`;
  return createHash("sha256").update(source).digest("hex");
}
