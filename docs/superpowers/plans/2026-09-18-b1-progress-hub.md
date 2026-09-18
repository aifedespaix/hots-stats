# B1 + C4 — Hub de progression (/progress) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Ship the C4 context-breakdown endpoint and the B1 /progress hub page that aggregates the existing A1/A3/A4 progression endpoints plus C4.

**Architecture:** Follow the established A1/A3/A4 split: a pure aggregation module under apps/api/src/lib/ (no DB import, testable without DATABASE_URL) plus a thin DB-scoping service under apps/api/src/services/ that resolves each match's subject with the shared resolveSubject and delegates the maths. The web page is a single composable (useProgression.ts) feeding four presentational components.

**Tech Stack:** Bun + Hono + Drizzle (API), Nuxt 4 + Vue 3 + chart.js/vue-chartjs + Nuxt UI (web), Zod (query validation), bun:test + vitest.

**Spec:** docs/superpowers/specs/2026-09-18-player-progression-design.md (sections B1, C4, Cross-cutting rules, Rollout order)

## Global Constraints

- French UI strings; English identifiers and comments.
- Every personal query goes through accountScope / scopeConditions; never eq(matchPlayers.userId, ...).
- Never invent data (no MMR/rank, no objective captures, no simulated respawn timer).
- Every aggregate ships its n; below PROGRESSION_MIN_MATCHES (20) show the raw count instead of a verdict.
- scope=global is refused with a 400 by /stats/patterns, /stats/trend, /stats/drivers; /stats/context follows the same rule. The /progress page is therefore personal-only.
- Migrations are additive only. **C4 adds no migration.**
- No new dependency.
- C4 must not assume server-local time: the API takes an explicit tzOffsetMinutes (offset **east of UTC**, e.g. UTC+2 = 120, matching -new Date().getTimezoneOffset() in the browser).
- Gate commands before commit/push: bun run typecheck, bun test packages/shared-types, bun test apps/api, bun run --filter './apps/web' test.

---

## File Structure

| File | Responsibility |
|---|---|
| packages/shared-types/src/stats.ts | + C4 contracts and CONTEXT_SESSION_GAP_MINUTES (modify) |
| apps/api/src/lib/context-aggregate.ts | Pure C4 bucketing + session clustering, no DB (create) |
| apps/api/src/lib/context-aggregate.test.ts | bun:test for the pure module (create) |
| apps/api/src/services/context.service.ts | DB scoping/assembly for C4 (create) |
| apps/api/src/routes/stats.ts | + GET /stats/context (modify) |
| apps/web/app/composables/useProgression.ts | Fetch wiring + selectWorkAxes (create) |
| apps/web/app/composables/useProgression.test.ts | vitest for selectWorkAxes (create) |
| apps/web/app/components/progress/TrendChart.vue | A3 trend chart + patch markers + A/B (create) |
| apps/web/app/components/progress/WorkAxesCard.vue | Top-3 work axes (A4) (create) |
| apps/web/app/components/progress/PatternTable.vue | A1 recurrence table (create) |
| apps/web/app/components/progress/ContextBreakdown.vue | C4 charts + tables (create) |
| apps/web/app/pages/progress.vue | The hub page (create) |
| apps/web/app/layouts/default.vue | + nav entry after "Diagnostic" (modify) |
| apps/web/app/pages/index.vue | + dashboard card (modify) |
| tasks/progression-roadmap.md, tasks/README.md | Tick B1/C4 + notes (modify) |

---

### Task 1: C4 shared contracts

**Files:**
- Modify: packages/shared-types/src/stats.ts (append after the A4 block)
- Test: none (types/constants only — no behaviour).

**Interfaces:**
- Produces: CONTEXT_SESSION_GAP_MINUTES, ContextBucket, ContextBreakdown, ContextResponse.

- [ ] **Step 1: Append the contracts**

~~~ts
// --- Player progression suite (C4 — context breakdown) ---

/** Two consecutive matches belong to the same session while their start times
 * are at most this many minutes apart; beyond it the next match starts a new
 * session (89 minutes = one session, 91 = two). Shared so the API clustering
 * and any UI copy cannot disagree. */
export const CONTEXT_SESSION_GAP_MINUTES = 90;

/** One bucket of a C4 context breakdown. winrate is 0 for an empty bucket --
 * insufficientSample is the flag the UI must honour instead of the rate. */
export interface ContextBucket {
  key: string;
  /** French display label. */
  label: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  /** True when gamesPlayed < PROGRESSION_MIN_MATCHES (20). */
  insufficientSample: boolean;
}

