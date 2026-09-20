import { describe, expect, test } from "vitest";
import { buildExportUrl } from "./matchExportLink";

describe("buildExportUrl", () => {
  test("joins the API base, path and query", () => {
    expect(buildExportUrl("http://localhost:3001", "/matches/export.csv", { heroId: "abc" })).toBe(
      "http://localhost:3001/matches/export.csv?heroId=abc",
    );
  });

  test("drops empty, null and undefined values", () => {
    expect(
      buildExportUrl("http://localhost:3001", "/matches/export.csv", {
        heroId: "",
        mapId: null,
        dateFrom: undefined,
        mode: "StormLeague",
      }),
    ).toBe("http://localhost:3001/matches/export.csv?mode=StormLeague");
  });

  test("omits the query string entirely when nothing is set", () => {
    expect(buildExportUrl("http://localhost:3001", "/matches/export.csv", { heroId: "" })).toBe(
      "http://localhost:3001/matches/export.csv",
    );
  });

  test("percent-encodes a BattleTag hash exactly once", () => {
    expect(
      buildExportUrl("http://localhost:3001", "/matches/export.csv", { accounts: "aife#21170,Jean#2126" }),
    ).toBe("http://localhost:3001/matches/export.csv?accounts=aife%2321170%2CJean%232126");
  });

  test("tolerates a trailing slash on the configured API base", () => {
    expect(buildExportUrl("http://localhost:3001/", "/matches/export.csv", {})).toBe(
      "http://localhost:3001/matches/export.csv",
    );
  });
});
