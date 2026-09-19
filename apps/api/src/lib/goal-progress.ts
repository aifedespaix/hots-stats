import {
  PROGRESSION_MIN_MATCHES,
  type GoalDirection,
  type GoalProgress,
} from "@hots-stats/shared-types";
import { driverMetricValue, type DriverMatchInput } from "./driver-analysis";

/** The persisted goal columns that affect the maths. */
export interface GoalProgressSpec {
  metricKey: string;
  targetValue: number;
  direction: GoalDirection;
  createdAt: Date;
}

function mean(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return values.length > 0 ? sum / values.length : 0;
}

function clamp01(value: number): number {
  if (!(value > 0)) return 0;
  return value > 1 ? 1 : value;
}

function meetsTarget(current: number, target: number, direction: GoalDirection): boolean {
  return direction === "atLeast" ? current >= target : current <= target;
}

/**
 * Fraction of the way from a zero baseline to the target, in [0, 1]:
 * "atLeast" reads current/target, "atMost" reads target/current (a value at or
 * under the ceiling is already 100%). A zero target is binary all-or-nothing.
 * Never NaN or Infinity.
 */
function progressRatio(current: number, target: number, direction: GoalDirection): number {
  if (direction === "atLeast") {
    if (!(target > 0)) return current >= target ? 1 : 0;
    return clamp01(current / target);
  }
  if (current <= target) return 1;
  if (!(target > 0)) return 0;
  return clamp01(target / current);
}

/**
 * Progress of a goal over the matches played strictly after it was created.
 * Metric values come from the shared A4 definitions (`driverMetricValue`), so
 * a goal can never disagree with the Diagnostic on what "deaths / 10 min"
 * means. Matches without a readable value still count in
 * `matchesSinceCreated` but not in `sampleSize`; with an empty sample
 * `currentValue` stays null and `achieved` false rather than reporting 0.
 */
export function computeGoalProgress(
  goal: GoalProgressSpec,
  matches: DriverMatchInput[],
): GoalProgress {
  const createdAtMs = goal.createdAt.getTime();
  const values: number[] = [];
  let matchesSinceCreated = 0;
  for (const match of matches) {
    const playedAtMs = new Date(match.playedAt).getTime();
    if (!(playedAtMs > createdAtMs)) continue;
    matchesSinceCreated += 1;
    const value = driverMetricValue(goal.metricKey, match);
    if (value !== null) values.push(value);
  }

  if (values.length === 0) {
    return {
      currentValue: null,
      targetValue: goal.targetValue,
      direction: goal.direction,
      matchesSinceCreated,
      sampleSize: 0,
      reliable: false,
      achieved: false,
      ratio: null,
    };
  }

  const currentValue = mean(values);
  return {
    currentValue,
    targetValue: goal.targetValue,
    direction: goal.direction,
    matchesSinceCreated,
    sampleSize: values.length,
    reliable: values.length >= PROGRESSION_MIN_MATCHES,
    achieved: meetsTarget(currentValue, goal.targetValue, goal.direction),
    ratio: progressRatio(currentValue, goal.targetValue, goal.direction),
  };
}
