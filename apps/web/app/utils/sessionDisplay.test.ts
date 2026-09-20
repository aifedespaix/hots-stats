import type { SessionSummary } from "@hots-stats/shared-types";
import { describe, expect, test } from "vitest";
import { formatDate } from "~/composables/useFormat";
import {
  SESSION_PICKER_WINDOW_DAYS,
  deltaTone,
  formatDeltaNoise,
  formatSessionOption,
  formatSignedNumber,
  selectableSessions,
} from "./sessionDisplay";

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

  test("a gap inside the noise band is chance, not a result", () => {
    expect(deltaTone(0.2, "higher", 0.3)).toBe("default");
    expect(deltaTone(-0.2, "lower", 0.3)).toBe("default");
  });

  test("a gap past the band keeps its direction colour", () => {
    expect(deltaTone(0.4, "higher", 0.3)).toBe("success");
    expect(deltaTone(-0.4, "higher", 0.3)).toBe("danger");
  });

  test("exactly at the band edge is still chance", () => {
    expect(deltaTone(0.3, "higher", 0.3)).toBe("default");
  });

  test("an unknown band is not read as a zero-width one", () => {
    expect(deltaTone(0.4, "higher", null)).toBe("default");
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

function session(startedAt: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return { startedAt, endedAt: startedAt, gamesPlayed: 3, wins: 2, losses: 1, ...overrides };
}

describe("selectableSessions", () => {
  const NOW = Date.parse("2026-09-12T12:00:00.000Z");
  const DAY = 24 * 60 * 60 * 1000;

  test("keeps only the sessions inside the window, in the order given", () => {
    const recent = session("2026-09-10T20:00:00.000Z");
    const edge = session("2026-08-14T20:00:00.000Z");
    const tooOld = session("2026-08-01T20:00:00.000Z");
    expect(selectableSessions([recent, edge, tooOld], null, NOW)).toEqual([recent, edge]);
  });

  test("always keeps the session currently displayed, even older than the window", () => {
    const recent = session("2026-09-10T20:00:00.000Z");
    const old = session("2026-01-01T20:00:00.000Z");
    expect(selectableSessions([recent, old], old.startedAt, NOW)).toEqual([recent, old]);
  });

  test("uses the 30-day window, boundary included", () => {
    expect(SESSION_PICKER_WINDOW_DAYS).toBe(30);
    const exactlyAtThreshold = session(new Date(NOW - 30 * DAY).toISOString());
    const justOutside = session(new Date(NOW - 30 * DAY - 1000).toISOString());
    expect(selectableSessions([exactlyAtThreshold, justOutside], null, NOW)).toEqual([
      exactlyAtThreshold,
    ]);
  });

  test("returns nothing for no session", () => {
    expect(selectableSessions([], null, NOW)).toEqual([]);
  });
});

describe("formatDeltaNoise", () => {
  test("formats each metric on its own scale", () => {
    expect(formatDeltaNoise(0.481, "winrate")).toBe("± 48 pts");
    expect(formatDeltaNoise(0.43, "kda")).toBe("± 0.43");
    expect(formatDeltaNoise(1.24, "deathsPer10Min")).toBe("± 1.2");
    expect(formatDeltaNoise(44.6, "xpPerMinute")).toBe("± 45");
  });

  test("an unknown band has no label rather than a fake zero", () => {
    expect(formatDeltaNoise(null, "winrate")).toBe("");
  });
});

describe("formatSessionOption", () => {
  test("labels a session with its date, game count and record", () => {
    const entry = session("2026-09-12T20:15:00.000Z", { gamesPlayed: 5, wins: 3, losses: 2 });
    expect(formatSessionOption(entry)).toBe(`${formatDate(entry.startedAt)} · 5 parties · 3V-2D`);
  });

  test("singularises a one-game session", () => {
    const entry = session("2026-09-12T20:15:00.000Z", { gamesPlayed: 1, wins: 0, losses: 1 });
    expect(formatSessionOption(entry)).toBe(`${formatDate(entry.startedAt)} · 1 partie · 0V-1D`);
  });
});
