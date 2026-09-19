# F2 — URL-synced filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the session brief mandates: write the plan, then execute it). Steps use checkbox syntax for tracking.

**Goal:** Make the list-view filters (game mode, account scope, hero, map, search, sort, page, game version) round-trip through the query string so a URL reproduces the view, while the existing Pinia stores stay the single source of truth.

**Architecture:** A pure, Nuxt-free engine (apps/web/app/utils/urlFilters.ts) owns parsing/validating/serialising and the URL-wins-over-storage + store-projects-to-URL loop; it is locked by vitest. A thin composable (apps/web/app/composables/useUrlFilterSync.ts) binds that engine to useRoute/useRouter and to the pinia-plugin-persistedstate hydration timing. The three list pages that already own a filter/sort store (/matches, /heroes, /players) each declare their own param spec + defaults and call the composable; no new state system.

**Tech Stack:** Nuxt 4 SSR, Vue 3 script setup, Pinia + pinia-plugin-persistedstate, vue-router 4, vitest (node env, no jsdom).

**Spec:** docs/superpowers/specs/2026-09-18-player-progression-design.md section F2 (lines 745-761).

## Global Constraints

- Source of truth stays the Pinia store; the URL is a projection (spec F2). Never add a second state system.
- On load the URL wins over storage; on change both are written (spec F2).
- Malformed query params are ignored: no crash, no infinite redirect.
- Pages that already read a param (/talents?heroId=) keep working untouched.
- French UI strings, English identifiers and comments (repo rule).
- No new dependency, no API change, no migration. Web-only chantier.
- Pure logic is written test-first (fail -> minimal code -> pass) in *.test.ts next to the code.
- Verification: bun run typecheck and bun run --filter './apps/web' test.

---

## File Structure

- Create apps/web/app/utils/urlFilters.ts — pure engine: param specs, parser, serialiser, query comparison, createUrlFilterSync.
- Create apps/web/app/utils/urlFilters.test.ts — vitest lock for the engine.
- Create apps/web/app/composables/useUrlFilterSync.ts — route/pinia wiring (thin; the engine is what is unit-tested).
- Modify apps/web/app/stores/useMatchesFiltersStore.ts — export MATCHES_SORTABLE_COLUMNS.
- Modify apps/web/app/stores/useHeroesFiltersStore.ts — export HEROES_SORTABLE_COLUMNS.
- Modify apps/web/app/stores/usePlayersFiltersStore.ts — export PLAYERS_SORTABLE_COLUMNS.
- Modify apps/web/app/pages/matches/index.vue, pages/heroes/index.vue, pages/players/index.vue — declare specs/defaults, call the composable.
- Modify apps/web/app/stores/useGameModeStore.ts — update the now-outdated never-synced-to-URL comment.
- Modify tasks/progression-roadmap.md, tasks/README.md — tick F2 and record deviations.

### Documented deviations from the spec

- scope = the multi-account selection (useAccountsStore, ?accounts=), a Pinia store, therefore in scope. The hero-stats visibility scope (useHeroStatsScope, personal/global) is NOT synced: it is persisted server-side on the account, so a URL writing it would turn opening a link into an account mutation.
- /talents?heroId= already reads its own param and is left exactly as-is (AC3).
- Bare /matches, /heroes and /players URLs (all defaults) stay clean: defaults are omitted from the query string.

---

### Task 1: Pure URL-filter engine

**Files:**
- Create: apps/web/app/utils/urlFilters.ts
- Test: apps/web/app/utils/urlFilters.test.ts

**Interfaces:**
- Produces: UrlFilterValue, UrlQuery, UrlFilterKind, UrlFilterSpec, parseUrlFilters(query, specs), buildUrlQuery(values, specs, defaults), isSameUrlFilterQuery(current, desired, specs), mergeUrlFilterQuery(current, desired, specs), urlValuesEqual(spec, a, b), createUrlFilterSync(options).

- [ ] **Step 1: Write the failing test** — apps/web/app/utils/urlFilters.test.ts

~~~ts
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
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: bun run --filter './apps/web' test apps/web/app/utils/urlFilters.test.ts
Expected: FAIL — Cannot find module './urlFilters'.

