import { describe, expect, test } from "vitest";
import { buildApiQuery } from "./useApiFetch";

describe("buildApiQuery", () => {
  test("omits accounts when undefined, keeps mode", () => {
    expect(buildApiQuery({ base: { page: 1 }, mode: "QuickMatch", accounts: undefined })).toEqual({
      mode: "QuickMatch",
      page: 1,
    });
  });

  test("includes both global filters when present", () => {
    expect(buildApiQuery({ base: {}, mode: "QuickMatch", accounts: "A%231" })).toEqual({
      accounts: "A%231",
      mode: "QuickMatch",
    });
  });

  test("omits mode when undefined", () => {
    expect(buildApiQuery({ base: {}, accounts: "A%231" })).toEqual({ accounts: "A%231" });
  });

  test("a caller's own query still wins over the injected filters", () => {
    expect(
      buildApiQuery({ base: { accounts: "explicit", mode: "ARAM" }, mode: "QuickMatch", accounts: "A%231" }),
    ).toEqual({ accounts: "explicit", mode: "ARAM" });
  });

  test("returns an empty object when nothing is set", () => {
    expect(buildApiQuery({ base: {} })).toEqual({});
  });
});
