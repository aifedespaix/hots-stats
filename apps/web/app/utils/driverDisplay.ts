import type { DriverMetric } from "@hots-stats/shared-types";
import { formatPercent } from "~/composables/useFormat";
import type { Tone } from "~/utils/tone";

/**
 * A4 metrics that are 0-1 shares/rates and render as a percentage; every other
 * metric keeps its own scale, two decimals. The Diagnostic drivers list and the
 * hub's work-axes card both read this, so the two can never disagree.
 */
const PERCENT_KEYS = new Set(["firstDeath", "timeDeadShare"]);

/**
 * Coerces a metric value to a finite number, or null when it is missing or
 * unreadable. A numeric string is accepted (a database driver that hands back
 * decimals as text, a payload built elsewhere); null, undefined, "" and
 * NaN/Infinity are rejected rather than silently becoming 0.
 */
function finiteMetricValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function formatDriverMetric(key: string, value: number): string {
  // Coerce before formatting: a value that reaches the web as a numeric string
  // used to throw on `.toFixed` during render and tear down the whole page --
  // the exact failure mode the Cible field hit. An unreadable value degrades to
  // the shared "no data" dash instead of a blank screen.
  const numeric = finiteMetricValue(value);
  if (numeric === null) return "—";
  return PERCENT_KEYS.has(key) ? formatPercent(numeric) : numeric.toFixed(2);
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