- [ ] **Step 3: Write minimal implementation** — apps/web/app/utils/urlFilters.ts

~~~ts
import { watch, type WatchStopHandle } from "vue";

/** A value a filter takes once parsed from the query string. */
export type UrlFilterValue = string | number | string[];

/** Query-string shape accepted by the parser (subset of vue-router LocationQuery). */
export type UrlQuery = Record<string, unknown>;

export type UrlFilterKind = "string" | "date" | "int" | "enum" | "csv";

export interface UrlFilterSpec {
  /** Store field name, used as the query-string key. */
  name: string;
  kind: UrlFilterKind;
  /** Allowed values for enum (whole value) and csv (each member). */
  allowed?: readonly string[];
  /** Maximum accepted length for string values. */
  maxLength?: number;
}

const DEFAULT_MAX_LENGTH = 64;
const MAX_CSV_MEMBERS = 100;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readParam(query: UrlQuery, name: string): string | undefined {
  const raw = query[name];
  if (raw === undefined || raw === null) return undefined;
  if (Array.isArray(raw)) {
    const first = raw.find((value) => value !== null && value !== undefined);
    return first === undefined ? undefined : String(first);
  }
  return String(raw);
}

function parseParam(spec: UrlFilterSpec, raw: string): UrlFilterValue | undefined {
  const value = raw.trim();
  switch (spec.kind) {
    case "string":
      if (value.length === 0 || value.length > (spec.maxLength ?? DEFAULT_MAX_LENGTH)) return undefined;
      return value;
    case "date": {
      if (!ISO_DATE.test(value)) return undefined;
      return Number.isNaN(Date.parse(value + "T00:00:00Z")) ? undefined : value;
    }
    case "int": {
      if (!/^\d+$/.test(value)) return undefined;
      const parsed = Number(value);
      return parsed >= 1 ? parsed : undefined;
    }
    case "enum":
      return spec.allowed?.includes(value) ? value : undefined;
    case "csv": {
      const seen = new Set<string>();
      const members: string[] = [];
      for (const part of raw.split(",")) {
        const member = part.trim();
        if (member.length === 0 || seen.has(member)) continue;
        if (spec.allowed && !spec.allowed.includes(member)) continue;
        seen.add(member);
        members.push(member);
        if (members.length >= MAX_CSV_MEMBERS) break;
      }
      return members.length > 0 ? members : undefined;
    }
  }
}

function serializeParam(spec: UrlFilterSpec, value: unknown): string | undefined {
  switch (spec.kind) {
    case "string":
    case "date": {
      if (typeof value !== "string") return undefined;
      const trimmed = value.trim();
      if (trimmed.length === 0) return undefined;
      if (spec.kind === "date" && !ISO_DATE.test(trimmed)) return undefined;
      return trimmed;
    }
    case "int":
      if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return undefined;
      return String(Math.trunc(value));
    case "enum":
      return typeof value === "string" && spec.allowed?.includes(value) ? value : undefined;
    case "csv": {
      if (!Array.isArray(value)) return undefined;
      const members = [
        ...new Set(
          value.filter((member): member is string => typeof member === "string" && member.trim().length > 0),
        ),
      ].sort();
      return members.length > 0 ? members.join(",") : undefined;
    }
  }
}

/** Two values are equal for the URL when they serialise identically. */
export function urlValuesEqual(spec: UrlFilterSpec, a: unknown, b: unknown): boolean {
  return serializeParam(spec, a) === serializeParam(spec, b);
}

/** Validate the URL's filter params; unknown or malformed values are dropped. */
export function parseUrlFilters(query: UrlQuery, specs: readonly UrlFilterSpec[]): Record<string, UrlFilterValue> {
  const values: Record<string, UrlFilterValue> = {};
  for (const spec of specs) {
    const raw = readParam(query, spec.name);
    if (raw === undefined) continue;
    const parsed = parseParam(spec, raw);
    if (parsed !== undefined) values[spec.name] = parsed;
  }
  return values;
}

