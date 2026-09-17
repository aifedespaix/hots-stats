import { beforeEach, describe, expect, test } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAccountsStore } from "./useAccountsStore";

const available = ["aife#21170", "JeanPichet#2126"];

beforeEach(() => setActivePinia(createPinia()));

describe("useAccountsStore", () => {
  test("defaults to the primary account only", () => {
    const store = useAccountsStore();
    expect(store.effectiveAccounts(available, "aife#21170")).toEqual(["aife#21170"]);
  });

  test("falls back to the first account when no primary is known", () => {
    const store = useAccountsStore();
    expect(store.effectiveAccounts(available, null)).toEqual(["aife#21170"]);
  });

  test("toggling a second account merges it", () => {
    const store = useAccountsStore();
    store.toggle("JeanPichet#2126", available, "aife#21170");
    expect(store.effectiveAccounts(available, "aife#21170")).toEqual(["aife#21170", "JeanPichet#2126"]);
  });

  test("toggling the only selected account off is a no-op", () => {
    const store = useAccountsStore();
    store.toggle("aife#21170", available, "aife#21170");
    expect(store.effectiveAccounts(available, "aife#21170")).toEqual(["aife#21170"]);
  });

  test("a saved tag that is no longer linked falls back to the primary", () => {
    const store = useAccountsStore();
    store.selectOnly("JeanPichet#2126");
    expect(store.effectiveAccounts(["aife#21170"], "aife#21170")).toEqual(["aife#21170"]);
  });

  test("query param is comma-joined and URL-safe", () => {
    const store = useAccountsStore();
    store.setSelection(available);
    expect(store.accountsQueryParam(available, "aife#21170")).toBe(
      encodeURIComponent("aife#21170") + "," + encodeURIComponent("JeanPichet#2126"),
    );
  });

  test("query param is undefined when nothing is linked", () => {
    const store = useAccountsStore();
    expect(store.accountsQueryParam([], null)).toBeUndefined();
  });

  test("reset returns to the primary default", () => {
    const store = useAccountsStore();
    store.setSelection(available);
    store.reset();
    expect(store.effectiveAccounts(available, "aife#21170")).toEqual(["aife#21170"]);
  });
});
