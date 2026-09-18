import { describe, expect, test } from "bun:test";
import { normalizeMetrics, type NormalizedMetricSums } from "./metrics.service";

const zeroSums: NormalizedMetricSums = {
  durationSeconds: 0,
  experienceContribution: 0,
  heroDamage: 0,
  siegeDamage: 0,
  healing: 0,
  damageTaken: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
};

describe("normalizeMetrics", () => {
  test("weights each match by its duration instead of averaging per-match ratios", () => {
    // 10 min / 60 XP (6 XP/min) + 30 min / 30 XP (1 XP/min).
    // Weighted: 90 XP / 40 min = 2.25. A naive average of ratios would be 3.5.
    const metrics = normalizeMetrics({
      ...zeroSums,
      durationSeconds: 600 + 1800,
      experienceContribution: 60 + 30,
    });
    expect(metrics.xpPerMinute).toBe(2.25);
  });

  test("reads exactly 1 xp/min for the spec's 600s/10 XP + 1800s/30 XP pair", () => {
    const metrics = normalizeMetrics({
      ...zeroSums,
      durationSeconds: 600 + 1800,
      experienceContribution: 10 + 30,
    });
    expect(metrics.xpPerMinute).toBe(1);
  });

  test("converts each damage/healing total to a per-minute rate", () => {
    const metrics = normalizeMetrics({
      ...zeroSums,
      durationSeconds: 1800, // 30 min
      heroDamage: 30_000,
      siegeDamage: 9_000,
      healing: 6_000,
      damageTaken: 15_000,
    });
    expect(metrics.heroDamagePerMinute).toBe(1000);
    expect(metrics.siegeDamagePerMinute).toBe(300);
    expect(metrics.healingPerMinute).toBe(200);
    expect(metrics.damageTakenPerMinute).toBe(500);
  });

  test("expresses kills, deaths and assists per 10 minutes", () => {
    const metrics = normalizeMetrics({
      ...zeroSums,
      durationSeconds: 1200, // 20 min
      kills: 10,
      deaths: 4,
      assists: 6,
    });
    expect(metrics.killsPer10Min).toBe(5);
    expect(metrics.deathsPer10Min).toBe(2);
    expect(metrics.assistsPer10Min).toBe(3);
  });

  test("returns all-zero rates when no duration was recorded", () => {
    const metrics = normalizeMetrics({
      ...zeroSums,
      experienceContribution: 10_000,
      heroDamage: 10_000,
      kills: 9,
    });
    expect(metrics).toEqual({
      xpPerMinute: 0,
      heroDamagePerMinute: 0,
      siegeDamagePerMinute: 0,
      healingPerMinute: 0,
      damageTakenPerMinute: 0,
      deathsPer10Min: 0,
      killsPer10Min: 0,
      assistsPer10Min: 0,
    });
  });
});
