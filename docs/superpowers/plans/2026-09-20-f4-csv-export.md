# F4 — CSV export and sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the session brief mandates: write the plan, then execute it). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-side, scope- and filter-faithful CSV export of the match history (`GET /matches/export.csv`, RFC-4180, capped) and a share/copy action on the filtered matches view.

**Architecture:** The API gains a pure, dependency-free CSV serialiser (`apps/api/src/lib/match-csv.ts`, locked by `bun test`) plus a thin streaming route that reuses the *existing* `buildMatchConditions`/`filtersQuerySchema` pipeline and the *existing* `accountScope` middleware, so the export can never diverge from the on-screen list. The row cap is a shared constant (`MATCH_EXPORT_MAX_ROWS`) so the API enforces exactly the limit the web announces. The web gains a pure export-URL builder (`utils/matchExportLink.ts`) and reuses the same account-scope resolution `useApiFetch` already uses, so the download link carries the exact same `accounts`/filters as the list.

**Tech Stack:** Hono on Bun, Drizzle, Zod, packages/shared-types; Nuxt 3 SSR + Vue 3 script setup + Nuxt UI; bun:test (API/shared-types) and vitest node env (web).

**Spec:** docs/superpowers/specs/2026-09-18-player-progression-design.md section F4 (lines 785-796); depends on F2 (lines 745-761).

## Global Constraints

- `GET /matches/export.csv` uses the **same filter schema** as `GET /matches` and the **same scope** (`accountScope` middleware + `buildMatchConditions`); never a raw `eq(matchPlayers.userId, ...)`.
- CSV output is **RFC-4180 quoted**: comma, double-quote and line-break fields are quoted, inner quotes doubled, records CRLF-terminated.
- The row cap is enforced **server-side** and **reported in a response header** (spec F4 AC2).
- The cap constant lives in `packages/shared-types` so API and web cannot disagree (cross-cutting "constants" rule).
- French UI strings, English identifiers and comments (repo rule). CSV header cells are user-facing French.
- No migration, no new dependency, no secret, no hard-coded URL (the web uses `config.public.apiBase`).
- Pure logic is written test-first (fail -> minimal code -> pass) in `*.test.ts` next to the code.
- Verification: `bun run typecheck`, `bun test packages/shared-types`, `bun test apps/api`, `bun run --filter './apps/web' test`.

### Documented deviations from the spec

- The route is `GET /matches/export.csv` on the existing `matchesRoute`, registered **before** `/:id` so it is never captured as a match id.
- "Streaming" is a chunked `ReadableStream` over a row set already bounded by the cap (cap + 1 rows read once), not a DB cursor: with a documented cap this bounds memory without adding a cursor dependency.
- CSV values stay raw/machine-readable where they are data (`gameMode` enum, ISO date, seconds) while the header row and the result column are French. The on-screen French labels (`formatGameMode`) live in the web app only; moving them to shared-types would be an opportunistic refactor outside F4.
- "Copier le lien" copies the current **web page URL** (F2 makes it reproduce the filtered view), not the CSV download URL. The CSV button is a separate action.

---

## File Structure

- Create `apps/api/src/lib/match-csv.ts` — pure RFC-4180 serialiser + row mapping + cap helper (no DB import, testable without `DATABASE_URL`).
- Create `apps/api/src/lib/match-csv.test.ts` — bun:test lock for the serialiser.
- Modify `packages/shared-types/src/match-filters.ts` — add `MATCH_EXPORT_MAX_ROWS`.
- Modify `apps/api/src/routes/matches.ts` — add `exportQuerySchema` and the `GET /export.csv` streaming route.
- Create `apps/web/app/utils/matchExportLink.ts` — pure absolute-URL builder for the download link.
- Create `apps/web/app/utils/matchExportLink.test.ts` — vitest lock (encoding + empty-value elision).
- Modify `apps/web/app/composables/useApiFetch.ts` — export `accountsScopeParam` (single source of the account-scope resolution).
- Modify `apps/web/app/composables/useApiFetch.test.ts` — lock `accountsScopeParam`.
- Modify `apps/web/app/pages/matches/index.vue` — "Exporter en CSV" + "Copier le lien" actions.
- Modify `tasks/progression-roadmap.md`, `tasks/README.md` — tick F4 and record deviations.

---

### Task 1: API — pure RFC-4180 CSV serialiser

