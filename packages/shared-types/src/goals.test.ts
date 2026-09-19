import { describe, expect, test } from "bun:test";
import { goalInputSchema, goalUpdateSchema } from "./goals";

const valid = {
  metricKey: "earlyDeaths",
  targetValue: 1,
  direction: "atMost" as const,
};

describe("goalInputSchema", () => {
  test("accepts a minimal goal", () => {
    expect(goalInputSchema.safeParse(valid).success).toBe(true);
  });

  test("rejects an unknown direction", () => {
    expect(goalInputSchema.safeParse({ ...valid, direction: "around" }).success).toBe(false);
  });

  test("rejects a non-finite target", () => {
    expect(goalInputSchema.safeParse({ ...valid, targetValue: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  test("rejects an empty metric key", () => {
    expect(goalInputSchema.safeParse({ ...valid, metricKey: "" }).success).toBe(false);
  });

  test("accepts null hero/map scopes and an ISO deadline", () => {
    const parsed = goalInputSchema.safeParse({
      ...valid,
      scopeHeroId: null,
      scopeMapId: "garden-of-terror-classic",
      dueAt: "2026-10-01T00:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("goalUpdateSchema", () => {
  test("accepts a partial body", () => {
    expect(goalUpdateSchema.safeParse({ targetValue: 450 }).success).toBe(true);
    expect(goalUpdateSchema.safeParse({}).success).toBe(true);
  });
});
