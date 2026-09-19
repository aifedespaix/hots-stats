import { describe, expect, test } from "bun:test";
import { normalizeNameKey, resolveHeroId, resolveMapId } from "./draft-resolution";

const MAPS = [
  { id: "garden-of-terror", name: "Garden of Terror" },
  { id: "braxis-holdout", name: "Braxis Holdout" },
  { id: "braxis-outpost", name: "Braxis Outpost" },
];

const HEROES = [
  { id: "etc", name: "E.T.C." },
  { id: "lt-morales", name: "Lt. Morales" },
  { id: "mephisto", name: "Mephisto" },
  { id: "brightwing", name: "Brightwing" },
];

describe("normalizeNameKey", () => {
  test("ignores case, accents and punctuation", () => {
    expect(normalizeNameKey("E.T.C.")).toBe("etc");
    expect(normalizeNameKey("Lt. Morales")).toBe("ltmorales");
    expect(normalizeNameKey("MÉPHISTO")).toBe("mephisto");
  });
});

describe("resolveMapId", () => {
  test("matches a canonical name ignoring case and accents", () => {
    expect(resolveMapId("garden of terror", MAPS)).toBe("garden-of-terror");
  });

  test("matches when the game appends a suffix to the map name", () => {
    expect(resolveMapId("GARDEN OF TERROR CLASSIC", MAPS)).toBe("garden-of-terror");
  });

  test("returns null for an unknown map", () => {
    expect(resolveMapId("NOT A REAL MAP", MAPS)).toBeNull();
  });

  test("returns null when more than one canonical name is a prefix", () => {
    const ambiguous = [
      { id: "a", name: "Braxis" },
      { id: "b", name: "Braxis Hold" },
    ];
    expect(resolveMapId("BRAXIS HOLD OUT", ambiguous)).toBeNull();
  });

  test("returns null for an empty or missing name", () => {
    expect(resolveMapId(null, MAPS)).toBeNull();
    expect(resolveMapId("   ", MAPS)).toBeNull();
  });
});

describe("resolveHeroId", () => {
  test("matches the client's spelling to the canonical hero", () => {
    expect(resolveHeroId("LTMORALES", HEROES)).toBe("lt-morales");
    expect(resolveHeroId("MÉPHISTO", HEROES)).toBe("mephisto");
    expect(resolveHeroId("E.T.C.", HEROES)).toBe("etc");
  });

  test("does not guess at a localized name it has no alias for", () => {
    expect(resolveHeroId("LUISAILE", HEROES)).toBeNull();
  });

  test("returns null for an empty or missing name", () => {
    expect(resolveHeroId(null, HEROES)).toBeNull();
    expect(resolveHeroId("", HEROES)).toBeNull();
  });
});
