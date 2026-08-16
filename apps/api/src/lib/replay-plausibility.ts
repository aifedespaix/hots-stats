import type { ReplayPayload } from "@hots-stats/shared-types";

/**
 * Catches replays whose stats are structurally impossible for a real
 * completed game -- independent of, and in addition to, `parserVersion`
 * gating (see `apps/api/src/constants.ts`'s `MIN_PARSER_VERSION`).
 *
 * This project has already shipped (and fixed) two real parser bugs of
 * exactly this shape -- see `daemon-python/src/constants.py`'s
 * `PARSER_VERSION` changelog, 1.6 and 1.7 -- where a player-index desync in
 * `_apply_score_event` (parser.py) silently produced payloads with entire
 * stat columns stuck at 0 across every player, or the same non-zero value
 * duplicated across several of them. A version bump fixed those two
 * specific causes, but doesn't guard against a *future* regression of the
 * same shape shipping and quietly corrupting new matches again before
 * anyone notices -- this is that guard, checked once per ingested payload
 * regardless of which `parserVersion` claims to have produced it.
 *
 * Deliberately conservative (duration/threshold gated) to avoid rejecting
 * genuinely unusual-but-real games: a false negative here just means a
 * corrupted payload reaches the DB, exactly like before this existed; a
 * false positive means a real replay gets a hard 400 the daemon will retry
 * forever (see `ingestion.py`'s retry-budget handling) until this is
 * loosened, which is the more expensive mistake.
 */

const _COMBAT_FIELDS = [
  "kills",
  "deaths",
  "assists",
  "heroDamage",
  "siegeDamage",
  "healing",
  "selfHealing",
  "damageTaken",
] as const;

// Below this, a real "everyone's stats are still zero" is plausible (game
// abandoned/disconnected moments after loading in) -- not just a parser bug.
const _MIN_DURATION_FOR_ZERO_CHECK_SECONDS = 180;

// A stat tying *exactly* across this many distinct players is the
// duplication signature from the 1.7 bug (an index desync that fed one
// real player's value to several slots at once) -- coincidental real ties
// (e.g. two players both on 0 siege damage) are common for two or three
// players, implausible for this many at once on a value that's usually a
// per-player integer with no reason to collide.
const _DUPLICATE_VALUE_THRESHOLD = 5;

/**
 * Returns a human-readable reason the payload looks structurally corrupt,
 * or `null` if it looks like a normal match. Only ever flags payloads that
 * would be *impossible* in a real completed game, not merely unusual ones.
 */
export function checkReplayPlausibility(payload: ReplayPayload): string | null {
  if (payload.durationSeconds >= _MIN_DURATION_FOR_ZERO_CHECK_SECONDS) {
    const everyoneAllZero = payload.players.every((player) =>
      _COMBAT_FIELDS.every((field) => player[field] === 0),
    );
    if (everyoneAllZero) {
      return (
        `All ${payload.players.length} players show 0 on every combat stat ` +
        `(kills/deaths/assists/damage/healing) in a ${payload.durationSeconds}s match -- ` +
        "impossible for a completed game, almost certainly a parser bug rather than real data."
      );
    }
  }

  for (const field of ["heroDamage", "experienceContribution"] as const) {
    const nonZeroValues = payload.players.map((p) => p[field]).filter((value) => value > 0);
    const counts = new Map<number, number>();
    for (const value of nonZeroValues) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    for (const [value, count] of counts) {
      if (count >= _DUPLICATE_VALUE_THRESHOLD) {
        return (
          `${count} different players all show the exact same ${field} value (${value}) -- ` +
          "almost certainly a player-index mixup rather than real data."
        );
      }
    }
  }

  return null;
}
