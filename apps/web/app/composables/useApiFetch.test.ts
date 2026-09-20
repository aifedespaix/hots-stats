import { describe, expect, test } from "vitest";
import { accountsScopeParam, buildApiQuery } from "./useApiFetch";

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

describe("accountsScopeParam", () => {
  test("maps the auth accounts and primary BattleTag to the store's query param", () => {
    const seen: { available: string[]; primary: string | null }[] = [];
    const store = {
      accountsQueryParam(available: string[], primary: string | null) {
        seen.push({ available, primary });
        return "A#1,B#2";
      },
    };
    expect(
      accountsScopeParam(store, {
        accounts: [{ battletag: "A#1" }, { battletag: "B#2" }],
        primaryBattletag: "A#1",
        battletag: "A#1",
      }),
    ).toBe("A#1,B#2");
    expect(seen).toEqual([{ available: ["A#1", "B#2"], primary: "A#1" }]);
  });

  test("falls back to the mirrored battletag when no primary is set", () => {
    const seen: (string | null)[] = [];
    const store = {
      accountsQueryParam(_available: string[], primary: string | null) {
        seen.push(primary);
        return undefined;
      },
    };
    accountsScopeParam(store, { accounts: [], primaryBattletag: null, battletag: "C#3" });
    expect(seen).toEqual(["C#3"]);
  });

  test("returns undefined without an authenticated user", () => {
    const store = { accountsQueryParam: () => "never" };
    expect(accountsScopeParam(store, null)).toBeUndefined();
    expect(accountsScopeParam(store, undefined)).toBeUndefined();
  });
});
