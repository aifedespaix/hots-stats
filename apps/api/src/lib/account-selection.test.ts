import { describe, expect, test } from "bun:test";
import {
  MAX_LINKED_ACCOUNTS,
  TooManyAccountsError,
  intersectSelection,
  parseAccountSelection,
  scopeCondition,
} from "./account-selection";

describe("parseAccountSelection", () => {
  test("absent param means 'all linked' (undefined)", () => {
    expect(parseAccountSelection(undefined)).toBeUndefined();
  });

  test("an empty or comma-only param also means 'all linked'", () => {
    expect(parseAccountSelection("")).toBeUndefined();
    expect(parseAccountSelection(" , ,")).toBeUndefined();
  });

  test("splits, trims and drops empty segments", () => {
    expect(parseAccountSelection(" A#1 , B#2 ,, ")).toEqual(["A#1", "B#2"]);
  });

  test("dedupes case-insensitively, keeping the first spelling seen", () => {
    expect(parseAccountSelection("Aife#21170,aife#21170")).toEqual(["Aife#21170"]);
  });

  test("rejects more than MAX_LINKED_ACCOUNTS entries", () => {
    const many = Array.from({ length: MAX_LINKED_ACCOUNTS + 1 }, (_, i) => "P" + i + "#1").join(",");
    expect(() => parseAccountSelection(many)).toThrow(TooManyAccountsError);
  });

  test("accepts exactly MAX_LINKED_ACCOUNTS entries", () => {
    const many = Array.from({ length: MAX_LINKED_ACCOUNTS }, (_, i) => "P" + i + "#1").join(",");
    expect(parseAccountSelection(many)).toHaveLength(MAX_LINKED_ACCOUNTS);
  });
});

describe("intersectSelection", () => {
  test("keeps only linked tags, case-insensitively, in stored casing", () => {
    expect(intersectSelection(["AIFE#21170", "Inconnu#1"], ["aife#21170", "autre#2"])).toEqual({
      kept: ["aife#21170"],
      missing: ["Inconnu#1"],
    });
  });

  test("an empty linked set marks everything missing", () => {
    expect(intersectSelection(["A#1"], [])).toEqual({ kept: [], missing: ["A#1"] });
  });
});

describe("scopeCondition", () => {
  test("global scope contributes no condition", () => {
    expect(scopeCondition({ mode: "global" }, undefined as never)).toBeUndefined();
  });

  test("an empty personal scope is a condition that matches nothing", () => {
    expect(scopeCondition({ mode: "personal", battletags: [] }, undefined as never)).toBeDefined();
  });

  test("a non-empty personal scope produces a condition", () => {
    expect(scopeCondition({ mode: "personal", battletags: ["A#1"] }, undefined as never)).toBeDefined();
  });
});
