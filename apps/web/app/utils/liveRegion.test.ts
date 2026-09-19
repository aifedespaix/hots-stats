import { describe, expect, test } from "vitest";
import { LIVE_ANNOUNCE_INTERVAL_MS, formatCapturedAgo, shouldAnnounce } from "./liveRegion";

describe("formatCapturedAgo", () => {
  test("renders seconds under a minute", () => {
    expect(formatCapturedAgo(0)).toBe("Capturée il y a 0s");
    expect(formatCapturedAgo(59)).toBe("Capturée il y a 59s");
  });

  test("renders minutes under an hour", () => {
    expect(formatCapturedAgo(60)).toBe("Capturée il y a 1 min");
    expect(formatCapturedAgo(3599)).toBe("Capturée il y a 60 min");
  });

  test("renders hours beyond an hour", () => {
    expect(formatCapturedAgo(3600)).toBe("Capturée il y a 1 h");
    expect(formatCapturedAgo(7199)).toBe("Capturée il y a 2 h");
  });

  test("clamps negative and non-finite inputs instead of inventing a label", () => {
    expect(formatCapturedAgo(-5)).toBe("Capturée il y a 0s");
    expect(formatCapturedAgo(Number.NaN)).toBe("");
  });
});

describe("shouldAnnounce", () => {
  test("announces the first reading immediately", () => {
    expect(shouldAnnounce(null, 1_000)).toBe(true);
  });

  test("waits the full interval between announcements", () => {
    expect(shouldAnnounce(0, LIVE_ANNOUNCE_INTERVAL_MS - 1)).toBe(false);
    expect(shouldAnnounce(0, LIVE_ANNOUNCE_INTERVAL_MS)).toBe(true);
  });

  test("does not announce again when the clock goes backwards", () => {
    expect(shouldAnnounce(10_000, 9_000)).toBe(false);
  });

  test("accepts a custom interval", () => {
    expect(shouldAnnounce(0, 500, 500)).toBe(true);
  });
});
