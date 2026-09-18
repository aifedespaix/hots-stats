# B2 — Dashboard cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up the Dashboard (remove the duration tile, the redundant point-fort/point-faible teasers and the desktop nav-card grid; add a rolling-winrate sparkline, a "Ton chantier n°1" card and a "Dernière session" summary) without adding a round-trip to the existing `/stats/summary` + `/matches?pageSize=8` load.

**Architecture:** Two pure web helpers (sparkline geometry, last-session summary) get unit tests beside them. The 90-minute session-clustering rule currently living in the API is extracted to `@hots-stats/shared-types` so the Dashboard card and the C4 breakdown share one implementation (repo rule: *une règle = un seul endroit*). `StatsAccountSummaryStats` keeps its 4-column grid and exposes a slot for the 4th tile, which the Dashboard fills with the sparkline tile (no layout shift). The Dashboard passes the single `/stats/trend` response to both the sparkline and the session card.

**Tech Stack:** Nuxt 4 / Vue 3 + Nuxt UI, TypeScript, vitest (web), bun:test (shared-types, API), Drizzle/Postgres (untouched).

**Spec:** `docs/superpowers/specs/2026-09-18-player-progression-design.md` § B2 (lines 474-499), § E1 for the future `/stats/session`.

## Global Constraints

- UI copy is French; identifiers and comments are English (repo rule).
- No new dependency, no hard-coded URL/secret, no migration.
- Every personal stats request goes through `useApiFetch` (which bakes the account selection) and passes `scope: "personal"` explicitly, so the Dashboard can never inherit the global `heroStatsScope` preference.
- No invented number: below `PROGRESSION_MIN_MATCHES` (20) the UI shows the count, never a verdict.
- One calculation rule = one place: session clustering lives in `packages/shared-types/src/sessions.ts`.
- Empty and error states use `UiStateCard` (or a stable-height skeleton).
- Verification commands: `bun run typecheck`, `bun test packages/shared-types`, `bun test apps/api`, `bun run --filter './apps/web' test`.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/shared-types/src/sessions.ts` (create) | Shared 90-minute session clustering: `clusterSessions`, `sessionizeMatches`, `SessionPlacement`. |
| `packages/shared-types/src/sessions.test.ts` (create) | bun:test coverage for both functions. |
| `packages/shared-types/src/index.ts` (modify) | Export `./sessions`. |
| `apps/api/src/lib/context-aggregate.ts` (modify) | Import the shared clustering instead of defining it. |
| `apps/api/src/lib/context-aggregate.test.ts` (modify) | Drop the moved `sessionizeMatches` block (now in shared-types). |
| `app/web/app/utils/sessionSummary.ts` (create) | `summarizeLastSession` (last cluster -> games/record/insight). |
| `app/web/app/utils/sessionSummary.test.ts` (create) | vitest coverage. |
| `app/web/app/utils/sparkline.ts` (create) | `buildWinrateSparkline` SVG geometry. |
| `app/web/app/utils/sparkline.test.ts` (create) | vitest coverage. |
| `app/web/app/components/progress/SparklineTile.vue` (create) | 4th summary tile: rolling winrate + sparkline. |
| `app/web/app/components/progress/SessionSummaryCard.vue` (create) | "Dernière session" panel. |
| `app/web/app/components/stats/AccountSummaryStats.vue` (modify) | Drop the duration tile, add the 4th-tile slot. |
| `app/web/app/pages/index.vue` (modify) | Remove the redundant blocks, fetch trend/drivers once, mount the new cards. |
| `tasks/progression-roadmap.md` (modify) | Tick B2 + variances. |
| `tasks/README.md` (modify) | One-line "Déjà fait" entry. |

---

### Task 1: Shared session clustering

**Files:**
- Create: `packages/shared-types/src/sessions.ts`
- Create: `packages/shared-types/src/sessions.test.ts`
- Modify: `packages/shared-types/src/index.ts`
- Modify: `apps/api/src/lib/context-aggregate.ts`
- Modify: `apps/api/src/lib/context-aggregate.test.ts`

**Interfaces:**
- Produces: `SessionizableMatch { matchId: string; playedAt: string }`, `SessionPlacement { position: number; size: number }`, `clusterSessions<T extends SessionizableMatch>(matches: T[], gapMinutes?: number): T[][]`, `sessionizeMatches(matches: SessionizableMatch[], gapMinutes?: number): Map<string, SessionPlacement>`.

- [ ] **Step 1: Write the failing test** — `packages/shared-types/src/sessions.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { CONTEXT_SESSION_GAP_MINUTES } from "./stats";
import { clusterSessions, sessionizeMatches, type SessionizableMatch } from "./sessions";

