import { describe, expect, test } from "bun:test";
import { draftSnapshotInputSchema } from "./draft";

type SlotNumber = 1 | 2 | 3 | 4 | 5;

function slot(slotNumber: SlotNumber, rawName: string | null) {
  return { slot: slotNumber, rawName, status: rawName ? ("ok" as const) : ("unreadable" as const) };
}

function team(prefix: string) {
  return ([1, 2, 3, 4, 5] as SlotNumber[]).map((n) => ({ ...slot(n, `${prefix}${n}`), heroName: `Hero${n}` }));
}

describe("draftSnapshotInputSchema", () => {
  test("carries the battleground and the per-slot hero names", () => {
    const parsed = draftSnapshotInputSchema.parse({
      capturedAt: "2026-09-19T10:00:00Z",
      mapName: "GARDEN OF TERROR CLASSIC",
      teamLeft: team("Player"),
      teamRight: team("Enemy"),
    });

    expect(parsed.mapName).toBe("GARDEN OF TERROR CLASSIC");
    expect(parsed.teamLeft[0]!.heroName).toBe("Hero1");
    expect(parsed.teamRight[4]!.heroName).toBe("Hero5");
  });

  test("accepts a null hero name for an unreadable plate", () => {
    const parsed = draftSnapshotInputSchema.parse({
      capturedAt: "2026-09-19T10:00:00Z",
      mapName: null,
      teamLeft: [{ ...slot(1, "Player1"), heroName: null }, ...[2, 3, 4, 5].map((n) => slot(n as SlotNumber, `Player${n}`))],
      teamRight: ([1, 2, 3, 4, 5] as SlotNumber[]).map((n) => slot(n, `Enemy${n}`)),
    });

    expect(parsed.mapName).toBeNull();
    expect(parsed.teamLeft[0]!.heroName).toBeNull();
  });

  test("still parses a legacy payload without the new fields", () => {
    const parsed = draftSnapshotInputSchema.parse({
      capturedAt: "2026-09-19T10:00:00Z",
      teamLeft: ([1, 2, 3, 4, 5] as SlotNumber[]).map((n) => slot(n, `Player${n}`)),
      teamRight: ([1, 2, 3, 4, 5] as SlotNumber[]).map((n) => slot(n, null)),
    });

    expect(parsed.mapName).toBeUndefined();
    expect(parsed.teamLeft[0]!.heroName).toBeUndefined();
  });

  test("rejects an over-long map name", () => {
    const result = draftSnapshotInputSchema.safeParse({
      capturedAt: "2026-09-19T10:00:00Z",
      mapName: "x".repeat(65),
      teamLeft: team("Player"),
      teamRight: team("Enemy"),
    });

    expect(result.success).toBe(false);
  });
});
