import type { DriverMetric } from "@hots-stats/shared-types";
import { formatPercent } from "~/composables/useFormat";
import type { Tone } from "~/utils/tone";

/**
 * A4 metrics that are 0-1 shares/rates and render as a percentage; every other
 * metric keeps its own scale, two decimals. The Diagnostic drivers list and the
 * hub's work-axes card both read this, so the two can never disagree.
 */
const PERCENT_KEYS = new Set(["firstDeath", "timeDeadShare"]);

export function formatDriverMetric(key: string, value: number): string {
  return PERCENT_KEYS.has(key) ? formatPercent(value) : value.toFixed(2);
}

/**
 * Colour of one driver row: the metric's good side is `betterWhen`, so the
 * win/loss gap is only green when wins actually sit on that side. Unreliable
 * entries (either side under PROGRESSION_MIN_PER_SIDE) and exact ties are muted
 * -- the number is always shown, never turned into a verdict.
 */
export function driverTone(driver: DriverMetric): Tone {
  if (!driver.reliable) return "default";
  const gap = driver.meanInWins - driver.meanInLosses;
  if (gap === 0) return "default";
  const favourable = driver.betterWhen === "higher" ? gap > 0 : gap < 0;
  return favourable ? "success" : "danger";
}

/** One display row of the Diagnostic drivers list (B3). */
export interface DriverRow {
  key: string;
  label: string;
  valueInWins: string;
  valueInLosses: string;
  effect: string;
  sample: string;
  tone: Tone;
  reliable: boolean;
}

function formatEffectSize(effectSize: number): string {
  const value = Number(effectSize.toFixed(2));
  return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

/** Maps the API-sorted A4 drivers to display rows, preserving the API order. */
export function buildDriverRows(drivers: DriverMetric[]): DriverRow[] {
  return drivers.map((driver) => ({
    key: driver.key,
    label: driver.label,
    valueInWins: formatDriverMetric(driver.key, driver.meanInWins),
    valueInLosses: formatDriverMetric(driver.key, driver.meanInLosses),
    effect: formatEffectSize(driver.effectSize),
    sample: `${driver.winsSample} V / ${driver.lossesSample} D`,
    tone: driverTone(driver),
    reliable: driver.reliable,
  }));
}
