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

/**
 * The Cible field is a `UInput type="number"`: Nuxt UI normalises its value to
 * a number as soon as it parses (Input.vue's looseToNumber), so the bound ref
 * holds a string only while empty. Calling a string method on it directly
 * throws during render and tears the whole page down -- always coerce first.
 */
export function goalTargetText(value: unknown): string {
  return String(value ?? "").trim();
}

/** Whether the Cible field holds something. */
export function hasGoalTarget(value: unknown): boolean {
  return goalTargetText(value) !== "";
}

/** Parses the Cible field to a finite number, or null when it is empty or not
 * a number. Accepts a comma decimal separator (French keyboard). */
export function parseGoalTarget(value: unknown): number | null {
  const text = goalTargetText(value).replace(",", ".");
  if (text === "") return null;
  const target = Number(text);
  return Number.isFinite(target) ? target : null;
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
