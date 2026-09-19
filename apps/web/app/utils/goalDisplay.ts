import type { GoalProgress, PlayerGoal } from "@hots-stats/shared-types";
import { formatDriverMetric } from "~/utils/driverDisplay";
import type { Tone } from "~/utils/tone";

/** Current value of a goal, with the A4 formatting for its metric key; an
 * empty sample reads "—" rather than a fabricated 0. */
export function formatGoalValue(goal: Pick<PlayerGoal, "metricKey" | "progress">): string {
  const value = goal.progress.currentValue;
  return value === null ? "—" : formatDriverMetric(goal.metricKey, value);
}

/** The target formatted with the same rule as the current value. */
export function formatGoalTarget(goal: Pick<PlayerGoal, "metricKey" | "targetValue">): string {
  return formatDriverMetric(goal.metricKey, goal.targetValue);
}

/** 0-100 for a progress bar, or null when the goal has no readable sample. */
export function goalPercent(progress: GoalProgress): number | null {
  return progress.ratio === null ? null : Math.round(progress.ratio * 100);
}

/** Colour of a goal card: achieved wins, otherwise neutral -- an unmet goal is
 * not a failure. */
export function goalTone(goal: Pick<PlayerGoal, "progress">): Tone {
  return goal.progress.achieved ? "success" : "default";
}
