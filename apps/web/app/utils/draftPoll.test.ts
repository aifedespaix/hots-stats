import type { DraftSnapshot } from "@hots-stats/shared-types";
import { describe, expect, test } from "vitest";
import {
  DRAFT_POLL_RETRY_MAX_DELAY_MS,
  draftPollRetryDelayMs,
  shouldReplaceDraftSnapshot,
} from "./draftPoll";

describe("draftPollRetryDelayMs", () => {
  test("grows exponentially from the base delay", () => {
    expect(draftPollRetryDelayMs(1)).toBe(2_000);
    expect(draftPollRetryDelayMs(2)).toBe(4_000);
    expect(draftPollRetryDelayMs(3)).toBe(8_000);
  });

  test("caps at the max delay", () => {
    expect(draftPollRetryDelayMs(20)).toBe(DRAFT_POLL_RETRY_MAX_DELAY_MS);
  });

  test("treats a non-positive failure count as the first attempt", () => {
    expect(draftPollRetryDelayMs(0)).toBe(2_000);
  });
});

describe("shouldReplaceDraftSnapshot", () => {
  const snapshot = { id: "draft-1" } as DraftSnapshot;

  test("replaces the value when the snapshot id changed", () => {
    expect(shouldReplaceDraftSnapshot("draft-1", { id: "draft-2", snapshot })).toBe(true);
  });

  test("keeps the current value when the id is unchanged", () => {
    expect(shouldReplaceDraftSnapshot("draft-1", { id: "draft-1", snapshot })).toBe(false);
  });

  test("replaces the value on the first answer", () => {
    expect(shouldReplaceDraftSnapshot(null, { id: "draft-1", snapshot })).toBe(true);
  });

  test("replaces the value on an explicit no-draft answer even with an unchanged id", () => {
    expect(shouldReplaceDraftSnapshot(null, { id: null, snapshot: null })).toBe(true);
  });
});
