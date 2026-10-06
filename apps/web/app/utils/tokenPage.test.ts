import { describe, expect, it } from "vitest";
import { otherTokenIds } from "./tokenPage";

describe("otherTokenIds", () => {
  const tokens = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("returns every token except the one to keep", () => {
    expect(otherTokenIds(tokens, "b")).toEqual(["a", "c"]);
  });

  it("returns everything when nothing is kept", () => {
    expect(otherTokenIds(tokens, null)).toEqual(["a", "b", "c"]);
  });

  it("returns nothing for an empty list", () => {
    expect(otherTokenIds([], "x")).toEqual([]);
  });
});