/** One dimension of the C4 context breakdown. dimension is one of
 * "hour" | "weekday" | "sessionPosition" | "sessionSize" | "patch" |
 * "teamComposition". */
export interface ContextBreakdown {
  dimension: string;
  /** French display label. */
  label: string;
  buckets: ContextBucket[];
}

/** Response for GET /stats/context (C4). tzOffsetMinutes is the offset east of
 * UTC the buckets were computed in, echoed back so the UI can label them. */
export interface ContextResponse {
  scope: "personal" | "global";
  matches: number;
  tzOffsetMinutes: number;
  breakdowns: ContextBreakdown[];
}
~~~

- [ ] **Step 2: Typecheck**

Run: bun run typecheck
Expected: PASS (no consumer yet).

- [ ] **Step 3: Commit**

~~~bash
git add packages/shared-types/src/stats.ts
git commit -m "feat(shared-types): add context-breakdown contracts (C4)"
~~~

---

### Task 2: Pure C4 aggregation (TDD)

**Files:**
- Create: apps/api/src/lib/context-aggregate.test.ts
- Create: apps/api/src/lib/context-aggregate.ts

**Interfaces:**
- Consumes: CONTEXT_SESSION_GAP_MINUTES, PROGRESSION_MIN_MATCHES, UNKNOWN_GAME_VERSION, ContextResponse (Task 1).
- Produces: ContextMatchInput, SessionPlacement, sessionizeMatches(...), buildContextResponse(...).

- [ ] **Step 1: Write the failing test**

~~~ts
import { describe, expect, test } from "bun:test";
import { CONTEXT_SESSION_GAP_MINUTES, PROGRESSION_MIN_MATCHES } from "@hots-stats/shared-types";
import { buildContextResponse, sessionizeMatches, type ContextMatchInput } from "./context-aggregate";

function match(
  overrides: Partial<ContextMatchInput> & { matchId: string; playedAt: string },
): ContextMatchInput {
  return { winner: false, gameVersion: "2.55.0", teamRoleCounts: { Tank: 1 }, ...overrides };
}

function breakdown(response: ReturnType<typeof buildContextResponse>, dimension: string) {
  const found = response.breakdowns.find((entry) => entry.dimension === dimension);
  if (!found) throw new Error("missing breakdown " + dimension);
  return found;
}

describe("sessionizeMatches", () => {
  test("groups matches 89 minutes apart and splits at 91", () => {
    const placements = sessionizeMatches([
      match({ matchId: "a", playedAt: "2026-01-01T20:00:00.000Z" }),
      match({ matchId: "b", playedAt: "2026-01-01T21:29:00.000Z" }),
      match({ matchId: "c", playedAt: "2026-01-01T23:00:00.000Z" }),
    ]);
    expect(placements.get("a")).toEqual({ position: 1, size: 2 });
    expect(placements.get("b")).toEqual({ position: 2, size: 2 });
    expect(placements.get("c")).toEqual({ position: 1, size: 1 });
  });

  test("is deterministic regardless of input order", () => {
    const a = match({ matchId: "a", playedAt: "2026-01-01T20:00:00.000Z" });
    const b = match({ matchId: "b", playedAt: "2026-01-01T20:30:00.000Z" });
    expect(sessionizeMatches([a, b]).get("b")).toEqual(sessionizeMatches([b, a]).get("b"));
  });

  test("uses the shared 90-minute gap constant by default", () => {
    expect(CONTEXT_SESSION_GAP_MINUTES).toBe(90);
  });

  test("returns an empty map for no matches", () => {
    expect(sessionizeMatches([]).size).toBe(0);
  });
});

