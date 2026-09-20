import { describe, expect, test } from "bun:test";
import { matchObjectiveEventSchema, matchTimelineSchema } from "./replay-payload";

describe("matchObjectiveEventSchema", () => {
  test("accepts a camp capture with a team and a detail", () => {
    const parsed = matchObjectiveEventSchema.parse({
      kind: "mercenaryCamp",
      team: 1,
      atSeconds: 159,
      detail: "Siege Camp",
    });
    expect(parsed).toEqual({ kind: "mercenaryCamp", team: 1, atSeconds: 159, detail: "Siege Camp" });
  });

  test("accepts a team-less kind", () => {
    const parsed = matchObjectiveEventSchema.parse({ kind: "templeActivated", team: null, atSeconds: 12 });
    expect(parsed.team).toBeNull();
  });

  test("rejects an unknown kind", () => {
    expect(matchObjectiveEventSchema.safeParse({ kind: "victory", team: 0, atSeconds: 1 }).success).toBe(false);
  });

  test("rejects an out-of-range team and a negative timestamp", () => {
    expect(matchObjectiveEventSchema.safeParse({ kind: "tribute", team: 2, atSeconds: 1 }).success).toBe(false);
    expect(matchObjectiveEventSchema.safeParse({ kind: "tribute", team: 0, atSeconds: -1 }).success).toBe(false);
  });
});

describe("matchTimelineSchema objectives", () => {
  test("still validates without objectives (backward compatible)", () => {
    expect(matchTimelineSchema.safeParse({ deaths: [], levelSnapshots: [] }).success).toBe(true);
  });

  test("accepts objectives", () => {
    const parsed = matchTimelineSchema.safeParse({
      deaths: [],
      levelSnapshots: [],
      objectives: [{ kind: "curse", team: 0, atSeconds: 5 }],
    });
    expect(parsed.success).toBe(true);
  });
});
