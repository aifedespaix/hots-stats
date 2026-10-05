import { describe, expect, test } from "bun:test";
import { daemonErrorReportInputSchema } from "./daemon-error";

const base = {
  replayHash: null,
  baseBuild: null,
  errorType: "runtime",
  errorMessage: "boom",
  errorLog: null,
  parserVersion: "1.19",
  daemonVersion: "1.0.55",
};

describe("daemonErrorReportInputSchema", () => {
  test("accepts the three new error types", () => {
    for (const errorType of ["quarantine", "runtime", "dependency"]) {
      expect(daemonErrorReportInputSchema.safeParse({ ...base, errorType }).success).toBe(true);
    }
  });

  test("still accepts a report from an older daemon (no new fields) and defaults occurrences to 1", () => {
    const parsed = daemonErrorReportInputSchema.parse({ ...base, errorType: "parse" });
    expect(parsed.occurrences).toBe(1);
    expect(parsed.fingerprint).toBeUndefined();
  });

  test("rejects an unknown type and a non-positive occurrences count", () => {
    expect(daemonErrorReportInputSchema.safeParse({ ...base, errorType: "nope" }).success).toBe(false);
    expect(daemonErrorReportInputSchema.safeParse({ ...base, occurrences: 0 }).success).toBe(false);
  });
});
