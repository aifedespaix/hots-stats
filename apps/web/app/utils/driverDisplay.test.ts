import type { DriverMetric } from "@hots-stats/shared-types";
import { describe, expect, test } from "vitest";
import { buildDriverRows, driverTone, formatDriverMetric } from "./driverDisplay";

function driver(overrides: Partial<DriverMetric>): DriverMetric {
  return {
    key: "deathsPer10Min",
    label: "Morts / 10 min",
    betterWhen: "lower",
    meanInWins: 4,
    meanInLosses: 7,
    effectSize: -1.2,
    winsSample: 20,
    lossesSample: 20,
    reliable: true,
    ...overrides,
  };
}

describe("formatDriverMetric", () => {
  test("renders 0-1 share metrics as a percentage", () => {
    expect(formatDriverMetric("timeDeadShare", 0.123)).toBe("12%");
    expect(formatDriverMetric("firstDeath", 0.5)).toBe("50%");
  });

  test("renders every other metric on its own two-decimal scale", () => {
    expect(formatDriverMetric("deathsPer10Min", 3.456)).toBe("3.46");
    expect(formatDriverMetric("xpPerMinute", 512)).toBe("512.00");
  });

  test("coerces a numeric string and never throws on an unreadable value", () => {
    // A decimal handed back as text must still render, not throw on .toFixed.
    expect(formatDriverMetric("xpPerMinute", "450.5" as unknown as number)).toBe("450.50");
    expect(formatDriverMetric("deathsPer10Min", "3" as unknown as number)).toBe("3.00");
    // NaN/Infinity/null/undefined degrade to the shared "no data" dash.
    expect(formatDriverMetric("xpPerMinute", Number.NaN)).toBe("—");
    expect(formatDriverMetric("xpPerMinute", Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatDriverMetric("xpPerMinute", null as unknown as number)).toBe("—");
    expect(formatDriverMetric("xpPerMinute", undefined as unknown as number)).toBe("—");
  });
});

describe("driverTone", () => {
  test("is success when wins sit on the metric's good side", () => {
    expect(driverTone(driver({ betterWhen: "lower", meanInWins: 4, meanInLosses: 7 }))).toBe("success");
    expect(driverTone(driver({ betterWhen: "higher", meanInWins: 600, meanInLosses: 420 }))).toBe("success");
  });

  test("is danger when wins sit on the metric's bad side", () => {
    expect(driverTone(driver({ betterWhen: "lower", meanInWins: 7, meanInLosses: 4 }))).toBe("danger");
    expect(driverTone(driver({ betterWhen: "higher", meanInWins: 420, meanInLosses: 600 }))).toBe("danger");
  });

  test("is muted when the sample is not reliable or the means are equal", () => {
    expect(driverTone(driver({ reliable: false }))).toBe("default");
    expect(driverTone(driver({ meanInWins: 5, meanInLosses: 5 }))).toBe("default");
  });
});

describe("buildDriverRows", () => {
  test("keeps the API order and formats every cell", () => {
    const rows = buildDriverRows([
      driver({
        key: "firstDeath",
        label: "Première mort",
        betterWhen: "lower",
        meanInWins: 0.2,
        meanInLosses: 0.6,
        effectSize: -0.83,
        winsSample: 31,
        lossesSample: 24,
      }),
      driver({
        key: "xpPerMinute",
        label: "XP / min",
        betterWhen: "higher",
        meanInWins: 612.4,
        meanInLosses: 540.2,
        effectSize: 0.61,
        winsSample: 31,
        lossesSample: 24,
      }),
    ]);

    expect(rows.map((row) => row.key)).toEqual(["firstDeath", "xpPerMinute"]);
    expect(rows[0]).toMatchObject({
      label: "Première mort",
      valueInWins: "20%",
      valueInLosses: "60%",
      effect: "-0.83",
      sample: "31 V / 24 D",
      tone: "success",
      reliable: true,
    });
    expect(rows[1]).toMatchObject({ valueInWins: "612.40", effect: "+0.61" });
  });

  test("never renders a signed zero effect", () => {
    const rows = buildDriverRows([driver({ effectSize: -0.001 })]);
    expect(rows[0]?.effect).toBe("0.00");
  });

  test("returns an empty list for no drivers", () => {
    expect(buildDriverRows([])).toEqual([]);
  });
});
