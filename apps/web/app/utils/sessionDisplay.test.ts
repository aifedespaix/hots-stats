import { describe, expect, test } from "vitest";
import { deltaTone, formatSignedNumber } from "./sessionDisplay";

describe("deltaTone", () => {
  test("no movement or missing value is neutral", () => {
    expect(deltaTone(0, "higher")).toBe("default");
    expect(deltaTone(null, "lower")).toBe("default");
  });

  test("higher-is-better is green only when the delta is positive", () => {
    expect(deltaTone(0.1, "higher")).toBe("success");
    expect(deltaTone(-0.1, "higher")).toBe("danger");
  });

  test("lower-is-better (deaths) is green only when the delta is negative", () => {
    expect(deltaTone(-1.2, "lower")).toBe("success");
    expect(deltaTone(1.2, "lower")).toBe("danger");
  });
});

describe("formatSignedNumber", () => {
  test("always shows the sign of a rounded non-zero value", () => {
    expect(formatSignedNumber(1.44)).toBe("+1.4");
    expect(formatSignedNumber(-0.34)).toBe("-0.3");
  });

  test("does not print a negative zero", () => {
    expect(formatSignedNumber(-0.01)).toBe("0.0");
    expect(formatSignedNumber(0)).toBe("0.0");
  });
});
