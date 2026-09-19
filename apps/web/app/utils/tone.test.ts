import { describe, expect, test } from "vitest";
import { outcomeGlyph, winrateGlyph } from "./tone";

describe("outcomeGlyph", () => {
  test("points up for a win and down for a loss", () => {
    expect(outcomeGlyph(true)).toBe("▲");
    expect(outcomeGlyph(false)).toBe("▼");
  });
});

describe("winrateGlyph", () => {
  test("points up at or above the threshold", () => {
    expect(winrateGlyph(0.5)).toBe("▲");
    expect(winrateGlyph(0.62)).toBe("▲");
  });

  test("points down below the threshold", () => {
    expect(winrateGlyph(0.49)).toBe("▼");
    expect(winrateGlyph(0)).toBe("▼");
  });

  test("has no glyph without a winrate", () => {
    expect(winrateGlyph(null)).toBeNull();
    expect(winrateGlyph(undefined)).toBeNull();
  });

  test("honours a custom threshold like winrateTone does", () => {
    expect(winrateGlyph(0.2, 0)).toBe("▲");
    expect(winrateGlyph(-0.1, 0)).toBe("▼");
  });
});
