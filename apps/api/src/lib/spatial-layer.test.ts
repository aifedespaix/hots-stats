import { describe, expect, test } from "bun:test";
import { DEFAULT_LAYER_KEY, fromDbLayer, toDbLayer } from "./spatial-layer";

describe("toDbLayer", () => {
  test("maps null to the default sentinel", () => {
    expect(toDbLayer(null)).toBe(DEFAULT_LAYER_KEY);
  });
  test("maps undefined to the default sentinel", () => {
    expect(toDbLayer(undefined)).toBe(DEFAULT_LAYER_KEY);
  });
  test("passes a real layer key through unchanged", () => {
    expect(toDbLayer("bottom")).toBe("bottom");
  });
});

describe("fromDbLayer", () => {
  test("maps the default sentinel back to null", () => {
    expect(fromDbLayer(DEFAULT_LAYER_KEY)).toBeNull();
  });
  test("passes a real layer key through unchanged", () => {
    expect(fromDbLayer("bottom")).toBe("bottom");
  });
});
