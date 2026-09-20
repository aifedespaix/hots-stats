import { describe, expect, test } from "vitest";
import { timelineTeamLabels } from "~/composables/useMatchTimelineSeries";
import {
  OBJECTIVE_KIND_LABELS,
  objectiveEventLabel,
  objectiveKindLabel,
  objectiveSideLabel,
} from "./objectiveEvents";

describe("objectiveKindLabel", () => {
  test("labels every supported kind in French", () => {
    expect(objectiveKindLabel("mercenaryCamp")).toBe("Camp mercenaire");
    expect(objectiveKindLabel("immortalDefeated")).toBe("Immortel vaincu");
  });

  test("falls back to the raw slug rather than crashing on an unknown kind", () => {
    expect(objectiveKindLabel("someFutureKind")).toBe("someFutureKind");
  });
});

describe("objectiveEventLabel", () => {
  test("appends the detail when there is one", () => {
    expect(objectiveEventLabel({ kind: "mercenaryCamp", team: 1, atSeconds: 60, detail: "Siege Camp" })).toBe(
      "Camp mercenaire · Siege Camp",
    );
  });

  test("omits the detail when there is none", () => {
    expect(objectiveEventLabel({ kind: "tribute", team: 0, atSeconds: 60 })).toBe("Tribut");
  });
});

describe("objectiveSideLabel", () => {
  test("names the side from the shared team labels", () => {
    expect(objectiveSideLabel(0, timelineTeamLabels(0))).toBe("mon équipe");
    expect(objectiveSideLabel(1, timelineTeamLabels(0))).toBe("les adversaires");
    expect(objectiveSideLabel(null, timelineTeamLabels(null))).toBe("équipe inconnue");
  });
});

describe("OBJECTIVE_KIND_LABELS", () => {
  test("covers all 19 kinds", () => {
    expect(Object.keys(OBJECTIVE_KIND_LABELS)).toHaveLength(19);
  });
});