describe("buildContextResponse", () => {
  test("buckets the hour in the caller timezone offset", () => {
    const response = buildContextResponse(
      [match({ matchId: "a", playedAt: "2026-01-01T23:30:00.000Z", winner: true })],
      "personal",
      -120,
    );
    const hour = breakdown(response, "hour");
    expect(hour.buckets).toHaveLength(24);
    expect(hour.buckets[21]).toMatchObject({ gamesPlayed: 1, wins: 1, winrate: 1 });
    expect(hour.buckets[23]).toMatchObject({ gamesPlayed: 0, winrate: 0 });
  });

  test("buckets the weekday from the local date, Monday first", () => {
    // 2026-01-05 is a Monday.
    const response = buildContextResponse(
      [match({ matchId: "a", playedAt: "2026-01-05T12:00:00.000Z" })],
      "personal",
      0,
    );
    const weekday = breakdown(response, "weekday");
    expect(weekday.buckets).toHaveLength(7);
    expect(weekday.buckets[0]).toMatchObject({ key: "1", label: "Lundi", gamesPlayed: 1 });
  });

  test("buckets session position and size from the cluster placement", () => {
    const response = buildContextResponse(
      [
        match({ matchId: "a", playedAt: "2026-01-01T20:00:00.000Z" }),
        match({ matchId: "b", playedAt: "2026-01-01T20:30:00.000Z" }),
        match({ matchId: "c", playedAt: "2026-01-01T23:00:00.000Z" }),
      ],
      "personal",
      0,
    );
    expect(breakdown(response, "sessionPosition").buckets.map((b) => [b.key, b.gamesPlayed])).toEqual([
      ["1", 2],
      ["2", 1],
    ]);
    expect(breakdown(response, "sessionSize").buckets.map((b) => [b.key, b.gamesPlayed])).toEqual([
      ["1", 1],
      ["2", 2],
    ]);
  });

  test("adds an explicit unknown patch bucket for null versions", () => {
    const response = buildContextResponse(
      [
        match({ matchId: "a", playedAt: "2026-01-01T20:00:00.000Z", gameVersion: "2.55.0" }),
        match({ matchId: "b", playedAt: "2026-01-01T20:30:00.000Z", gameVersion: null }),
      ],
      "personal",
      0,
    );
    expect(breakdown(response, "patch").buckets).toEqual([
      expect.objectContaining({ key: "2.55.0", gamesPlayed: 1 }),
      expect.objectContaining({ key: "unknown", label: "Version inconnue", gamesPlayed: 1 }),
    ]);
  });

  test("buckets team compositions from the supplied role counts", () => {
    const response = buildContextResponse(
      [
        match({
          matchId: "a",
          playedAt: "2026-01-01T20:00:00.000Z",
          teamRoleCounts: { Tank: 1, Healer: 1, RangedAssassin: 3 },
        }),
        match({
          matchId: "b",
          playedAt: "2026-01-01T20:30:00.000Z",
          teamRoleCounts: { Tank: 1, Healer: 1, RangedAssassin: 3 },
        }),
      ],
      "personal",
      0,
    );
    const composition = breakdown(response, "teamComposition");
    expect(composition.buckets).toHaveLength(1);
    expect(composition.buckets[0]).toMatchObject({
      gamesPlayed: 2,
      label: "1× Tank · 3× Assassin à distance · 1× Soigneur",
    });
  });

  test("flags every bucket below the shared gate instead of hiding it", () => {
    const response = buildContextResponse(
      [match({ matchId: "a", playedAt: "2026-01-01T20:00:00.000Z" })],
      "personal",
      0,
    );
    const hour = breakdown(response, "hour");
    expect(hour.buckets[20]).toMatchObject({ gamesPlayed: 1, insufficientSample: true });
    expect(response.matches).toBe(1);
    expect(PROGRESSION_MIN_MATCHES).toBe(20);
  });

  test("returns zeroed breakdowns for an empty match set", () => {
    const response = buildContextResponse([], "personal", 120);
    expect(response.matches).toBe(0);
    expect(response.tzOffsetMinutes).toBe(120);
    expect(response.breakdowns.map((entry) => entry.dimension)).toEqual([
      "hour",
      "weekday",
      "sessionPosition",
      "sessionSize",
      "patch",
      "teamComposition",
    ]);
    expect(breakdown(response, "hour").buckets).toHaveLength(24);
    expect(breakdown(response, "weekday").buckets).toHaveLength(7);
    expect(breakdown(response, "sessionPosition").buckets).toEqual([]);
    expect(breakdown(response, "teamComposition").buckets).toEqual([]);
  });
});
~~~

- [ ] **Step 2: Run the test, watch it fail**

Run: bun test apps/api/src/lib/context-aggregate.test.ts
Expected: FAIL — cannot find module ./context-aggregate.

- [ ] **Step 3: Implement the module**

~~~ts
import {
  CONTEXT_SESSION_GAP_MINUTES,
  PROGRESSION_MIN_MATCHES,
  UNKNOWN_GAME_VERSION,
  type ContextBreakdown,
  type ContextBucket,
  type ContextResponse,
} from "@hots-stats/shared-types";

/** One scope-resolved match feeding the C4 context breakdown. */
export interface ContextMatchInput {
  matchId: string;
  /** ISO datetime. */
  playedAt: string;
  winner: boolean;
  gameVersion: string | null;
  /** Role counts on the subject OWN team only (heroes.role -> count); heroes
   * with an unknown role are keyed "unknown". */
  teamRoleCounts: Record<string, number>;
}