function m(matchId: string, playedAt: string): SessionizableMatch {
  return { matchId, playedAt };
}

describe("clusterSessions", () => {
  test("splits on a gap strictly greater than the shared threshold", () => {
    const sessions = clusterSessions([
      m("a", "2026-01-01T20:00:00.000Z"),
      m("b", "2026-01-01T21:29:00.000Z"),
      m("c", "2026-01-01T23:00:00.000Z"),
    ]);
    expect(sessions.map((session) => session.map((entry) => entry.matchId))).toEqual([["a", "b"], ["c"]]);
  });

  test("orders sessions oldest-first regardless of input order", () => {
    const sessions = clusterSessions([
      m("c", "2026-01-02T20:00:00.000Z"),
      m("a", "2026-01-01T20:00:00.000Z"),
      m("b", "2026-01-01T20:30:00.000Z"),
    ]);
    expect(sessions.map((session) => session.map((entry) => entry.matchId))).toEqual([["a", "b"], ["c"]]);
  });

  test("keeps the matches themselves, not only their ids", () => {
    const sessions = clusterSessions([{ ...m("a", "2026-01-01T20:00:00.000Z"), winner: true }]);
    expect(sessions[0]?.[0]?.winner).toBe(true);
  });

  test("returns no session for no matches", () => {
    expect(clusterSessions([])).toEqual([]);
  });
});

