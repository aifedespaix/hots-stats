import {
  GOAL_SUGGESTION_MARGIN,
  GOAL_SUGGESTION_WINDOW_DAYS,
  type DriverMetric,
  type GoalDirection,
  type GoalSuggestion,
  type GoalSuggestionGroup,
} from "@hots-stats/shared-types";
import { type DriverMatchInput, computeDrivers } from "./driver-analysis";

/** How many suggestions one scope may contribute (global / top hero / 2nd). */
export const SUGGESTIONS_PER_SCOPE = 2;

/** One scope the suggestions are built for: the whole account, or one hero. */
export interface GoalSuggestionScope {
  group: GoalSuggestionGroup;
  heroId: string | null;
  heroName: string | null;
}

/** One scope's already-loaded window match inputs. */
export interface GoalSuggestionInput {
  scope: GoalSuggestionScope;
  matches: DriverMatchInput[];
}

/** Rounds to 2 decimals, the precision the metric formatters display. */
export function roundSuggestionValue(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Moves a baseline 10% in the direction the metric is good in: +10% for a
 * floor metric, -10% for a ceiling metric. Expressed in the metric's own unit,
 * so a count, a per-minute rate and a 0-1 share all use the same rule.
 */
export function suggestedTarget(betterWhen: "higher" | "lower", baseline: number): number {
  const factor = betterWhen === "higher" ? 1 + GOAL_SUGGESTION_MARGIN : 1 - GOAL_SUGGESTION_MARGIN;
  return roundSuggestionValue(baseline * factor);
}

/**
 * The metric's mean over every readable match in the scope (wins + losses), or
 * null when nothing was readable. Reconstructed from the driver's two
 * conditional means so it never needs a second pass over the matches.
 */
export function suggestionBaseline(driver: DriverMetric): number | null {
  const total = driver.winsSample + driver.lossesSample;
  if (total === 0) return null;
  return (driver.meanInWins * driver.winsSample + driver.meanInLosses * driver.lossesSample) / total;
}

function rationaleFor(scope: GoalSuggestionScope, rank: number): string {
  const window = `${GOAL_SUGGESTION_WINDOW_DAYS} derniers jours`;
  return scope.heroName
    ? `Axe de travail n°${rank} avec ${scope.heroName} (${window}).`
    : `Axe de travail n°${rank} sur l'ensemble de tes héros (${window}).`;
}

/**
 * Turns already-loaded scopes into at most `SUGGESTIONS_PER_SCOPE` suggestions
 * each, taking the most marked A4 work axes first (computeDrivers already sorts
 * reliable-first, then by |effectSize|). Pure: the DB loading lives in
 * goals.service.ts, so the selection and target maths are testable without a
 * database.
 */
export function buildGoalSuggestions(inputs: GoalSuggestionInput[]): GoalSuggestion[] {
  const suggestions: GoalSuggestion[] = [];
  for (const { scope, matches } of inputs) {
    let rank = 0;
    for (const driver of computeDrivers(matches)) {
      const mean = suggestionBaseline(driver);
      if (mean === null) continue;
      const baselineValue = roundSuggestionValue(mean);
      const direction: GoalDirection = driver.betterWhen === "higher" ? "atLeast" : "atMost";
      const targetValue = suggestedTarget(driver.betterWhen, baselineValue);
      // A null target means the metric is already at its floor (e.g. a
      // "lower" metric the player never loses): proposing 0 would be a
      // no-op goal, so let the next axis take the slot instead.
      if (targetValue <= 0) continue;
      rank += 1;
      if (rank > SUGGESTIONS_PER_SCOPE) break;
      suggestions.push({
        metricKey: driver.key,
        metricLabel: driver.label,
        direction,
        targetValue,
        baselineValue,
        sampleSize: driver.winsSample + driver.lossesSample,
        reliable: driver.reliable,
        group: scope.group,
        heroId: scope.heroId,
        heroName: scope.heroName,
        rationale: rationaleFor(scope, rank),
      });
    }
  }
  return suggestions;
}
