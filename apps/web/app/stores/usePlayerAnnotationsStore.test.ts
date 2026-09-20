import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { SharedPlayerAnnotation } from "@hots-stats/shared-types";
import { ANNOTATIONS_BATCH_SIZE, usePlayerAnnotationsStore } from "./usePlayerAnnotationsStore";

/**
 * Regression tests for the "Note"/"Commentaires" columns sometimes staying
 * blank in the players list. Both columns read the shared annotation cache, so
 * anything that stops a battletag from being fetched blanks them together.
 */

function annotation(battletag: string): SharedPlayerAnnotation {
  return {
    battletag,
    fdpCount: 0,
    pgmCount: 0,
    ratingCount: 1,
    ratingAverage: 4,
    mine: { isFdp: false, isPgm: false, rating: 4, note: "" },
    entries: [
      {
        authorId: "u1",
        authorName: "Moi",
        isMine: true,
        isFdp: false,
        isPgm: false,
        rating: 4,
        note: "bon joueur",
      },
    ],
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("useRuntimeConfig", () => ({ public: { apiBase: "http://api.test" } }));
  fetchMock = vi.fn(async (_url: string, opts: { query: { battletags: string } }) => {
    const battletags = opts.query.battletags.split(",");
    return { annotations: Object.fromEntries(battletags.map((tag) => [tag, annotation(tag)])) };
  });
  vi.stubGlobal("$fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function requestedBattletags(call: readonly unknown[] | undefined): string[] {
  return (call?.[1] as { query: { battletags: string } }).query.battletags.split(",");
}

describe("usePlayerAnnotationsStore SSR payload", () => {
  test("a battletag still in flight when SSR captures the payload never reaches the client as pending", async () => {
    let resolveFetch: (value: { annotations: Record<string, SharedPlayerAnnotation> }) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveFetch = resolve; }));

    const store = usePlayerAnnotationsStore();
    // The players page calls this from an immediate watcher without awaiting it,
    // so the request is almost always still in flight when Nuxt renders.
    const inFlight = store.fetchMany(["A#1"]);

    // @pinia/nuxt's app:rendered hook serializes ALL of pinia.state.value into the
    // SSR payload (node_modules/@pinia/nuxt/dist/runtime/plugin.js) and the client
    // restores it verbatim. Whatever lives in $state here is therefore what the
    // hydrated client believes. If an in-flight battletag is in there, the client's
    // fetchMany skips it (never refetched) and "Note"/"Commentaires" stay blank --
    // intermittently, depending on whether SSR beat the request.
    expect(Object.keys(store.$state)).toEqual(["byBattletag"]);

    resolveFetch({ annotations: { "A#1": annotation("A#1") } });
    await inFlight;
  });

  test("refetches a battletag that was in flight during a previous SSR render", async () => {
    const store = usePlayerAnnotationsStore();
    await store.fetchMany(["A#1"]);

    // A fresh app (client after hydration) starts from empty state: the tag must
    // be fetched, not assumed in flight.
    setActivePinia(createPinia());
    const hydrated = usePlayerAnnotationsStore();
    await hydrated.fetchMany(["A#1"]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hydrated.annotationFor("A#1")?.entries).toHaveLength(1);
  });
});

describe("usePlayerAnnotationsStore fetching", () => {
  test("concurrent callers only start one request per battletag", async () => {
    const store = usePlayerAnnotationsStore();
    await Promise.all([store.fetchMany(["A#1", "B#2"]), store.fetchMany(["B#2", "C#3"])]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedBattletags(fetchMock.mock.calls[0])).toEqual(["A#1", "B#2"]);
    expect(requestedBattletags(fetchMock.mock.calls[1])).toEqual(["C#3"]);
  });

  test("splits a long player list into requests that each stay under the URL limit", async () => {
    const store = usePlayerAnnotationsStore();
    const tags = Array.from({ length: ANNOTATIONS_BATCH_SIZE * 2 + 1 }, (_, i) => `Player${i}#1234`);

    await store.fetchMany(tags);

    // One request per batch instead of one giant URL: the API (Bun) answers 431
    // for a request line over ~16 KiB, which zeroed every rating/note in the list.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expect(requestedBattletags(call).length).toBeLessThanOrEqual(ANNOTATIONS_BATCH_SIZE);
    }
    expect(tags.every((tag) => store.annotationFor(tag) !== null)).toBe(true);
  });

  test("already-cached battletags are not refetched", async () => {
    const store = usePlayerAnnotationsStore();
    await store.fetchMany(["A#1"]);
    await store.fetchMany(["A#1"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("refreshOne bypasses the cache so a saved note replaces the stale one", async () => {
    const store = usePlayerAnnotationsStore();
    await store.fetchMany(["A#1"]);

    const updated = annotation("A#1");
    updated.ratingAverage = 5;
    fetchMock.mockResolvedValueOnce({ annotations: { "A#1": updated } });

    await store.refreshOne("A#1");

    expect(store.annotationFor("A#1")?.ratingAverage).toBe(5);
  });
});