/** Serialise non-default values into a query object (all values are strings). */
export function buildUrlQuery(
  values: Record<string, unknown>,
  specs: readonly UrlFilterSpec[],
  defaults: Record<string, unknown>,
): Record<string, string> {
  const query: Record<string, string> = {};
  for (const spec of specs) {
    const serialized = serializeParam(spec, values[spec.name]);
    if (serialized === undefined) continue;
    if (serialized === serializeParam(spec, defaults[spec.name])) continue;
    query[spec.name] = serialized;
  }
  return query;
}

/** True when every managed param already matches desired (other params ignored). */
export function isSameUrlFilterQuery(
  current: UrlQuery,
  desired: Record<string, string>,
  specs: readonly UrlFilterSpec[],
): boolean {
  return specs.every((spec) => (readParam(current, spec.name) ?? undefined) === desired[spec.name]);
}

/** Current query with the managed params replaced by desired, unmanaged params preserved. */
export function mergeUrlFilterQuery(
  current: UrlQuery,
  desired: Record<string, string>,
  specs: readonly UrlFilterSpec[],
): Record<string, unknown> {
  const managed = new Set(specs.map((spec) => spec.name));
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current)) {
    if (!managed.has(key)) merged[key] = value;
  }
  return { ...merged, ...desired };
}

export interface UrlFilterSyncOptions {
  specs: readonly UrlFilterSpec[];
  defaults: Record<string, unknown>;
  /** Current filter values keyed by spec name. */
  read: () => Record<string, unknown>;
  /** Apply validated values; only the keys that actually changed are passed. */
  write: (values: Record<string, UrlFilterValue>) => void;
  readQuery: () => UrlQuery;
  writeQuery: (query: Record<string, unknown>) => void;
}

export interface UrlFilterSync {
  /** URL -> stores. Returns every validated value found in the URL. */
  hydrate(): Record<string, UrlFilterValue>;
  /** Apply already-parsed values, writing only the keys that changed. */
  apply(values: Record<string, UrlFilterValue>): void;
  /** Stores -> URL. Returns true when the URL was rewritten. */
  project(): boolean;
  /** Watch the stores and project on every change. */
  start(): void;
  stop(): void;
}

export function createUrlFilterSync(options: UrlFilterSyncOptions): UrlFilterSync {
  let stopHandle: WatchStopHandle | undefined;

  function apply(values: Record<string, UrlFilterValue>) {
    const changed: Record<string, UrlFilterValue> = {};
    const current = options.read();
    for (const [name, value] of Object.entries(values)) {
      const spec = options.specs.find((candidate) => candidate.name === name);
      if (spec && !urlValuesEqual(spec, value, current[name])) changed[name] = value;
    }
    if (Object.keys(changed).length > 0) options.write(changed);
  }

  function hydrate() {
    const parsed = parseUrlFilters(options.readQuery(), options.specs);
    apply(parsed);
    return parsed;
  }

  function project(): boolean {
    const desired = buildUrlQuery(options.read(), options.specs, options.defaults);
    if (isSameUrlFilterQuery(options.readQuery(), desired, options.specs)) return false;
    options.writeQuery(mergeUrlFilterQuery(options.readQuery(), desired, options.specs));
    return true;
  }

  function start() {
    if (stopHandle) return;
    stopHandle = watch(() => options.read(), () => project());
  }

  function stop() {
    stopHandle?.();
    stopHandle = undefined;
  }

  return { hydrate, apply, project, start, stop };
}
~~~

- [ ] **Step 4: Run test to verify it passes**

Run: bun run --filter './apps/web' test apps/web/app/utils/urlFilters.test.ts
Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/web/app/utils/urlFilters.ts apps/web/app/utils/urlFilters.test.ts
git commit -m "feat(web): add the pure URL-filter sync engine"
~~~

---

### Task 2: Route wiring composable

**Files:**
- Create: apps/web/app/composables/useUrlFilterSync.ts

**Interfaces:**
- Consumes: createUrlFilterSync, UrlFilterSpec, UrlFilterValue (Task 1).
- Produces: useUrlFilterSync(options).

- [ ] **Step 1: Write the composable**

~~~ts
import { nextTick, watch } from "vue";
import type { UrlFilterSpec, UrlFilterValue } from "~/utils/urlFilters";
import { createUrlFilterSync } from "~/utils/urlFilters";

