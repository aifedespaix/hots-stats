import type { NormalizedMetrics } from "@hots-stats/shared-types";

/** Raw per-player-per-match SUMs a `NormalizedMetrics` bundle is derived from
 * (A2). `durationSeconds` is the summed match duration, not one match's. */
export interface NormalizedMetricSums {
  durationSeconds: number;
  experienceContribution: number;
  heroDamage: number;
  siegeDamage: number;
  healing: number;
  damageTaken: number;
  kills: number;
  deaths: number;
  assists: number;
}

const ZERO_METRICS: NormalizedMetrics = {
  xpPerMinute: 0,
  heroDamagePerMinute: 0,
  siegeDamagePerMinute: 0,
  healingPerMinute: 0,
  damageTakenPerMinute: 0,
  deathsPer10Min: 0,
  killsPer10Min: 0,
  assistsPer10Min: 0,
};

/**
 * Duration-weighted rates: `sum(stat) / (sum(durationSeconds) / unit)` (A2).
 * Never an average of per-match ratios -- a 5-minute game and a 30-minute game
 * must not weigh the same. Falls back to all-zero metrics when the summed
 * duration is not a positive number, so an empty scope reads 0 instead of
 * NaN/Infinity.
 */
export function normalizeMetrics(sums: NormalizedMetricSums): NormalizedMetrics {
  if (!(sums.durationSeconds > 0)) return { ...ZERO_METRICS };
  const minutes = sums.durationSeconds / 60;
  const tenMinutes = sums.durationSeconds / 600;
  return {
    xpPerMinute: sums.experienceContribution / minutes,
    heroDamagePerMinute: sums.heroDamage / minutes,
    siegeDamagePerMinute: sums.siegeDamage / minutes,
    healingPerMinute: sums.healing / minutes,
    damageTakenPerMinute: sums.damageTaken / minutes,
    deathsPer10Min: sums.deaths / tenMinutes,
    killsPer10Min: sums.kills / tenMinutes,
    assistsPer10Min: sums.assists / tenMinutes,
  };
}
