import { describe, expect, test } from "bun:test";
import { dedupeLookupRows } from "./match-lookup.service";

const row = (matchId: string, hero: string | null) => ({
  matchId,
  replayHash: `${matchId}-hash`,
  parserVersion: "1.19",
  map: "cursed-hollow",
  gameMode: "ARAM",
  playedAt: new Date("2026-09-30T19:14:03Z"),
  hero,
  won: hero === null ? null : true,
});

describe("dedupeLookupRows", () => {
  test("two linked BattleTags in one game yield a single row, preferring the one with a hero", () => {
    const out = dedupeLookupRows([row("m1", null), row("m1", "Xalatath"), row("m2", "Abathur")]);
    expect(out.map((o) => [o.matchId, o.hero])).toEqual([
      ["m1", "Xalatath"],
      ["m2", "Abathur"],
    ]);
  });

  test("serialises playedAt as an ISO string", () => {
    expect(dedupeLookupRows([row("m1", "X")])[0]?.playedAt).toBe("2026-09-30T19:14:03.000Z");
  });
});
