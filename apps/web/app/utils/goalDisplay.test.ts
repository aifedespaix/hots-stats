import { describe, expect, test } from "vitest";
import type { GoalProgress, PlayerGoal } from "@hots-stats/shared-types";
import { formatGoalTarget, formatGoalValue, goalPercent, goalTone } from "./goalDisplay";

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
