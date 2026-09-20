import { describe, expect, test } from "vitest";
import type { GoalProgress, PlayerGoal } from "@hots-stats/shared-types";
import {
  formatGoalTarget,
  formatGoalValue,
  goalPercent,
  goalTone,
  hasGoalTarget,
  parseGoalTarget,
} from "./goalDisplay";

function progress(overrides: Partial<GoalProgress> = {}): GoalProgress {
  return {
    currentValue: 1,
    targetValue: 1,
    direction: "atMost",
    matchesSinceCreated: 12,
    sampleSize: 12,
    reliable: false,
    achieved: true,
    ratio: 1,
    ...overrides,
  };
}

function goal(overrides: Partial<PlayerGoal> = {}): PlayerGoal {
  return {
    id: "g1",
    metricKey: "earlyDeaths",
    targetValue: 1,
    direction: "atMost",
    scopeHeroId: null,
    scopeMapId: null,
    dueAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    achievedAt: null,
    progress: progress(),
    ...overrides,
  };
}

describe("goalDisplay", () => {
  test("renders an empty sample as a dash, never a fabricated 0", () => {
    expect(formatGoalValue(goal({ progress: progress({ currentValue: null }) }))).toBe("—");
  });

  test("uses the A4 formatting for shares and plain metrics", () => {
    expect(formatGoalValue(goal({ metricKey: "firstDeath", progress: progress({ currentValue: 0.5 }) }))).toBe("50%");
    expect(formatGoalTarget(goal({ metricKey: "xpPerMinute", targetValue: 450 }))).toBe("450.00");
  });

  test("converts the ratio to a 0-100 bar or null", () => {
    expect(goalPercent(progress({ ratio: 0.82 }))).toBe(82);
    expect(goalPercent(progress({ ratio: null }))).toBeNull();
  });

  test("an unmet goal is neutral, a met one is a success", () => {
    expect(goalTone(goal({ progress: progress({ achieved: false }) }))).toBe("default");
    expect(goalTone(goal({ progress: progress({ achieved: true }) }))).toBe("success");
  });
});

// Regression: UInput type="number" emits a number, so the Cible field can no
// longer be treated as a string (the old `targetValue.trim()` crashed the
// whole page as soon as a target was typed).
describe("goal target input", () => {
  test("accepts the number UInput emits for type=number", () => {
    expect(hasGoalTarget(450)).toBe(true);
    expect(parseGoalTarget(450)).toBe(450);
  });

  test("treats an empty or missing field as no target", () => {
    expect(hasGoalTarget("")).toBe(false);
    expect(hasGoalTarget("   ")).toBe(false);
    expect(hasGoalTarget(null)).toBe(false);
    expect(hasGoalTarget(undefined)).toBe(false);
    expect(parseGoalTarget("")).toBeNull();
  });

  test("accepts a comma decimal separator", () => {
    expect(parseGoalTarget("12,5")).toBe(12.5);
  });

  test("rejects text that is not a number", () => {
    expect(parseGoalTarget("abc")).toBeNull();
  });
});