**Files:**
- Create: `apps/api/src/lib/match-csv.ts`
- Test: `apps/api/src/lib/match-csv.test.ts`

**Interfaces:**
- Produces: `MatchExportRow`, `MATCH_EXPORT_COLUMNS`, `MATCH_EXPORT_CHUNK_ROWS`, `escapeCsvField(value: unknown): string`, `toCsvLine(fields: readonly unknown[]): string`, `matchExportFields(row: MatchExportRow): string[]`, `buildMatchCsvHeader(): string`, `matchExportCsvLine(row: MatchExportRow): string`, `buildMatchCsv(rows: readonly MatchExportRow[]): string`, `capExportRows<T>(rows: readonly T[], limit: number): { rows: T[]; truncated: boolean }`.

- [ ] **Step 1: Write the failing test** — `apps/api/src/lib/match-csv.test.ts`

~~~ts
import { describe, expect, test } from "bun:test";
import {
  MATCH_EXPORT_COLUMNS,
  buildMatchCsv,
  buildMatchCsvHeader,
  capExportRows,
  escapeCsvField,
  matchExportCsvLine,
  toCsvLine,
  type MatchExportRow,
} from "./match-csv";

const row: MatchExportRow = {
  playedAt: new Date("2026-09-18T20:15:00.000Z"),
  mapName: "Garden of Terror",
  gameMode: "StormLeague",
  heroName: "Li-Ming",
  durationSeconds: 1234,
  winner: true,
  gameVersion: "2.55.15.96477",
};

describe("escapeCsvField", () => {
  test("passes plain values through", () => {
    expect(escapeCsvField("Li-Ming")).toBe("Li-Ming");
    expect(escapeCsvField(42)).toBe("42");
  });

  test("renders null and undefined as an empty field", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  test("quotes a field containing a comma", () => {
    expect(escapeCsvField("Tomb of the Spider Queen, ranked")).toBe('"Tomb of the Spider Queen, ranked"');
  });

  test("quotes a field containing a double quote and doubles it", () => {
    expect(escapeCsvField('Hero "The" Name')).toBe('"Hero ""The"" Name"');
  });

  test("quotes a field containing a line break", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("line1\r\nline2")).toBe('"line1\r\nline2"');
  });
});

describe("toCsvLine", () => {
  test("joins escaped fields with commas and terminates with CRLF", () => {
    expect(toCsvLine(["A", 'B,"C"', "D"])).toBe('A,"B,""C""",D\r\n');
  });
});

