import { describe, expect, test } from "vitest";
import { withReducedMotion } from "./chartMotion";

describe("withReducedMotion", () => {
  test("disables Chart.js animation when reduced motion is on, even over a caller's own animation", () => {
    expect(withReducedMotion({ responsive: true, animation: { duration: 400 } }, true)).toEqual({
      responsive: true,
      animation: false,
    });
  });

  test("leaves the options untouched when motion is allowed", () => {
    const options = { responsive: true };
    expect(withReducedMotion(options, false)).toBe(options);
  });
});