/** Where a match sits inside its session. */
export interface SessionPlacement {
  /** 1-based rank of the match within its session. */
  position: number;
  /** Number of matches in that session. */
  size: number;
}

const ROLE_ORDER = ["Tank", "Bruiser", "RangedAssassin", "MeleeAssassin", "Healer", "Support", "unknown"] as const;
const ROLE_LABELS: Record<string, string> = {
  Tank: "Tank",
  Bruiser: "Bagarreur",
  RangedAssassin: "Assassin à distance",
  MeleeAssassin: "Assassin au corps à corps",
  Healer: "Soigneur",
  Support: "Soutien",
  unknown: "Rôle inconnu",
};

/** Monday-first, matching the French labels. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_LABELS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

function chronological(matches: ContextMatchInput[]): ContextMatchInput[] {
  return [...matches].sort(
    (a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt) || a.matchId.localeCompare(b.matchId),
  );
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/** Shifts a UTC instant by the caller offset (east of UTC, in minutes) so the
 * getUTC* accessors read the caller local wall clock, independent of the server
 * own timezone. */
function localDate(playedAt: string, tzOffsetMinutes: number): Date {
  return new Date(Date.parse(playedAt) + tzOffsetMinutes * 60_000);
}

/**
 * Clusters consecutive matches whose start times are at most gapMinutes apart
 * into sessions (89 minutes apart = one session, 91 = two). Pure and
 * deterministic: the set is sorted first, so input order does not matter. The
 * start-time gap is the only boundary derivable from the stored timestamps
 * without inventing an end time.
 */
export function sessionizeMatches(
  matches: Array<{ matchId: string; playedAt: string }>,
  gapMinutes: number = CONTEXT_SESSION_GAP_MINUTES,
): Map<string, SessionPlacement> {
  const ordered = [...matches].sort(
    (a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt) || a.matchId.localeCompare(b.matchId),
  );
  const gapMs = gapMinutes * 60_000;
  const sessions: string[][] = [];
  let current: string[] = [];
  let previousMs: number | null = null;
  for (const entry of ordered) {
    const ms = Date.parse(entry.playedAt);
    if (previousMs !== null && ms - previousMs > gapMs && current.length > 0) {
      sessions.push(current);
      current = [];
    }
    current.push(entry.matchId);
    previousMs = ms;
  }
  if (current.length > 0) sessions.push(current);

  const placements = new Map<string, SessionPlacement>();
  for (const session of sessions) {
    session.forEach((matchId, index) => placements.set(matchId, { position: index + 1, size: session.length }));
  }
  return placements;
}

function bucket(key: string, label: string, matches: ContextMatchInput[]): ContextBucket {
  const gamesPlayed = matches.length;
  const wins = matches.filter((entry) => entry.winner).length;
  return {
    key,
    label,
    gamesPlayed,
    wins,
    winrate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
    insufficientSample: gamesPlayed < PROGRESSION_MIN_MATCHES,
  };
}

function hourBreakdown(matches: ContextMatchInput[], tzOffsetMinutes: number): ContextBreakdown {
  const grouped = groupBy(matches, (entry) => localDate(entry.playedAt, tzOffsetMinutes).getUTCHours());
  const buckets = Array.from({ length: 24 }, (_, hour) =>
    bucket(String(hour), String(hour).padStart(2, "0") + "h", grouped.get(hour) ?? []),
  );
  return { dimension: "hour", label: "Heure de la journée", buckets };
}

function weekdayBreakdown(matches: ContextMatchInput[], tzOffsetMinutes: number): ContextBreakdown {
  const grouped = groupBy(matches, (entry) => localDate(entry.playedAt, tzOffsetMinutes).getUTCDay());
  const buckets = WEEKDAY_ORDER.map((day) =>
    bucket(String(day), WEEKDAY_LABELS[day] ?? String(day), grouped.get(day) ?? []),
  );
  return { dimension: "weekday", label: "Jour de la semaine", buckets };
}

function sessionPositionBreakdown(
  matches: ContextMatchInput[],
  placements: Map<string, SessionPlacement>,
): ContextBreakdown {
  const grouped = groupBy(matches, (entry) => placements.get(entry.matchId)?.position ?? 0);
  const maxPosition = Math.max(0, ...[...placements.values()].map((placement) => placement.position));
  const buckets = Array.from({ length: maxPosition }, (_, index) => {
    const position = index + 1;
    return bucket(String(position), "Partie n°" + position, grouped.get(position) ?? []);
  });
  return { dimension: "sessionPosition", label: "Rang dans la session", buckets };
}