describe("sessionizeMatches", () => {
  test("groups matches 89 minutes apart and splits at 91", () => {
    const placements = sessionizeMatches([
      m("a", "2026-01-01T20:00:00.000Z"),
      m("b", "2026-01-01T21:29:00.000Z"),
      m("c", "2026-01-01T23:00:00.000Z"),
    ]);
    expect(placements.get("a")).toEqual({ position: 1, size: 2 });
    expect(placements.get("b")).toEqual({ position: 2, size: 2 });
    expect(placements.get("c")).toEqual({ position: 1, size: 1 });
  });

  test("is deterministic regardless of input order", () => {
    const a = m("a", "2026-01-01T20:00:00.000Z");
    const b = m("b", "2026-01-01T20:30:00.000Z");
    expect(sessionizeMatches([a, b]).get("b")).toEqual(sessionizeMatches([b, a]).get("b"));
  });

  test("uses the shared 90-minute gap constant by default", () => {
    expect(CONTEXT_SESSION_GAP_MINUTES).toBe(90);
  });

  test("returns an empty map for no matches", () => {
    expect(sessionizeMatches([]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `bun test packages/shared-types`
Expected: FAIL — cannot resolve `./sessions`.

- [ ] **Step 3: Write the minimal implementation** — `packages/shared-types/src/sessions.ts`

```ts
import { CONTEXT_SESSION_GAP_MINUTES } from "./stats";

/** Minimal shape needed to cluster matches into sessions: an identity and a
 * start timestamp. Both the API's C4 context breakdown and the web Dashboard
 * build on this module so the 90-minute rule cannot diverge. */
export interface SessionizableMatch {
  matchId: string;
  /** ISO datetime of the match start. */
  playedAt: string;
}

/** Where a match sits inside its session. */
export interface SessionPlacement {
  /** 1-based rank of the match within its session. */
  position: number;
  /** Number of matches in that session. */
  size: number;
}

function chronology<T extends SessionizableMatch>(a: T, b: T): number {
  return Date.parse(a.playedAt) - Date.parse(b.playedAt) || a.matchId.localeCompare(b.matchId);
}

/**
 * Clusters matches into sessions of consecutive starts at most `gapMinutes`
 * apart (89 minutes apart = one session, 91 = two). The gap between start
 * times is the only boundary derivable from the stored timestamps without
 * inventing an end time. Pure and deterministic: input order does not matter,
 * sessions are returned oldest-first and each session is chronologically
 * ordered, so the most recent session is the last element.
 */
export function clusterSessions<T extends SessionizableMatch>(
  matches: T[],
  gapMinutes: number = CONTEXT_SESSION_GAP_MINUTES,
): T[][] {
  const ordered = [...matches].sort(chronology);
  const gapMs = gapMinutes * 60_000;
  const sessions: T[][] = [];
  let current: T[] = [];
  let previousMs: number | null = null;
  for (const entry of ordered) {
    const ms = Date.parse(entry.playedAt);
    if (previousMs !== null && ms - previousMs > gapMs && current.length > 0) {
      sessions.push(current);
      current = [];
    }
    current.push(entry);
    previousMs = ms;
  }
  if (current.length > 0) sessions.push(current);
  return sessions;
}

/** matchId -> placement within its session. Built on `clusterSessions` so the
 * C4 context breakdown and the web Dashboard share one clustering rule. */
export function sessionizeMatches(
  matches: SessionizableMatch[],
  gapMinutes: number = CONTEXT_SESSION_GAP_MINUTES,
): Map<string, SessionPlacement> {
  const placements = new Map<string, SessionPlacement>();
  for (const session of clusterSessions(matches, gapMinutes)) {
    session.forEach((entry, index) => {
      placements.set(entry.matchId, { position: index + 1, size: session.length });
    });
  }
  return placements;
}
```

- [ ] **Step 4: Export the module** — `packages/shared-types/src/index.ts`: add `export * from "./sessions";`

- [ ] **Step 5: Run the test and watch it pass**

Run: `bun test packages/shared-types`
Expected: PASS (all sessions tests green).

- [ ] **Step 6: Rewire the API to the shared helper** — `apps/api/src/lib/context-aggregate.ts`

Change the import block to pull the clustering from shared-types and delete the local `SessionPlacement` interface and `sessionizeMatches` function (keep `chronological`, which the breakdown builders still use):

```ts
import {
  PROGRESSION_MIN_MATCHES,
  UNKNOWN_GAME_VERSION,
  sessionizeMatches,
  type ContextBreakdown,
  type ContextBucket,
  type ContextResponse,
  type SessionPlacement,
} from "@hots-stats/shared-types";
```

- [ ] **Step 7: Drop the moved test block** — `apps/api/src/lib/context-aggregate.test.ts`

Remove the `describe("sessionizeMatches", ...)` block (lines 17-42) and change line 3 to `import { buildContextResponse, type ContextMatchInput } from "./context-aggregate";`. Drop `CONTEXT_SESSION_GAP_MINUTES` from the line-2 import (keep `PROGRESSION_MIN_MATCHES`).

- [ ] **Step 8: Run the API tests**

Run: `bun test apps/api`
Expected: PASS — the C4 bucket tests still pass through the shared helper.

- [ ] **Step 9: Commit**

```bash
git add packages/shared-types/src/sessions.ts packages/shared-types/src/sessions.test.ts packages/shared-types/src/index.ts apps/api/src/lib/context-aggregate.ts apps/api/src/lib/context-aggregate.test.ts
git commit -m "refactor(shared-types): share session clustering between API and web"
```

---

### Task 2: Last-session summary helper

**Files:**
- Create: `app/web/app/utils/sessionSummary.ts`
- Create: `app/web/app/utils/sessionSummary.test.ts`

**Interfaces:**
- Consumes: `clusterSessions` (Task 1), `PROGRESSION_MIN_MATCHES`, `TrendPoint`.
- Produces: `LastSessionSummary { gamesPlayed; wins; losses; winrate; startedAt; endedAt; lastResult: "win" | "loss"; insufficientSample }` and `summarizeLastSession(points: TrendPoint[]): LastSessionSummary | null`.

- [ ] **Step 1: Write the failing test** — `app/web/app/utils/sessionSummary.test.ts`

```ts
import { describe, expect, test } from "vitest";
import type { TrendPoint } from "@hots-stats/shared-types";
import { summarizeLastSession } from "./sessionSummary";

function point(matchId: string, playedAt: string, winner: boolean): TrendPoint {
  return {
    matchId,
    playedAt,
    winner,
    index: 0,
    rollingWinrate: null,
    rollingKda: null,
    rollingDeathsPer10Min: null,
    gameVersion: null,
  };
}

describe("summarizeLastSession", () => {
  test("returns null with no matches", () => {
    expect(summarizeLastSession([])).toBeNull();
  });

  test("summarises only the most recent cluster", () => {
    const summary = summarizeLastSession([
      point("old-1", "2026-01-01T18:00:00.000Z", true),
      point("old-2", "2026-01-01T18:30:00.000Z", false),
      point("new-1", "2026-01-02T20:00:00.000Z", true),
      point("new-2", "2026-01-02T20:40:00.000Z", true),
      point("new-3", "2026-01-02T21:10:00.000Z", false),
    ]);
    expect(summary).toMatchObject({
      gamesPlayed: 3,
      wins: 2,
      losses: 1,
      winrate: 2 / 3,
      startedAt: "2026-01-02T20:00:00.000Z",
      endedAt: "2026-01-02T21:10:00.000Z",
      lastResult: "loss",
    });
  });

  test("flags a below-threshold sample instead of concluding", () => {
    const summary = summarizeLastSession([point("a", "2026-01-01T20:00:00.000Z", true)]);
    expect(summary?.insufficientSample).toBe(true);
  });

  test("a 20-game session is no longer flagged", () => {
    const points = Array.from({ length: 20 }, (_, i) =>
      point("m" + i, new Date(Date.parse("2026-01-01T20:00:00.000Z") + i * 15 * 60_000).toISOString(), i % 2 === 0),
    );
    expect(summarizeLastSession(points)?.insufficientSample).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `bun run --filter './apps/web' test`
Expected: FAIL — cannot resolve `./sessionSummary`.

- [ ] **Step 3: Write the minimal implementation** — `app/web/app/utils/sessionSummary.ts`

```ts
import { PROGRESSION_MIN_MATCHES, clusterSessions, type TrendPoint } from "@hots-stats/shared-types";

/** The most recent play session, as shown by the Dashboard's "Dernière
 * session" card. Derived from the chronological match series so it shares the
 * API's 90-minute clustering (see shared-types/sessions). */
export interface LastSessionSummary {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winrate: number;
  startedAt: string;
  endedAt: string;
  lastResult: "win" | "loss";
  /** True below PROGRESSION_MIN_MATCHES: the card shows the count, not a verdict. */
  insufficientSample: boolean;
}

/**
 * Summarises the last session of a match series (any input order). Returns
 * null when there is no match at all, so the caller can show an empty state
 * instead of a zeroed record.
 */
export function summarizeLastSession(points: TrendPoint[]): LastSessionSummary | null {
  const session = clusterSessions(points).at(-1);
  const first = session?.[0];
  const last = session?.[session.length - 1];
  if (!session || !first || !last) return null;
  const wins = session.filter((point) => point.winner).length;
  return {
    gamesPlayed: session.length,
    wins,
    losses: session.length - wins,
    winrate: wins / session.length,
    startedAt: first.playedAt,
    endedAt: last.playedAt,
    lastResult: last.winner ? "win" : "loss",
    insufficientSample: session.length < PROGRESSION_MIN_MATCHES,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `bun run --filter './apps/web' test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/utils/sessionSummary.ts apps/web/app/utils/sessionSummary.test.ts
git commit -m "feat(web): add the last-session summary helper (B2)"
```

---

### Task 3: Winrate sparkline geometry

**Files:**
- Create: `app/web/app/utils/sparkline.ts`
- Create: `app/web/app/utils/sparkline.test.ts`

**Interfaces:**
- Produces: `SparklineGeometry { segments: string[]; last: { x: number; y: number } | null }` and `buildWinrateSparkline(values: Array<number | null>, width: number, height: number): SparklineGeometry`.

- [ ] **Step 1: Write the failing test** — `app/web/app/utils/sparkline.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { buildWinrateSparkline } from "./sparkline";

describe("buildWinrateSparkline", () => {
  test("maps 0..1 onto a fixed 0..1 y-domain", () => {
    expect(buildWinrateSparkline([0, 1], 100, 20)).toEqual({
      segments: ["2,18 98,2"],
      last: { x: 98, y: 2 },
    });
  });

  test("breaks the line on null values", () => {
    expect(buildWinrateSparkline([0.5, null, 0.5], 100, 20)).toEqual({
      segments: ["2,10", "98,10"],
      last: { x: 98, y: 10 },
    });
  });

  test("clamps values outside 0..1 instead of drawing off-tile", () => {
    expect(buildWinrateSparkline([2, -1], 100, 20).segments).toEqual(["2,2 98,18"]);
  });

  test("plots a single value at the left edge", () => {
    expect(buildWinrateSparkline([0.5], 100, 20)).toEqual({
      segments: ["2,10"],
      last: { x: 2, y: 10 },
    });
  });

  test("returns nothing to plot for an empty or all-null series", () => {
    expect(buildWinrateSparkline([], 100, 20)).toEqual({ segments: [], last: null });
    expect(buildWinrateSparkline([null, null], 100, 20)).toEqual({ segments: [], last: null });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `bun run --filter './apps/web' test`
Expected: FAIL — cannot resolve `./sparkline`.

- [ ] **Step 3: Write the minimal implementation** — `app/web/app/utils/sparkline.ts`

```ts
/** One SVG polyline point-run for the winrate sparkline. */
export interface SparklineGeometry {
  /** One `"x,y x,y"` polyline point-string per contiguous run of non-null values. */
  segments: string[];
  /** Last plotted point, for the end dot; null when there is nothing to plot. */
  last: { x: number; y: number } | null;
}

const PAD = 2;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Maps rolling winrate values (0..1; null while the rolling window is not
 * filled yet) onto a fixed 0..1 y-domain inside a `width x height` viewBox.
 * The fixed domain is deliberate: a 55% streak must not be stretched to look
 * like a 99% one, and the 50% midpoint stays visually meaningful. Nulls break
 * the line into separate segments instead of bridging a gap.
 */
export function buildWinrateSparkline(
  values: Array<number | null>,
  width: number,
  height: number,
): SparklineGeometry {
  const usableWidth = width - PAD * 2;
  const usableHeight = height - PAD * 2;
  const step = values.length > 1 ? usableWidth / (values.length - 1) : 0;
  const segments: string[] = [];
  let current: string[] = [];
  let last: { x: number; y: number } | null = null;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === null || value === undefined || !Number.isFinite(value)) {
      if (current.length > 0) segments.push(current.join(" "));
      current = [];
      continue;
    }
    const clamped = Math.min(1, Math.max(0, value));
    const x = round(PAD + index * step);
    const y = round(PAD + (1 - clamped) * usableHeight);
    current.push(x + "," + y);
    last = { x, y };
  }
  if (current.length > 0) segments.push(current.join(" "));
  return { segments, last };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `bun run --filter './apps/web' test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/utils/sparkline.ts apps/web/app/utils/sparkline.test.ts
git commit -m "feat(web): add the winrate sparkline geometry helper (B2)"
```

---

### Task 4: SparklineTile component

**Files:**
- Create: `app/web/app/components/progress/SparklineTile.vue`

**Interfaces:**
- Consumes: `buildWinrateSparkline` (Task 3), `TrendResponse`, `DEFAULT_TREND_WINDOW`, `TONE_TILE_CLASS`, `TONE_TEXT_CLASS`, `winrateTone`, `formatPercent`.
- Produces: `<ProgressSparklineTile :trend :loading :error />` — a tile sized to sit as the 4th cell of `StatsAccountSummaryStats`'s grid.

- [ ] **Step 1: Create the component**

```vue
<script setup lang="ts">
import { DEFAULT_TREND_WINDOW, type TrendResponse } from "@hots-stats/shared-types";

const props = withDefaults(
  defineProps<{ trend?: TrendResponse | null; loading?: boolean; error?: boolean }>(),
  { trend: null, loading: false, error: false },
);

const WIDTH = 104;
const HEIGHT = 36;

const window = computed(() => props.trend?.window ?? DEFAULT_TREND_WINDOW);
const values = computed(() => (props.trend?.points ?? []).map((point) => point.rollingWinrate));
const sparkline = computed(() => buildWinrateSparkline(values.value, WIDTH, HEIGHT));

const last = computed(() => {
  for (let index = values.value.length - 1; index >= 0; index--) {
    const value = values.value[index] ?? null;
    if (value !== null) return value;
  }
  return null;
});

const hasLine = computed(() => sparkline.value.segments.length > 0);
const showEmpty = computed(() => !props.loading && !props.error && !hasLine.value);
</script>

<template>
  <div class="rounded-lg border p-3 sm:p-4" :class="TONE_TILE_CLASS.default">
    <p class="text-xs uppercase tracking-wide text-muted">Winrate glissant</p>

    <UiSkeletonBlock v-if="loading && !hasLine" class="mt-2 h-9 rounded" />
    <UiStateCard v-else-if="error" state="error" size="sm" message="Tendance indisponible." />
    <p v-else-if="showEmpty" class="mt-2 text-sm text-muted">
      Fenêtre de {{ window }} parties non atteinte.
    </p>

    <div v-else class="mt-1 flex items-end justify-between gap-2">
      <span class="font-mono text-lg font-semibold sm:text-2xl" :class="TONE_TEXT_CLASS[winrateTone(last)]">
        {{ last === null ? "—" : formatPercent(last) }}
      </span>
      <svg
        :viewBox="'0 0 ' + WIDTH + ' ' + HEIGHT"
        class="h-9 w-24 shrink-0"
        role="img"
        :aria-label="'Winrate glissant sur les ' + window + ' dernières parties'"
      >
        <line
          x1="2"
          :y1="HEIGHT / 2"
          :x2="WIDTH - 2"
          :y2="HEIGHT / 2"
          class="text-border"
          stroke="currentColor"
          stroke-width="1"
          stroke-dasharray="2 2"
        />
        <polyline
          v-for="(segment, index) in sparkline.segments"
          :key="index"
          :points="segment"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          :class="TONE_TEXT_CLASS[winrateTone(last)]"
        />
        <circle
          v-if="sparkline.last"
          :cx="sparkline.last.x"
          :cy="sparkline.last.y"
          r="2.5"
          fill="currentColor"
          :class="TONE_TEXT_CLASS[winrateTone(last)]"
        />
      </svg>
    </div>

    <p v-if="!showEmpty && !error" class="mt-1 text-xs text-muted">
      Sur les {{ window }} dernières parties
    </p>
  </div>
</template>
```

- [ ] **Step 2: Typecheck the component**

Run: `bun run --filter './apps/web' typecheck`
Expected: PASS (the component is auto-imported as `ProgressSparklineTile`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/progress/SparklineTile.vue
git commit -m "feat(web): add the dashboard sparkline tile (B2)"
```

---

### Task 5: SessionSummaryCard component

**Files:**
- Create: `app/web/app/components/progress/SessionSummaryCard.vue`

**Interfaces:**
- Consumes: `summarizeLastSession` (Task 2), `TrendPoint`, `PROGRESSION_MIN_MATCHES`, `UiPanel`, `UiStateCard`, `winrateTone`, `formatDate`.
- Produces: `<ProgressSessionSummaryCard :points :loading :error />`.

- [ ] **Step 1: Create the component**

```vue
<script setup lang="ts">
import { PROGRESSION_MIN_MATCHES, type TrendPoint } from "@hots-stats/shared-types";

const props = withDefaults(
  defineProps<{ points?: TrendPoint[] | null; loading?: boolean; error?: boolean }>(),
  { points: null, loading: false, error: false },
);

const summary = computed(() => summarizeLastSession(props.points ?? []));
const isEmpty = computed(() => !props.loading && !props.error && !summary.value);
const recordTone = computed(() =>
  summary.value?.insufficientSample ? "default" : winrateTone(summary.value?.winrate),
);
</script>

<template>
  <UiPanel title="Dernière session" :count="summary?.gamesPlayed">
    <UiStateCard v-if="loading" state="loading" size="sm" />
    <UiStateCard
      v-else-if="error"
      state="error"
      size="sm"
      message="Impossible de charger ta dernière session."
    />
    <UiStateCard
      v-else-if="isEmpty"
      state="empty"
      size="sm"
      message="Aucune partie enregistrée pour l'instant."
    />
    <div v-else-if="summary" class="space-y-2">
      <div class="flex items-baseline gap-3">
        <span class="font-mono text-lg font-semibold" :class="TONE_TEXT_CLASS[recordTone]">
          {{ summary.wins }} V · {{ summary.losses }} D
        </span>
        <span class="text-sm text-muted">
          {{ summary.gamesPlayed }} partie{{ summary.gamesPlayed > 1 ? "s" : "" }}
        </span>
      </div>
      <p class="text-sm text-muted">{{ formatDate(summary.startedAt) }}</p>
      <p class="text-sm">
        Session terminée sur une {{ summary.lastResult === "win" ? "victoire" : "défaite" }}.
      </p>
      <p v-if="summary.insufficientSample" class="text-xs text-muted">
        Échantillon de {{ summary.gamesPlayed }} partie{{ summary.gamesPlayed > 1 ? "s" : "" }} — au
        moins {{ PROGRESSION_MIN_MATCHES }} sont nécessaires pour conclure.
      </p>
    </div>
  </UiPanel>
</template>
```

- [ ] **Step 2: Typecheck**

Run: `bun run --filter './apps/web' typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/progress/SessionSummaryCard.vue
git commit -m "feat(web): add the dashboard last-session card (B2)"
```

---

### Task 6: AccountSummaryStats — drop the duration tile, add the 4th-tile slot

**Files:**
- Modify: `app/web/app/components/stats/AccountSummaryStats.vue`

**Interfaces:**
- Produces: the component accepts a default slot rendered as the 4th grid cell.
- Removed: the `avgDurationSeconds` member of the internal `AccountSummary` interface and the "Durée moyenne" `UiStatTile`.

- [ ] **Step 1: Replace the component**

```vue
<script setup lang="ts">
interface AccountSummary {
  winrate: number | null;
  gamesPlayed: number;
  wins: number;
}

// The summary can be undefined while it's still loading (most callers await
// their own fetch before rendering this, but a couple render it eagerly) --
// accepting `null | undefined` keeps every caller from having to wrap this
// component in its own `v-if`.
const props = withDefaults(
  defineProps<{ summary?: AccountSummary | null; loading?: boolean }>(),
  { summary: null, loading: false },
);
</script>

<template>
  <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
    <template v-if="loading && !summary">
      <UiSkeletonBlock v-for="i in 4" :key="i" class="h-[86px] rounded-lg border border-border bg-surface" />
    </template>
    <template v-else>
      <UiStatTile
        label="Winrate"
        :value="summary ? formatPercent(summary.winrate ?? 0) : '-'"
        :tone="winrateTone(summary?.winrate)"
      />
      <UiStatTile label="Parties jouées" :value="summary ? String(summary.gamesPlayed) : '-'" />
      <UiStatTile label="Victoires" :value="summary ? String(summary.wins) : '-'" />
      <!-- The Dashboard fills this 4th cell (sparkline tile) so the 4-column
      grid keeps its shape without the removed duration tile. Callers without
      slot content simply render three tiles. -->
      <slot />
    </template>
  </div>
</template>
```

- [ ] **Step 2: Verify no removed prop is still referenced**

Run (PowerShell): `Select-String -Path apps/web/app/components/stats/AccountSummaryStats.vue -Pattern 'avgDurationSeconds|Durée moyenne'`
Expected: no match.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/stats/AccountSummaryStats.vue
git commit -m "feat(web): drop the dashboard duration tile and expose a 4th-tile slot (B2)"
```

---

### Task 7: Dashboard page rewire

**Files:**
- Modify: `app/web/app/pages/index.vue`

**Interfaces:**
- Consumes: `ProgressSparklineTile` (Task 4), `ProgressSessionSummaryCard` (Task 5), the slotted `StatsAccountSummaryStats` (Task 6), `selectWorkAxes` from `~/composables/useProgression`.

- [ ] **Step 1: Script block** — replace the import block and the data fetching.

Imports become:

```ts
import type { DriversResponse, TrendResponse } from "@hots-stats/shared-types";
import type { MatchListResponse, StatsSummary } from "~/types/matches";
import type { NavCardColor } from "~/components/ui/NavCard.vue";
import { selectWorkAxes } from "~/composables/useProgression";
```

Delete the weaknesses lines:

```ts
const { data: weaknesses } = await useApiFetch<WeaknessesResponse>("/weaknesses");
const topLeak = computed(() => (weaknesses.value ? getTopWeaknesses(weaknesses.value, { limit: 1 })[0] : undefined));
const topStrength = computed(() => (weaknesses.value ? getTopStrengths(weaknesses.value, { limit: 1 })[0] : undefined));
```

After the two existing awaited calls, add:

```ts
// Both additive B2 calls are personal for the same reason as `summary` above:
// the Dashboard must never inherit the global `heroStatsScope` preference.
// Neither is awaited, so the base load stays the single
// `/stats/summary` + `/matches?pageSize=8` round-trip it was before B2.
// `/stats/trend` is fetched once and shared by the sparkline tile and the
// last-session card; `/stats/drivers` powers the #1 work-axis card.
const { data: trend, pending: trendPending, error: trendError } = useApiFetch<TrendResponse>(
  "/stats/trend",
  { query: { scope: "personal" } },
);
const { data: drivers, pending: driversPending, error: driversError } = useApiFetch<DriversResponse>(
  "/stats/drivers",
  { query: { scope: "personal" } },
);

const topAxis = computed(() =>
  drivers.value ? (selectWorkAxes(drivers.value.drivers)[0] ?? null) : null,
);
```

- [ ] **Step 2: Template — mount the sparkline in the summary grid**

Replace `<StatsAccountSummaryStats :summary="summary" />` with:

```html
<StatsAccountSummaryStats :summary="summary">
  <ProgressSparklineTile
    :trend="trend"
    :loading="trendPending"
    :error="Boolean(trendError)"
  />
</StatsAccountSummaryStats>
```

- [ ] **Step 3: Template — replace the two point-fort/point-faible teasers**

Delete the whole `<div v-if="topLeak || topStrength" ...>` block and put in its place:

```html
<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
  <UiStateCard
    v-if="driversPending && !topAxis"
    state="loading"
    size="sm"
  />
  <UiStateCard
    v-else-if="driversError"
    state="error"
    size="sm"
    message="Impossible de charger ton chantier n°1."
  />
  <UiTeaserLink
    v-else
    to="/progress"
    icon="i-heroicons-arrow-trending-up"
    eyebrow="Ton chantier n°1"
  >
    {{ topAxis ? topAxis.label : "Pas encore assez de parties — découvre la page Progression" }}
  </UiTeaserLink>

  <ProgressSessionSummaryCard
    :points="trend?.points ?? []"
    :loading="trendPending"
    :error="Boolean(trendError)"
  />
</div>
```

- [ ] **Step 4: Template — hide the Navigation grid from `lg` up**

Change `<div class="space-y-6">` (the Navigation section wrapper) to `<div class="space-y-6 lg:hidden">`. The desktop sidebar already links every destination; below `lg` the mobile bar only holds four links, so the cards stay the primary navigation there.

- [ ] **Step 5: Verify nothing removed is still referenced**

```bash
git grep -n "topLeak|topStrength|WeaknessesResponse" -- apps/web/app/pages/index.vue
```
Expected: no match.

- [ ] **Step 6: Typecheck + web tests**

Run: `bun run typecheck`
Run: `bun run --filter './apps/web' test`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/pages/index.vue
git commit -m "feat(web): clean up the dashboard and surface progression (B2)"
```

---

### Task 8: Docs and full verification

**Files:**
- Modify: `tasks/progression-roadmap.md`
- Modify: `tasks/README.md`

- [ ] **Step 1:** Tick B2 in `tasks/progression-roadmap.md` and add the variances (shared clustering; last session derived from `/stats/trend` because E1 does not exist yet; 3 tiles on the other `StatsAccountSummaryStats` callers; `lg:hidden` nav; sparkline reuse; upload teaser kept).

- [ ] **Step 2:** Add one bullet to the end of the "Déjà fait" section of `tasks/README.md`.

- [ ] **Step 3: Run the full gate**

```bash
bun run typecheck
bun test packages/shared-types
bun test apps/api
bun run --filter './apps/web' test
```
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add tasks/progression-roadmap.md tasks/README.md docs/superpowers/plans/2026-09-18-b2-dashboard-cleanup.md
git commit -m "docs(tasks): plan and mark B2 done"
```

---

## Self-Review

**Spec coverage**
- Remove "Durée moyenne" tile -> Task 6.
- Remove the two `UiTeaserLink` point-fort/point-faible blocks -> Task 7 Step 3.
- Remove the Navigation grid on `lg`+ (keep below) -> Task 7 Step 4.
- Add rolling-winrate sparkline (A3, window 20) -> Tasks 3 + 4 + 7.
- Add "Ton chantier n°1" card linking `/progress` -> Tasks 7 Steps 1/3.
- Add "Dernière session" line (games, record, insight) -> Tasks 2 + 5 + 7.
- Acceptance 1 (still 4 tiles) -> Task 6 slot + Task 7 Step 2.
- Acceptance 2 (single summary+matches load; one trend fetch) -> Task 7 Step 1 (single `useApiFetch("/stats/trend")` shared, nothing awaited).
- Acceptance 3 (nothing removed referenced) -> Tasks 6 Step 2 and 7 Step 5.

**Placeholders:** none — every code step ships the real code.

**Type consistency:** `clusterSessions`/`sessionizeMatches` (Task 1) feed Task 2; `buildWinrateSparkline`/`SparklineGeometry` (Task 3) feed Task 4; `summarizeLastSession`/`LastSessionSummary` (Task 2) feed Task 5; component names match Nuxt's `progress/` prefix rule (`ProgressSparklineTile`, `ProgressSessionSummaryCard`).
