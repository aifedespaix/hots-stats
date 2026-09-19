import { describe, expect, test } from "vitest";
import { ref } from "vue";
import {
  buildUrlQuery,
  createUrlFilterSync,
  isSameUrlFilterQuery,
  mergeUrlFilterQuery,
  parseUrlFilters,
  type UrlFilterSpec,
} from "./urlFilters";

const specs: UrlFilterSpec[] = [
  { name: "heroId", kind: "string", maxLength: 8 },
  { name: "from", kind: "date" },
  { name: "sort", kind: "enum", allowed: ["playedAt", "result"] },
  { name: "dir", kind: "enum", allowed: ["asc", "desc"] },
  { name: "page", kind: "int" },
  { name: "mode", kind: "csv", allowed: ["ranked", "quickmatch"] },
];

describe("parseUrlFilters", () => {
  test("keeps valid values, trims strings and drops empties", () => {
    expect(parseUrlFilters({ heroId: "  abc  " }, specs)).toEqual({ heroId: "abc" });
    expect(parseUrlFilters({ heroId: "   " }, specs)).toEqual({});
  });

  test("drops strings longer than maxLength and takes the first array entry", () => {
    expect(parseUrlFilters({ heroId: "toolongvalue" }, specs)).toEqual({});
    expect(parseUrlFilters({ heroId: ["abc", "def"] }, specs)).toEqual({ heroId: "abc" });
  });

  test("keeps a real ISO date and drops anything else", () => {
    expect(parseUrlFilters({ from: "2026-09-19" }, specs)).toEqual({ from: "2026-09-19" });
    expect(parseUrlFilters({ from: "19/09/2026" }, specs)).toEqual({});
    expect(parseUrlFilters({ from: "2026-13-99" }, specs)).toEqual({});
  });

  test("keeps ints >= 1 only", () => {
    expect(parseUrlFilters({ page: "3" }, specs)).toEqual({ page: 3 });
    for (const bad of ["0", "-2", "2.5", "abc", ""]) {
      expect(parseUrlFilters({ page: bad }, specs)).toEqual({});
    }
  });

  test("keeps enum members only", () => {
    expect(parseUrlFilters({ sort: "result" }, specs)).toEqual({ sort: "result" });
    expect(parseUrlFilters({ sort: "bogus" }, specs)).toEqual({});
  });

  test("csv: filters unknown members, dedupes and drops empty results", () => {
    expect(parseUrlFilters({ mode: "ranked,bogus,ranked,quickmatch" }, specs)).toEqual({ mode: ["ranked", "quickmatch"] });
    expect(parseUrlFilters({ mode: ",," }, specs)).toEqual({});
  });

  test("ignores unknown params entirely", () => {
    expect(parseUrlFilters({ nope: "1" }, specs)).toEqual({});
  });
});

describe("buildUrlQuery", () => {
  test("omits values equal to the defaults and emits the others", () => {
    const values = { heroId: "", sort: "result", page: 1, mode: ["quickmatch"], dir: "desc" };
    const defaults = { heroId: "", sort: "playedAt", page: 1, mode: ["ranked"], dir: "desc" };
    expect(buildUrlQuery(values, specs, defaults)).toEqual({ sort: "result", mode: "quickmatch" });
  });

  test("serialises csv canonically (sorted, deduped)", () => {
    expect(buildUrlQuery({ mode: ["quickmatch", "ranked", "ranked"] }, specs, {})).toEqual({ mode: "quickmatch,ranked" });
  });
});

describe("isSameUrlFilterQuery / mergeUrlFilterQuery", () => {
  test("compares only the managed keys", () => {
    expect(isSameUrlFilterQuery({ page: "2", other: "x" }, { page: "2" }, specs)).toBe(true);
    expect(isSameUrlFilterQuery({ page: "3" }, { page: "2" }, specs)).toBe(false);
    expect(isSameUrlFilterQuery({}, { page: "2" }, specs)).toBe(false);
  });

  test("merges without dropping unmanaged params", () => {
    expect(mergeUrlFilterQuery({ other: "x", page: "3" }, { page: "2" }, specs)).toEqual({ other: "x", page: "2" });
  });
});

describe("createUrlFilterSync", () => {
  function harness(initial: Record<string, unknown> = {}, query: Record<string, unknown> = {}) {
    const state = ref<Record<string, unknown>>({ ...initial });
    const currentQuery = ref<Record<string, unknown>>({ ...query });
    const writes: Record<string, unknown>[] = [];
    const sync = createUrlFilterSync({
      specs,
      defaults: { heroId: "", from: "", sort: "playedAt", dir: "desc", page: 1, mode: [] },
      read: () => state.value,
      write: (values) => {
        writes.push(values);
        state.value = { ...state.value, ...values };
      },
      readQuery: () => currentQuery.value,
      writeQuery: (next) => {
        currentQuery.value = next;
      },
    });
    return { state, currentQuery, writes, sync };
  }

  test("hydrate writes only the values that differ, ignoring malformed params", () => {
    const h = harness({ page: 1 }, { page: "2", sort: "bogus" });
    expect(h.sync.hydrate()).toEqual({ page: 2 });
    expect(h.writes).toEqual([{ page: 2 }]);
    expect(h.state.value.page).toBe(2);
  });

  test("project writes the URL once, then is a no-op (no redirect loop)", () => {
    const h = harness({ sort: "result", page: 1 }, {});
    expect(h.sync.project()).toBe(true);
    expect(h.currentQuery.value).toEqual({ sort: "result" });
    expect(h.sync.project()).toBe(false);
  });

  test("project removes a malformed managed param from the URL", () => {
    const h = harness({ page: 1 }, { page: "abc", other: "x" });
    expect(h.sync.project()).toBe(true);
    expect(h.currentQuery.value).toEqual({ other: "x" });
  });

  test("start projects on store change", async () => {
    const h = harness({ page: 1 }, {});
    h.sync.start();
    h.state.value = { ...h.state.value, sort: "result" };
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.currentQuery.value).toEqual({ sort: "result" });
    h.sync.stop();
  });
});