describe("match export rows", () => {
  test("header is the documented French column list", () => {
    expect(MATCH_EXPORT_COLUMNS).toEqual(["Date", "Carte", "Mode", "Héros", "Durée (s)", "Résultat", "Version"]);
    expect(buildMatchCsvHeader()).toBe("Date,Carte,Mode,Héros,Durée (s),Résultat,Version\r\n");
  });

  test("maps a row with a null version and a loss", () => {
    expect(matchExportCsvLine({ ...row, winner: false, gameVersion: null })).toBe(
      "2026-09-18T20:15:00.000Z,Garden of Terror,StormLeague,Li-Ming,1234,Défaite,\r\n",
    );
  });

  test("builds a full file: header then one CRLF record per row", () => {
    expect(buildMatchCsv([row, { ...row, mapName: "Cursed Hollow" }])).toBe(
      buildMatchCsvHeader() +
        "2026-09-18T20:15:00.000Z,Garden of Terror,StormLeague,Li-Ming,1234,Victoire,2.55.15.96477\r\n" +
        "2026-09-18T20:15:00.000Z,Cursed Hollow,StormLeague,Li-Ming,1234,Victoire,2.55.15.96477\r\n",
    );
  });

  test("a map or hero name with a comma or quote does not break the file", () => {
    const csv = buildMatchCsv([
      { ...row, mapName: 'Tomb of the Spider Queen "nuit", ranked', heroName: "E.T.C." },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe(
      '2026-09-18T20:15:00.000Z,"Tomb of the Spider Queen ""nuit"", ranked",StormLeague,E.T.C.,1234,Victoire,2.55.15.96477',
    );
  });
});

describe("capExportRows", () => {
  test("keeps a short list whole and reports no truncation", () => {
    expect(capExportRows([1, 2, 3], 5)).toEqual({ rows: [1, 2, 3], truncated: false });
  });

  test("keeps exactly the limit and reports truncation", () => {
    expect(capExportRows([1, 2, 3], 2)).toEqual({ rows: [1, 2], truncated: true });
  });

  test("a list exactly at the limit is not truncated", () => {
    expect(capExportRows([1, 2], 2)).toEqual({ rows: [1, 2], truncated: false });
  });
});
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/src/lib/match-csv.test.ts`
Expected: FAIL — `Cannot find module './match-csv'`.

- [ ] **Step 3: Write minimal implementation** — `apps/api/src/lib/match-csv.ts`

~~~ts
/**
 * Pure RFC-4180 CSV serialisation for the match export, kept free of any DB
 * import so it is testable without a DATABASE_URL (same "pure half" convention
 * as account-selection.ts). Column layout mirrors the on-screen /matches list;
 * values stay machine-readable (ISO date, raw game-mode enum, duration in
 * seconds) while the header row and the result column are French.
 */

/** One match row as read for the export -- the same columns as GET /matches. */
export interface MatchExportRow {
  playedAt: Date;
  mapName: string;
  gameMode: string;
  heroName: string;
  durationSeconds: number;
  winner: boolean;
  gameVersion: string | null;
}

/** Header cells, left to right. */
export const MATCH_EXPORT_COLUMNS = ["Date", "Carte", "Mode", "Héros", "Durée (s)", "Résultat", "Version"] as const;

/** Rows written per streamed chunk. Bounds one enqueue, not the export. */
export const MATCH_EXPORT_CHUNK_ROWS = 200;

/**
 * RFC-4180 field escaping: a value containing a comma, a double quote or a
 * line break is wrapped in double quotes and its inner quotes are doubled.
 * null/undefined become an empty field.
 */
export function escapeCsvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV record, CRLF-terminated as RFC 4180 requires. */
export function toCsvLine(fields: readonly unknown[]): string {
  return `${fields.map(escapeCsvField).join(",")}\r\n`;
}

/** Maps one match row to its export cells, in MATCH_EXPORT_COLUMNS order. */
export function matchExportFields(row: MatchExportRow): string[] {
  return [
    row.playedAt.toISOString(),
    row.mapName,
    row.gameMode,
    row.heroName,
    String(row.durationSeconds),
    row.winner ? "Victoire" : "Défaite",
    row.gameVersion ?? "",
  ];
}

/** The CSV header row, CRLF-terminated. */
export function buildMatchCsvHeader(): string {
  return toCsvLine(MATCH_EXPORT_COLUMNS);
}

/** One match row, CRLF-terminated. */
export function matchExportCsvLine(row: MatchExportRow): string {
  return toCsvLine(matchExportFields(row));
}

/** The complete CSV file for a bounded row set (header + records). */
export function buildMatchCsv(rows: readonly MatchExportRow[]): string {
  return buildMatchCsvHeader() + rows.map(matchExportCsvLine).join("");
}

/**
 * Applies the server-side row cap. Returns the rows that fit together with a
 * truncation flag, so the route can report both in response headers.
 */
export function capExportRows<T>(rows: readonly T[], limit: number): { rows: T[]; truncated: boolean } {
  if (rows.length <= limit) return { rows: rows.slice(), truncated: false };
  return { rows: rows.slice(0, limit), truncated: true };
}
~~~

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/src/lib/match-csv.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

~~~bash
git add apps/api/src/lib/match-csv.ts apps/api/src/lib/match-csv.test.ts
git commit -m "feat(api): add RFC-4180 match CSV serialiser"
~~~

---

### Task 2: API — shared cap constant and `GET /matches/export.csv`

**Files:**
- Modify: `packages/shared-types/src/match-filters.ts`
- Modify: `apps/api/src/routes/matches.ts` (route chain, after `/dashboard`)
- Test: `bun test packages/shared-types` (constant export) + `bun test apps/api`

**Interfaces:**
- Consumes: `buildMatchConditions`, `listQuerySchema`, `MATCH_EXPORT_CHUNK_ROWS`, `buildMatchCsvHeader`, `matchExportCsvLine`, `capExportRows` (Task 1).
- Produces: `exportQuerySchema`, the `GET /export.csv` route, and `MATCH_EXPORT_MAX_ROWS`.

- [ ] **Step 1: Add the shared cap constant** — `packages/shared-types/src/match-filters.ts`

Append at the end of the file:

~~~ts
/**
 * Server-side row cap for GET /matches/export.csv. Lives here so the API
 * enforces exactly the limit the web announces, and cannot drift (cross-cutting
 * "constants" rule). Exceeding it yields the first MATCH_EXPORT_MAX_ROWS rows
 * in the requested order, plus an X-Export-Truncated: true header.
 */
export const MATCH_EXPORT_MAX_ROWS = 5000;
~~~

- [ ] **Step 2: Add the export schema and route** — `apps/api/src/routes/matches.ts`

Add `MATCH_EXPORT_MAX_ROWS` to the existing `@hots-stats/shared-types` import, and add to the lib imports:

~~~ts
import { buildMatchCsvHeader, capExportRows, matchExportCsvLine } from "../lib/match-csv";
~~~

After `listQuerySchema`, add:

~~~ts
/**
 * GET /matches/export.csv accepts the exact list filters (mode/hero/map/
 * period/crossed player/version) plus the sort, and nothing else: pagination
 * does not apply to an export, which always starts at the first filtered row.
 */
const exportQuerySchema = listQuerySchema.omit({ page: true, pageSize: true });
~~~

In the chain, insert this route **after** `/dashboard` and **before** `.get("/:id", ...)`:

~~~ts
  // CSV export of the same filtered list the page shows (F4). Reuses
  // buildMatchConditions so scope and filters are identical to GET /matches,
  // reads at most MATCH_EXPORT_MAX_ROWS + 1 rows (the +1 only detects
  // truncation), then streams the file in bounded chunks. The cap and the
  // truncation flag are reported in response headers (spec F4 AC2).
  .get("/export.csv", async (c) => {
    const user = c.get("user");
    const parsed = exportQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const { sortBy, sortDir, ...filters } = parsed.data;
    const where = buildMatchConditions(c.get("scope"), filters);

    const rows = await db
      .select({
        playedAt: matches.playedAt,
        mapName: maps.name,
        gameMode: matches.gameMode,
        heroName: heroes.name,
        durationSeconds: matches.durationSeconds,
        winner: matchPlayers.winner,
        gameVersion: matches.gameVersion,
      })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .innerJoin(maps, eq(maps.id, matches.mapId))
      .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
      .where(where)
      .orderBy((sortDir === "asc" ? asc : desc)(SORTABLE_COLUMNS[sortBy]))
      .limit(MATCH_EXPORT_MAX_ROWS + 1);

    const { rows: capped, truncated } = capExportRows(rows, MATCH_EXPORT_MAX_ROWS);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(buildMatchCsvHeader()));
        for (let i = 0; i < capped.length; i += MATCH_EXPORT_CHUNK_ROWS) {
          const chunk = capped
            .slice(i, i + MATCH_EXPORT_CHUNK_ROWS)
            .map(matchExportCsvLine)
            .join("");
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    return c.body(body, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="hots-matches.csv"',
      "X-Export-Row-Limit": String(MATCH_EXPORT_MAX_ROWS),
      "X-Export-Row-Count": String(capped.length),
      "X-Export-Truncated": truncated ? "true" : "false",
    });
  })
~~~

Note: import `MATCH_EXPORT_CHUNK_ROWS` alongside the other `match-csv` imports.

- [ ] **Step 3: Run tests and typecheck**

Run: `bun test apps/api` — Expected: PASS (existing suites + Task 1).
Run: `bun test packages/shared-types` — Expected: PASS.
Run: `bun run typecheck` — Expected: no errors.

- [ ] **Step 4: Commit**

~~~bash
git add packages/shared-types/src/match-filters.ts apps/api/src/routes/matches.ts
git commit -m "feat(api): add GET /matches/export.csv with server-side cap"
~~~

---

### Task 3: Web — pure export-URL builder

**Files:**
- Create: `apps/web/app/utils/matchExportLink.ts`
- Test: `apps/web/app/utils/matchExportLink.test.ts`

**Interfaces:**
- Produces: `buildExportUrl(apiBase: string, path: string, query: Record<string, unknown>): string`.

- [ ] **Step 1: Write the failing test** — `apps/web/app/utils/matchExportLink.test.ts`

~~~ts
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
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter './apps/web' test matchExportLink`
Expected: FAIL — cannot resolve `./matchExportLink`.

- [ ] **Step 3: Write minimal implementation** — `apps/web/app/utils/matchExportLink.ts`

~~~ts
/**
 * Builds an absolute download URL for GET /matches/export.csv from the same
 * query the page sends to GET /matches, so the exported file respects the
 * exact scope and filters of the on-screen list (spec F4 AC3). Empty, null and
 * undefined values are omitted, matching the page's own "absent filter" logic;
 * values are encoded exactly once by URLSearchParams (see useAccountsStore's
 * comment on the double-encoding trap).
 */
export function buildExportUrl(apiBase: string, path: string, query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  const base = apiBase.replace(/\/+$/, "");
  return `${base}${path}${search ? `?${search}` : ""}`;
}
~~~

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter './apps/web' test matchExportLink`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

~~~bash
git add apps/web/app/utils/matchExportLink.ts apps/web/app/utils/matchExportLink.test.ts
git commit -m "feat(web): add pure match export URL builder"
~~~

---

### Task 4: Web — single-source account-scope param

**Files:**
- Modify: `apps/web/app/composables/useApiFetch.ts`
- Modify: `apps/web/app/composables/useApiFetch.test.ts`

**Interfaces:**
- Produces: `accountsScopeParam(accountsStore, authUser)` returning `string | undefined`.
- Consumed by: `useApiFetch` (internally) and `pages/matches/index.vue` (Task 5).

- [ ] **Step 1: Write the failing test** — append to `apps/web/app/composables/useApiFetch.test.ts`

~~~ts
import { accountsScopeParam } from "./useApiFetch";

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
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter './apps/web' test useApiFetch`
Expected: FAIL — `accountsScopeParam` is not exported.

- [ ] **Step 3: Write minimal implementation** — `apps/web/app/composables/useApiFetch.ts`

Add above `useApiFetch` (and use it inside):

~~~ts
/** Minimal shape of the accounts store this helper needs (structural, so it
 * stays decoupled from the Pinia store's module in tests). */
export interface AccountsScopeStore {
  accountsQueryParam(available: string[], primary: string | null): string | undefined;
}

/** Minimal shape of the authenticated user this helper needs. */
export interface AccountsScopeUser {
  accounts: { battletag: string }[];
  primaryBattletag: string | null;
  battletag: string | null;
}

/**
 * Resolves the accounts query value for the active account selection. This is
 * the single source both useApiFetch (on-screen requests) and the CSV export
 * link use, so an export can never be scoped differently from the list it
 * mirrors.
 */
export function accountsScopeParam(
  accountsStore: AccountsScopeStore,
  authUser: AccountsScopeUser | null | undefined,
): string | undefined {
  return accountsStore.accountsQueryParam(
    (authUser?.accounts ?? []).map((account) => account.battletag),
    authUser?.primaryBattletag ?? authUser?.battletag ?? null,
  );
}
~~~

Then replace the inline accounts expression inside `useApiFetch`:

~~~ts
      accounts: accountsStore ? accountsScopeParam(accountsStore, authData.value?.user) : undefined,
~~~

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter './apps/web' test useApiFetch`
Expected: PASS (existing `buildApiQuery` tests + 3 new).

- [ ] **Step 5: Commit**

~~~bash
git add apps/web/app/composables/useApiFetch.ts apps/web/app/composables/useApiFetch.test.ts
git commit -m "refactor(web): single-source account scope param"
~~~

---

### Task 5: Web — export and copy-link actions on `/matches`

**Files:**
- Modify: `apps/web/app/pages/matches/index.vue`

**Interfaces:**
- Consumes: `buildExportUrl` (Task 3), `accountsScopeParam` (Task 4), `MATCH_EXPORT_MAX_ROWS` (Task 2).

- [ ] **Step 1: Add the script wiring**

Add `MATCH_EXPORT_MAX_ROWS` to the existing `@hots-stats/shared-types` import. After `const accountsStore = useAccountsStore();`:

~~~ts
const { data: authData } = useAuthUser();
const accountsParam = computed(() => accountsScopeParam(accountsStore, authData.value?.user));

// Same filters + sort as the on-screen list, plus the account scope the list
// request carries through useApiFetch -- the export and the page can't diverge
// (spec F4 AC3).
const exportUrl = computed(() =>
  buildExportUrl(config.public.apiBase, "/matches/export.csv", {
    ...activeFilters.value,
    sortBy: apiSortBy.value,
    sortDir: sortDir.value,
    ...(accountsParam.value ? { accounts: accountsParam.value } : {}),
  }),
);

// "Copier le lien" shares the current filtered view: F2 makes the URL
// reproduce it, so the page URL is the link.
const { copy, copied, isSupported: clipboardSupported } = useClipboard({ legacy: true });

function copyShareLink() {
  void copy(window.location.href);
}
~~~

- [ ] **Step 2: Add the buttons to the template**

Replace the standalone `<UiFilterResetActions ... />` block with:

~~~vue
    <div class="flex flex-wrap items-center justify-between gap-2">
      <UiFilterResetActions
        :filters-default="filtersStore.isFiltersDefault && gameVersionFilterStore.isDefault"
        :sort-default="filtersStore.isSortDefault"
        @reset-filters="
          filtersStore.resetFilters();
          gameVersionFilterStore.includeAll();
        "
        @reset-sort="filtersStore.resetSort()"
      />
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          :to="exportUrl"
          external
          size="xs"
          color="neutral"
          variant="soft"
          icon="i-heroicons-arrow-down-tray"
          :title="`Limité aux ${MATCH_EXPORT_MAX_ROWS} premières parties`"
        >
          Exporter en CSV
        </UButton>
        <UButton
          size="xs"
          color="neutral"
          variant="soft"
          :icon="copied ? 'i-heroicons-check' : 'i-heroicons-link'"
          :disabled="!clipboardSupported"
          :title="clipboardSupported ? 'Copier le lien de cette vue' : 'Copie non supportée par ce navigateur'"
          @click="copyShareLink"
        >
          {{ copied ? "Lien copié" : "Copier le lien" }}
        </UButton>
      </div>
    </div>
~~~

- [ ] **Step 3: Typecheck and test**

Run: `bun run typecheck` — Expected: no errors.
Run: `bun run --filter './apps/web' test` — Expected: PASS.

- [ ] **Step 4: Commit**

~~~bash
git add apps/web/app/pages/matches/index.vue
git commit -m "feat(web): export matches CSV and copy filtered link"
~~~

---

### Task 6: Docs and final verification

**Files:**
- Modify: `tasks/progression-roadmap.md`
- Modify: `tasks/README.md`

- [ ] **Step 1: Tick F4 in the roadmap and record deviations.**

- [ ] **Step 2: Add a one-line entry to `tasks/README.md` "Déjà fait".**

- [ ] **Step 3: Full verification gate**

~~~bash
bun run typecheck
bun test packages/shared-types
bun test apps/api
bun run --filter './apps/web' test
~~~

All must pass.

- [ ] **Step 4: Commit and push if green**

~~~bash
git add tasks/progression-roadmap.md tasks/README.md
git commit -m "docs(tasks): record the F4 CSV export chantier"
git status --short
git push origin main
~~~

Push only if every command above is green; otherwise stop at the local commit and report the blocker.

---

## Self-Review

**1. Spec coverage**
- `GET /matches/export.csv` streaming the filtered list, same filter schema, documented cap -> Tasks 1, 2. ✔
- "Copier le lien" on a filtered view (depends on F2) -> Task 5 (`copyShareLink`, F2 already makes the URL authoritative). ✔
- AC1 RFC-4180 quoting (comma/quote-safe) -> Task 1 tests. ✔
- AC2 cap server-side + response header -> Task 2 (`X-Export-Row-Limit` / `X-Export-Row-Count` / `X-Export-Truncated`; `capExportRows` + `limit(cap+1)`). ✔
- AC3 same scope and filters as the list -> Task 2 reuses `buildMatchConditions` + `accountScope`; Task 5 builds the link from the same `activeFilters` + `accountsScopeParam`. ✔

**2. Placeholder scan** — no TBD/TODO/"handle edge cases"; every code step carries real code.

**3. Type consistency** — `MatchExportRow` fields match the DB select in Task 2; `capExportRows` returns `{ rows, truncated }` consumed by the same names in Task 2; `buildExportUrl`/`accountsScopeParam` signatures in Tasks 3-4 match Task 5's usage; `MATCH_EXPORT_MAX_ROWS` added in Task 2 is imported by Task 5.
