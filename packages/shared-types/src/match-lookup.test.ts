import { describe, expect, test } from "bun:test";
import { MATCH_LOOKUP_MAX, matchLookupInputSchema } from "./match-lookup";

const hash = "a".repeat(64);
const id = "3f0c1a52-7d0e-4c55-9d73-0d3a4f3b5c11";

describe("matchLookupInputSchema", () => {
  test("accepts hashes, ids, or both", () => {
    expect(matchLookupInputSchema.safeParse({ replayHashes: [hash] }).success).toBe(true);
    expect(matchLookupInputSchema.safeParse({ matchIds: [id] }).success).toBe(true);
    expect(matchLookupInputSchema.safeParse({ replayHashes: [hash], matchIds: [id] }).success).toBe(true);
  });

  test("rejects an empty lookup", () => {
    expect(matchLookupInputSchema.safeParse({}).success).toBe(false);
    expect(matchLookupInputSchema.safeParse({ replayHashes: [], matchIds: [] }).success).toBe(false);
  });

  test("the limit is on hashes and ids combined", () => {
    const ids = Array.from({ length: MATCH_LOOKUP_MAX }, () => id);
    expect(matchLookupInputSchema.safeParse({ matchIds: ids }).success).toBe(true);
    expect(matchLookupInputSchema.safeParse({ matchIds: ids, replayHashes: [hash] }).success).toBe(false);
  });

  test("rejects a malformed match id", () => {
    expect(matchLookupInputSchema.safeParse({ matchIds: ["nope"] }).success).toBe(false);
  });
});