export interface UseUrlFilterSyncOptions {
  specs: readonly UrlFilterSpec[];
  defaults: Record<string, unknown>;
  read: () => Record<string, unknown>;
  write: (values: Record<string, UrlFilterValue>) => void;
}

/**
 * Projects a page's existing filter stores into the query string and back.
 * The stores stay the source of truth; the URL is only a projection.
 *
 * URL wins over the persisted stores on load. On the server the values are
 * applied during setup (before the first useApiFetch), so SSR honours the URL.
 * On the client, pinia-plugin-persistedstate restores localStorage at
 * app:suspense:resolve, which would overwrite the URL values, so the URL is
 * re-applied in that hook. A client-side navigation, where the stores are
 * already hydrated, applies it during setup and needs no hook.
 *
 * Pagination is re-applied after nextTick because the pages' existing
 * "filter changed -> page = 1" watchers fire after a re-hydration.
 */
export function useUrlFilterSync(options: UseUrlFilterSyncOptions) {
  const route = useRoute();
  const router = useRouter();
  const sync = createUrlFilterSync({
    specs: options.specs,
    defaults: options.defaults,
    read: options.read,
    write: options.write,
    readQuery: () => route.query,
    writeQuery: (query) => {
      void router.replace({ query });
    },
  });

  // URL -> stores, synchronously: SSR (and the first client render) fetch with
  // the URL's filters, never the server's/persisted defaults.
  sync.hydrate();

  if (import.meta.server) return sync;

  const nuxtApp = useNuxtApp();
  sync.start();

  function rehydrate() {
    const rehydrated = sync.hydrate();
    void nextTick(() => {
      sync.apply(rehydrated);
      sync.project();
    });
  }

  if (nuxtApp.isHydrating) {
    nuxtApp.hook("app:suspense:resolve", rehydrate);
  } else {
    rehydrate();
  }

  // An external query change on the already-mounted page (a pasted URL, a link
  // carrying another query) must still drive the stores. Our own project()
  // replaces are a no-op here because hydrate() only writes actual differences.
  watch(
    () => route.query,
    () => rehydrate(),
    { deep: true },
  );

  return sync;
}
~~~

- [ ] **Step 2: Commit**

~~~bash
git add apps/web/app/composables/useUrlFilterSync.ts
git commit -m "feat(web): wire list-view filters to the query string"
~~~

---

### Task 3: Export sortable-column allowlists from the filter stores

**Files:**
- Modify: apps/web/app/stores/useMatchesFiltersStore.ts
- Modify: apps/web/app/stores/useHeroesFiltersStore.ts
- Modify: apps/web/app/stores/usePlayersFiltersStore.ts

- [ ] **Step 1: Add MATCHES_SORTABLE_COLUMNS**

~~~ts
export const MATCHES_SORTABLE_COLUMNS = [
  "playedAt",
  "durationSeconds",
  "gameMode",
  "mapName",
  "heroName",
  "result",
] as const satisfies readonly MatchesSortableColumn[];
~~~

- [ ] **Step 2: Add HEROES_SORTABLE_COLUMNS and PLAYERS_SORTABLE_COLUMNS**

~~~ts
export const HEROES_SORTABLE_COLUMNS = [
  "heroName",
  "heroRole",
  "gamesPlayed",
  "winrate",
  "avgKillParticipation",
] as const;

export const PLAYERS_SORTABLE_COLUMNS = [
  "battletag",
  "gamesTogether",
  "gamesAsAlly",
  "gamesAsOpponent",
  "wins",
  "losses",
  "winRatioAsAlly",
  "winRatioAsOpponent",
  "ratingAverage",
  "notesCount",
  "behaviorScore",
  "globalWinrate",
  "globalKdRatio",
] as const satisfies readonly PlayersSortableColumn[];
~~~

- [ ] **Step 3: Commit**

~~~bash
git add apps/web/app/stores/useMatchesFiltersStore.ts apps/web/app/stores/useHeroesFiltersStore.ts apps/web/app/stores/usePlayersFiltersStore.ts
git commit -m "feat(web): export the list-view sortable-column allowlists"
~~~

