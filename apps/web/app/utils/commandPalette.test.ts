import { describe, expect, test } from "vitest";
import {
  flattenCommandGroups,
  friendCommandEntries,
  groupCommandEntries,
  heroCommandEntries,
  mapCommandEntries,
  matchCommandEntries,
  moveCommandSelection,
  normalizeCommandText,
  pageCommandEntries,
  scoreCommandEntry,
  type CommandPaletteEntry,
} from "./commandPalette";

function entry(overrides: Partial<CommandPaletteEntry>): CommandPaletteEntry {
  return { id: "e", label: "L", group: "pages", ...overrides };
}

describe("normalizeCommandText", () => {
  test("lowercases, strips accents and collapses whitespace", () => {
    expect(normalizeCommandText("  Méphisto   LE  Roi ")).toBe("mephisto le roi");
  });
});

describe("scoreCommandEntry", () => {
  test("ranks an exact label above a prefix above a substring", () => {
    const exact = scoreCommandEntry(entry({ label: "Garden" }), "garden")!;
    const prefix = scoreCommandEntry(entry({ label: "Garden of Terror" }), "garden")!;
    const word = scoreCommandEntry(entry({ label: "Garden of Terror" }), "terror")!;
    const inside = scoreCommandEntry(entry({ label: "Terrorgarden" }), "garden")!;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inside);
  });

  test("matches keywords below the label", () => {
    const label = scoreCommandEntry(entry({ label: "Anub'arak" }), "anub")!;
    const keyword = scoreCommandEntry(entry({ label: "Anub'arak", keywords: ["Tank"] }), "tank")!;
    expect(label).toBeGreaterThan(keyword);
  });

  test("is accent and case insensitive", () => {
    expect(scoreCommandEntry(entry({ label: "Méphisto" }), "mephisto")).not.toBeNull();
    expect(scoreCommandEntry(entry({ label: "Méphisto" }), "MEPHISTO")).not.toBeNull();
  });

  test("returns null when nothing matches", () => {
    expect(scoreCommandEntry(entry({ label: "Méphisto" }), "zzz")).toBeNull();
  });

  test("an empty query matches every entry at score 0", () => {
    expect(scoreCommandEntry(entry({ label: "Méphisto" }), "   ")).toBe(0);
  });
});

describe("groupCommandEntries", () => {
  const entries: CommandPaletteEntry[] = [
    entry({ id: "friend-1", label: "Zoe", group: "friends" }),
    entry({ id: "hero-1", label: "Ana", group: "heroes" }),
    entry({ id: "page-1", label: "Dashboard", group: "pages" }),
    entry({ id: "map-1", label: "Garden of Terror", group: "maps" }),
    entry({ id: "ctx-1", label: "Garden of Terror — Ana", group: "context" }),
  ];

  test("groups follow the fixed display order and omit empty groups", () => {
    const groups = groupCommandEntries(entries, "a");
    expect(groups.map((g) => g.id)).toEqual(["pages", "context", "heroes", "maps"]);
    expect(groups.map((g) => g.label)).toEqual(["Pages", "Sur cette page", "Héros", "Cartes"]);
  });

  test("matches are ranked by score, then rank, then label", () => {
    const ranked = groupCommandEntries(
      [
        entry({ id: "b", label: "Bravo", group: "pages", rank: 1 }),
        entry({ id: "a", label: "Alpha", group: "pages", rank: 1 }),
        entry({ id: "c", label: "Alpha", group: "pages", rank: 0 }),
      ],
      "",
    );
    expect(ranked[0]!.entries.map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  test("a query with no match returns no group", () => {
    expect(groupCommandEntries(entries, "zzzz")).toEqual([]);
  });
});

describe("flattenCommandGroups", () => {
  test("returns every entry in visual order", () => {
    const groups = groupCommandEntries(
      [
        entry({ id: "page-1", label: "Dashboard", group: "pages" }),
        entry({ id: "hero-1", label: "Ana", group: "heroes" }),
      ],
      "",
    );
    expect(flattenCommandGroups(groups).map((e) => e.id)).toEqual(["page-1", "hero-1"]);
  });
});

describe("moveCommandSelection", () => {
  test("starts on the first entry going down and the last going up", () => {
    expect(moveCommandSelection(-1, 1, 3)).toBe(0);
    expect(moveCommandSelection(-1, -1, 3)).toBe(2);
  });

  test("wraps around both ends", () => {
    expect(moveCommandSelection(2, 1, 3)).toBe(0);
    expect(moveCommandSelection(0, -1, 3)).toBe(2);
  });

  test("returns -1 when there is nothing to select", () => {
    expect(moveCommandSelection(0, 1, 0)).toBe(-1);
  });
});

describe("source mappers", () => {
  test("maps navigation entries to the pages group", () => {
    const [page] = pageCommandEntries([
      { to: "/matches", label: "Historique", icon: "i-heroicons-clock" },
    ]);
    expect(page).toMatchObject({
      id: "page-/matches",
      label: "Historique",
      group: "pages",
      to: "/matches",
      icon: "i-heroicons-clock",
    });
  });

  test("maps heroes to /heroes/:heroId with the role as keyword", () => {
    const [hero] = heroCommandEntries([
      { heroId: "anubarak", heroName: "Anub'arak", heroRole: "Tank" } as never,
    ]);
    expect(hero).toMatchObject({
      id: "hero-anubarak",
      label: "Anub'arak",
      group: "heroes",
      to: "/heroes/anubarak",
      keywords: ["Tank"],
    });
  });

  test("maps maps to /maps/:mapId", () => {
    const [map] = mapCommandEntries([{ mapId: "garden", mapName: "Garden of Terror" } as never]);
    expect(map).toMatchObject({ id: "map-garden", group: "maps", to: "/maps/garden" });
  });

  test("friend targets prefer the player page and fall back to the friend page", () => {
    const [withTag, withoutTag] = friendCommandEntries([
      { id: "u1", displayName: "Zoe", battletag: "Zoe#1234" } as never,
      { id: "u2", displayName: "Ann", battletag: null } as never,
    ]);
    expect(withTag!.to).toBe("/players/Zoe%231234");
    expect(withTag!.keywords).toEqual(["Zoe#1234"]);
    expect(withoutTag!.to).toBe("/friends/u2");
  });

  test("maps match rows to the context group, ranked by their list position", () => {
    const entries = matchCommandEntries([
      { id: "m1", mapName: "Garden of Terror", heroName: "Ana", gameMode: "StormLeague" } as never,
      { id: "m2", mapName: "Cursed Hollow", heroName: "Zoe", gameMode: "QuickMatch" } as never,
    ]);
    expect(entries[0]).toMatchObject({
      id: "match-m1",
      label: "Garden of Terror — Ana",
      group: "context",
      to: "/matches/m1",
      rank: 0,
    });
    expect(entries[1]!.rank).toBe(1);
  });
});