function sessionSizeBreakdown(matches: ContextMatchInput[], placements: Map<string, SessionPlacement>): ContextBreakdown {
  const grouped = groupBy(matches, (entry) => placements.get(entry.matchId)?.size ?? 0);
  const sizes = [...new Set([...placements.values()].map((placement) => placement.size))].sort((a, b) => a - b);
  const buckets = sizes.map((size) =>
    bucket(String(size), "Session de " + size + " partie" + (size > 1 ? "s" : ""), grouped.get(size) ?? []),
  );
  return { dimension: "sessionSize", label: "Taille de session", buckets };
}

function patchBreakdown(matches: ContextMatchInput[]): ContextBreakdown {
  const grouped = groupBy(matches, (entry) => entry.gameVersion ?? UNKNOWN_GAME_VERSION);
  const versions = [...grouped.keys()].sort((a, b) => {
    if (a === UNKNOWN_GAME_VERSION) return 1;
    if (b === UNKNOWN_GAME_VERSION) return -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
  const buckets = versions.map((version) =>
    bucket(version, version === UNKNOWN_GAME_VERSION ? "Version inconnue" : version, grouped.get(version) ?? []),
  );
  return { dimension: "patch", label: "Patch", buckets };
}

function compositionKey(counts: Record<string, number>): string {
  const parts: string[] = [];
  for (const role of ROLE_ORDER) {
    const count = counts[role] ?? 0;
    if (count > 0) parts.push(role + ":" + count);
  }
  return parts.length > 0 ? parts.join("|") : "unknown:0";
}

function compositionLabel(counts: Record<string, number>): string {
  const parts: string[] = [];
  for (const role of ROLE_ORDER) {
    const count = counts[role] ?? 0;
    if (count > 0) parts.push(count + "× " + (ROLE_LABELS[role] ?? role));
  }
  return parts.length > 0 ? parts.join(" · ") : "Composition inconnue";
}

function compositionBreakdown(matches: ContextMatchInput[]): ContextBreakdown {
  const grouped = groupBy(matches, (entry) => compositionKey(entry.teamRoleCounts));
  const buckets = [...grouped.entries()]
    .map(([key, list]) => bucket(key, compositionLabel(list[0]?.teamRoleCounts ?? {}), list))
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed || a.key.localeCompare(b.key));
  return { dimension: "teamComposition", label: "Composition d'équipe", buckets };
}

/** Full C4 response over an already scoped/filtered match set. Empty input
 * still yields the six dimensions (24 hours, 7 weekdays, empty others) so the
 * UI never has to special-case a missing dimension. */
export function buildContextResponse(
  matches: ContextMatchInput[],
  scope: "personal" | "global",
  tzOffsetMinutes: number,
): ContextResponse {
  const ordered = chronological(matches);
  const placements = sessionizeMatches(ordered);
  return {
    scope,
    matches: ordered.length,
    tzOffsetMinutes,
    breakdowns: [
      hourBreakdown(ordered, tzOffsetMinutes),
      weekdayBreakdown(ordered, tzOffsetMinutes),
      sessionPositionBreakdown(ordered, placements),
      sessionSizeBreakdown(ordered, placements),
      patchBreakdown(ordered),
      compositionBreakdown(ordered),
    ],
  };
}
~~~

- [ ] **Step 4: Run the test, watch it pass**

Run: bun test apps/api/src/lib/context-aggregate.test.ts
Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/api/src/lib/context-aggregate.ts apps/api/src/lib/context-aggregate.test.ts
git commit -m "feat(api): add pure context-breakdown aggregation (C4)"
~~~

---

### Task 3: C4 DB service + route

**Files:**
- Create: apps/api/src/services/context.service.ts
- Modify: apps/api/src/routes/stats.ts

**Interfaces:**
- Consumes: buildContextResponse, ContextMatchInput (Task 2); resolveSubject / RosterPlayer; scopeConditions / Scope.
- Produces: getContext(scope, filters, tzOffsetMinutes).

- [ ] **Step 1: Implement the service**

~~~ts
import { db, heroes, matchPlayers, matches } from "@hots-stats/db";
import type { ContextResponse, GameMode } from "@hots-stats/shared-types";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { type Scope, scopeConditions } from "../lib/account-selection";
import { buildContextResponse, type ContextMatchInput } from "../lib/context-aggregate";
import { type RosterPlayer, resolveSubject } from "../lib/pattern-aggregate";

export interface ContextFilters {
  mode?: GameMode[];
  heroId?: string;
  mapId?: string;
  from?: string;
  to?: string;
}

/**
 * Builds the C4 context breakdown over every match the scope played, optionally
 * filtered by mode/hero/map/date. The subject of each match is resolved with
 * the same shared rule as A1/A3/A4 (resolveSubject): the SQL scopeCondition
 * already restricts candidate rows to the caller own battletags, so another
 * user match can never be selected. Team-composition counts are taken from the
 * subject own team only.
 */
export async function getContext(
  scope: Scope,
  filters: ContextFilters,
  tzOffsetMinutes: number,
): Promise<ContextResponse> {
  const conditions = scopeConditions([], scope, matchPlayers.battletag);
  if (filters.mode && filters.mode.length > 0) conditions.push(inArray(matches.gameMode, filters.mode));
  if (filters.heroId) conditions.push(eq(matchPlayers.heroId, filters.heroId));
  if (filters.mapId) conditions.push(eq(matches.mapId, filters.mapId));
  if (filters.from) conditions.push(gte(matches.playedAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(matches.playedAt, new Date(filters.to)));

  const candidateRows = await db
    .select({
      matchId: matchPlayers.matchId,
      playedAt: matches.playedAt,
      gameVersion: matches.gameVersion,
      winner: matchPlayers.winner,
      battletag: matchPlayers.battletag,
      team: matchPlayers.team,
      kills: matchPlayers.kills,
      deaths: matchPlayers.deaths,
      assists: matchPlayers.assists,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(matches.playedAt), asc(matchPlayers.matchId));

  if (candidateRows.length === 0) return buildContextResponse([], scope.mode, tzOffsetMinutes);

  const scopedBattletags = scope.mode === "personal" ? scope.battletags : [];
  const candidatesByMatch = new Map<string, typeof candidateRows>();
  for (const row of candidateRows) {
    const list = candidatesByMatch.get(row.matchId) ?? [];
    list.push(row);
    candidatesByMatch.set(row.matchId, list);
  }

  // One subject row per match: the scope first account that played it.
  const subjectsByMatch = new Map<string, (typeof candidateRows)[number]>();
  for (const [matchId, candidates] of candidatesByMatch) {
    const roster: RosterPlayer[] = candidates.map((row) => ({
      battletag: row.battletag,
      team: row.team === 1 ? 1 : 0,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      winner: row.winner,
    }));
    const subject = resolveSubject(roster, scopedBattletags);
    if (!subject) continue;
    const row = candidates.find((candidate) => candidate.battletag === subject.battletag);
    if (row) subjectsByMatch.set(matchId, row);
  }

  const matchIds = [...subjectsByMatch.keys()];
  if (matchIds.length === 0) return buildContextResponse([], scope.mode, tzOffsetMinutes);

  // Full roster of those matches joined to hero roles, then restricted to the
  // subject own team -- team composition is "what my team looked like", not the
  // enemy one.
  const rosterRows = await db
    .select({ matchId: matchPlayers.matchId, team: matchPlayers.team, role: heroes.role })
    .from(matchPlayers)
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .where(inArray(matchPlayers.matchId, matchIds));

  const roleCountsByMatch = new Map<string, Record<string, number>>();
  for (const row of rosterRows) {
    const subject = subjectsByMatch.get(row.matchId);
    if (!subject || row.team !== subject.team) continue;
    const counts = roleCountsByMatch.get(row.matchId) ?? {};
    const role = row.role ?? "unknown";
    counts[role] = (counts[role] ?? 0) + 1;
    roleCountsByMatch.set(row.matchId, counts);
  }

  const inputs: ContextMatchInput[] = [...subjectsByMatch.values()].map((row) => ({
    matchId: row.matchId,
    playedAt: row.playedAt.toISOString(),
    winner: row.winner,
    gameVersion: row.gameVersion,
    teamRoleCounts: roleCountsByMatch.get(row.matchId) ?? {},
  }));

  return buildContextResponse(inputs, scope.mode, tzOffsetMinutes);
}
~~~

- [ ] **Step 2: Wire the route**

In apps/api/src/routes/stats.ts, import getContext, add contextQuerySchema after driversQuerySchema:

~~~ts
const contextQuerySchema = z.object({
  scope: heroStatsScopeSchema.optional(),
  accounts: accountsQuerySchema,
  mode: gameModeListSchema.optional(),
  heroId: z.string().optional(),
  mapId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  // Offset east of UTC (UTC+2 -> 120), sent explicitly by the web client so the
  // buckets never depend on the server own timezone. Required: an omitted value
  // would silently bucket everyone at UTC.
  tzOffsetMinutes: z.coerce.number().int().min(-840).max(840),
});
~~~

Append the handler after /drivers:

~~~ts
  .get("/context", async (c) => {
    const parsed = contextQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    // Context buckets are personal for the same reason as /patterns, /trend and
    // /drivers: team composition needs a subject. An explicit global scope is
    // refused; an omitted scope falls back to the caller own accounts.
    const scope = withStatsScope(c.get("scope"), parsed.data.scope ?? "personal");
    if (scope.mode === "global") {
      return c.json(
        { error: "Le contexte de victoire n'est disponible que pour ton profil (scope=personal)." },
        400,
      );
    }

    return c.json(
      await getContext(
        scope,
        {
          mode: parsed.data.mode,
          heroId: parsed.data.heroId,
          mapId: parsed.data.mapId,
          from: parsed.data.from,
          to: parsed.data.to,
        },
        parsed.data.tzOffsetMinutes,
      ),
    );
  });
~~~

- [ ] **Step 3: Typecheck + API suite**

Run: bun run typecheck && bun test apps/api
Expected: PASS.

- [ ] **Step 4: Commit**

~~~bash
git add apps/api/src/services/context.service.ts apps/api/src/routes/stats.ts
git commit -m "feat(api): scope context breakdown and expose GET /stats/context (C4)"
~~~

---

### Task 4: Web fetch composable + work-axis selection (TDD)

**Files:**
- Create: apps/web/app/composables/useProgression.test.ts
- Create: apps/web/app/composables/useProgression.ts

- [ ] **Step 1: Write the failing test**

~~~ts
import type { DriverMetric } from "@hots-stats/shared-types";
import { describe, expect, test } from "vitest";
import { selectWorkAxes } from "./useProgression";

function driver(overrides: Partial<DriverMetric>): DriverMetric {
  return {
    key: "k",
    label: "L",
    betterWhen: "lower",
    meanInWins: 0,
    meanInLosses: 0,
    effectSize: 0,
    winsSample: 20,
    lossesSample: 20,
    reliable: true,
    ...overrides,
  };
}

describe("selectWorkAxes", () => {
  test("keeps only reliable drivers", () => {
    const result = selectWorkAxes([
      driver({ key: "a", effectSize: 2, reliable: true }),
      driver({ key: "b", effectSize: 3, reliable: false }),
    ]);
    expect(result.map((entry) => entry.key)).toEqual(["a"]);
  });

  test("sorts reliable drivers by absolute effect size", () => {
    const result = selectWorkAxes([
      driver({ key: "a", effectSize: 0.5 }),
      driver({ key: "b", effectSize: -1.8 }),
      driver({ key: "c", effectSize: 1.2 }),
    ]);
    expect(result.map((entry) => entry.key)).toEqual(["b", "c", "a"]);
  });

  test("caps at three axes", () => {
    const result = selectWorkAxes(["a", "b", "c", "d"].map((key, i) => driver({ key, effectSize: i + 1 })));
    expect(result.map((entry) => entry.key)).toEqual(["d", "c", "b"]);
  });

  test("returns an empty list when nothing is reliable", () => {
    expect(selectWorkAxes([driver({ key: "a", reliable: false })])).toEqual([]);
  });
});
~~~

- [ ] **Step 2: Run the test, watch it fail**

Run: bun run --filter './apps/web' test useProgression
Expected: FAIL — cannot find module ./useProgression.

- [ ] **Step 3: Implement the composable**

~~~ts
import type {
  ContextResponse,
  DriverMetric,
  DriversResponse,
  PatternsResponse,
  TrendResponse,
} from "@hots-stats/shared-types";

/** How many work axes the hub surfaces (B1 section 3). */
export const WORK_AXES_LIMIT = 3;

/**
 * Picks the work axes shown at the top of the hub: only drivers whose win/loss
 * samples clear PROGRESSION_MIN_PER_SIDE, largest |effectSize| first. Pure and
 * deterministic, so the selection rule is unit-testable without a Nuxt runtime
 * (the fetch wiring lives in useProgression below).
 */
export function selectWorkAxes(drivers: DriverMetric[], limit: number = WORK_AXES_LIMIT): DriverMetric[] {
  return drivers
    .filter((driver) => driver.reliable)
    .sort((a, b) => {
      const magnitude = Math.abs(b.effectSize) - Math.abs(a.effectSize);
      if (magnitude !== 0) return magnitude;
      return a.key.localeCompare(b.key);
    })
    .slice(0, limit);
}

/**
 * One composable for the whole progression hub. useApiFetch bakes the active
 * game-mode and account selection into every request, and refreshes when the
 * reactive query changes (period / compareTo / tzOffsetMinutes).
 */
export function useProgression(query: ComputedRef<Record<string, unknown>>) {
  const trend = useApiFetch<TrendResponse>("/stats/trend", { query });
  const patterns = useApiFetch<PatternsResponse>("/stats/patterns", { query });
  const drivers = useApiFetch<DriversResponse>("/stats/drivers", { query });
  const context = useApiFetch<ContextResponse>("/stats/context", { query });
  return { trend, patterns, drivers, context };
}
~~~

- [ ] **Step 4: Run the test, watch it pass**

Run: bun run --filter './apps/web' test useProgression
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

~~~bash
git add apps/web/app/composables/useProgression.ts apps/web/app/composables/useProgression.test.ts
git commit -m "feat(web): add progression composable and work-axis selection (B1)"
~~~

---

### Task 5: Presentational components

**Files:** the four components under apps/web/app/components/progress/.

Design contract per component (implemented in the source appendix below):

- TrendChart.vue props: { trend?: TrendResponse | null; loading?: boolean; error?: boolean }. Renders a ChartLineChart of rolling winrate + a 50% reference line, a text summary, the patch-marker list, and an A/B comparison table when trend.comparison is present.
- WorkAxesCard.vue props: { drivers?: DriverMetric[]; matches?: number; insufficientSample?: boolean; loading?: boolean; error?: boolean }. Uses selectWorkAxes; when insufficientSample or no reliable axis, renders UiStateCard with the raw count, never a verdict.
- PatternTable.vue props: { aggregate?: PatternAggregate | null; loading?: boolean; error?: boolean }. UiDataTable of the recurrence rates with their n, plus a coverage line; below the gate a warning row shows "n < 20".
- ContextBreakdown.vue props: { context?: ContextResponse | null; loading?: boolean; error?: boolean }. Bar charts for hour / weekday / session size, compact tables for session rank / patch / team composition, a text summary beside every chart.

- [ ] **Step 1: Implement the four components** (verbatim source from the implementation commits; see the repository files).
- [ ] **Step 2: Typecheck:** bun run typecheck -> PASS.
- [ ] **Step 3: Commit**

~~~bash
git add apps/web/app/components/progress
git commit -m "feat(web): add progression charts, work axes, patterns and context (B1/C4)"
~~~

---

### Task 6: The /progress page + navigation

**Files:**
- Create: apps/web/app/pages/progress.vue
- Modify: apps/web/app/layouts/default.vue
- Modify: apps/web/app/pages/index.vue

The page: definePageMeta auth; useSeoMeta title "Progression" with robots "noindex, follow"; header with period UiPillTabs and UiStatsScopeToggle; four sections (TrendChart, WorkAxesCard, PatternTable, ContextBreakdown) and a links block to /analysis and /matches; tzOffsetMinutes set onMounted to -new Date().getTimezoneOffset(); query computed with from/compareTo/tzOffsetMinutes.

- [ ] **Step 1: Implement the page.**
- [ ] **Step 2: Add the nav entry** after /analysis, before /friends:

~~~ts
{ to: "/progress", label: "Progression", icon: "i-heroicons-arrow-trending-up" },
~~~

- [ ] **Step 3: Add the dashboard card** to progressCards in pages/index.vue:

~~~ts
{
  to: "/progress",
  icon: "i-heroicons-arrow-trending-up",
  title: "Progression",
  description: "Tendance, patterns récurrents et axes de travail sur tes parties.",
  color: "accent",
},
~~~

- [ ] **Step 4: Typecheck + web tests:** bun run typecheck && bun run --filter './apps/web' test -> PASS.
- [ ] **Step 5: Commit**

~~~bash
git add apps/web/app/pages/progress.vue apps/web/app/layouts/default.vue apps/web/app/pages/index.vue
git commit -m "feat(web): add the /progress hub page and nav entry (B1)"
~~~

---

### Task 7: Docs + final gate

- [ ] **Step 1:** Tick B1 and C4 in tasks/progression-roadmap.md with an "Écarts" note (personal-only scope; /carte-morts + /objectifs links omitted until C1/E2; DriverList.vue replaced by WorkAxesCard.vue; pure module instead of the spec context.service.test.ts).
- [ ] **Step 2:** Add one line per chantier to tasks/README.md "Déjà fait".
- [ ] **Step 3:** Full gate:

~~~bash
bun run typecheck
bun test packages/shared-types
bun test apps/api
bun run --filter './apps/web' test
~~~

Expected: all PASS. Push on main only if every command is green.