---

### Task 4: Wire the three list pages

**Files:**
- Modify: apps/web/app/pages/matches/index.vue (after const pageSize = 20;)
- Modify: apps/web/app/pages/heroes/index.vue (after usePagination, before watch)
- Modify: apps/web/app/pages/players/index.vue (after usePagination, before watch)
- Modify: apps/web/app/stores/useGameModeStore.ts (comment)

- [ ] **Step 1: /matches** — add imports for GAME_MODE_TAG_KEYS/DEFAULT_GAME_MODE_TAG_KEYS, MATCHES_SORTABLE_COLUMNS, UrlFilterSpec, then:

~~~ts
const accountsStore = useAccountsStore();
const urlFilterSpecs: UrlFilterSpec[] = [
  { name: "heroId", kind: "string" },
  { name: "mapId", kind: "string" },
  { name: "from", kind: "date" },
  { name: "to", kind: "date" },
  { name: "opponent", kind: "string" },
  { name: "sort", kind: "enum", allowed: MATCHES_SORTABLE_COLUMNS },
  { name: "dir", kind: "enum", allowed: ["asc", "desc"] },
  { name: "page", kind: "int" },
  { name: "versions", kind: "csv" },
  { name: "mode", kind: "csv", allowed: GAME_MODE_TAG_KEYS },
  { name: "accounts", kind: "csv" },
];

useUrlFilterSync({
  specs: urlFilterSpecs,
  defaults: {
    heroId: "", mapId: "", from: "", to: "", opponent: "",
    sort: "playedAt", dir: "desc", page: 1,
    versions: [...allGameVersions.value],
    mode: [...DEFAULT_GAME_MODE_TAG_KEYS],
    accounts: [],
  },
  read: () => ({
    heroId: heroId.value, mapId: mapId.value, from: dateFrom.value, to: dateTo.value,
    opponent: opponentBattletag.value, sort: sortKey.value, dir: sortDir.value, page: page.value,
    versions: selectedGameVersions.value,
    mode: gameModeStore.activeTags,
    accounts: accountsStore.selected ?? [],
  }),
  write: (values) => {
    if ("heroId" in values) heroId.value = values.heroId as string;
    if ("mapId" in values) mapId.value = values.mapId as string;
    if ("from" in values) dateFrom.value = values.from as string;
    if ("to" in values) dateTo.value = values.to as string;
    if ("opponent" in values) opponentBattletag.value = values.opponent as string;
    if ("sort" in values) sortKey.value = values.sort as MatchesSortableColumn;
    if ("dir" in values) sortDir.value = values.dir as "asc" | "desc";
    if ("versions" in values) gameVersionFilterStore.setIncluded(allGameVersions.value, values.versions as string[]);
    if ("mode" in values) gameModeStore.setTags(values.mode as GameModeTagKey[]);
    if ("accounts" in values) accountsStore.setSelection(values.accounts as string[]);
    if ("page" in values) page.value = values.page as number;
  },
});
~~~

- [ ] **Step 2: /heroes and /players** — same shape, with params q/sort/dir/page/mode/accounts and their own defaults (gamesPlayed / gamesTogether).

- [ ] **Step 3: Run the whole web suite and typecheck**

~~~bash
bun run --filter './apps/web' test
bun run typecheck
~~~

- [ ] **Step 4: Commit**

~~~bash
git add apps/web/app/pages/matches/index.vue apps/web/app/pages/heroes/index.vue apps/web/app/pages/players/index.vue apps/web/app/stores/useGameModeStore.ts
git commit -m "feat(web): sync matches, heroes and players filters with the URL"
~~~

---

### Task 5: Docs

- [ ] Update tasks/progression-roadmap.md (tick F2, record deviations) and tasks/README.md (one-line Deja fait bullet).
- [ ] Commit: docs(tasks): record the F2 URL-synced filters chantier.

---

## Self-review

- Spec coverage: game mode (mode), scope (accounts), hero (heroId), map (mapId), search (q), sort (sort/dir), page (page) are all round-tripped; game version (versions) too. Malformed-param handling covered by tests. /talents untouched.
- No placeholders; every code step is complete and consistent with the interfaces.
