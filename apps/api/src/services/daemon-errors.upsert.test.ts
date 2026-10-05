import { describe, expect, test } from "bun:test";
import { daemonErrorReportInputSchema } from "@hots-stats/shared-types";
import { buildErrorUpsert } from "./daemon-errors.service";

const now = new Date("2026-10-05T10:00:00Z");
const parse = (over: Record<string, unknown>) =>
  daemonErrorReportInputSchema.parse({
    replayHash: null,
    baseBuild: null,
    errorType: "runtime",
    errorMessage: "boom",
    errorLog: null,
    parserVersion: "1.19",
    daemonVersion: "1.0.55",
    ...over,
  });

describe("buildErrorUpsert", () => {
  test("a report with a replayHash is keyed on (user, replay) and ignores the fingerprint", () => {
    const plan = buildErrorUpsert("u1", parse({ replayHash: "a".repeat(64), fingerprint: "f".repeat(32) }), now);
    expect(plan.kind).toBe("replay");
    expect(plan.values.fingerprint).toBeNull();
  });

  test("a report without a replayHash but with a fingerprint is keyed on (user, fingerprint)", () => {
    const plan = buildErrorUpsert("u1", parse({ fingerprint: "f".repeat(32) }), now);
    expect(plan.kind).toBe("fingerprint");
    expect(plan.values.fingerprint).toBe("f".repeat(32));
  });

  test("a report with neither is a plain insert", () => {
    expect(buildErrorUpsert("u1", parse({}), now).kind).toBe("insert");
  });

  test("occurrences seed the first row's count", () => {
    expect(buildErrorUpsert("u1", parse({ occurrences: 7 }), now).values.occurrenceCount).toBe(7);
  });
});
