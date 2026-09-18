# A3 — Rolling trend + period comparison (GET /stats/trend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add GET /stats/trend — a chronological per-match series with duration-weighted rolling winrate / KDA / deaths-per-10-min (window 20 by default), in-series patch markers, and an optional A/B period comparison split at a caller-supplied boundary.

**Architecture:** The rolling/period computation is one pure, DB-free module (apps/api/src/lib/trend-series.ts) so it is unit-testable without DATABASE_URL. A thin DB service (apps/api/src/services/trend.service.ts) scopes each match to the caller's own account row (reusing the shared resolveSubject rule from A1), filters, and hands ordered rows to the pure module. The route lives on the existing session-authenticated statsRoute. Shared contracts live in packages/shared-types/src/stats.ts.

**Tech Stack:** TypeScript, bun:test (shared-types, api), Drizzle ORM, Hono, Zod.

**Spec:** docs/superpowers/specs/2026-09-18-player-progression-design.md (section "A3 — Rolling trend + period comparison").

## Global Constraints

- French UI strings, English identifiers and comments.
- Never invent data: every number is a recorded match_players/matches field (kills, deaths, assists, experienceContribution, durationSeconds, winner, gameVersion). No MMR/rank, no objective timer.
- Personal queries always go through accountScope / scopeConditions, never eq(matchPlayers.userId, ...).
- Rates are duration-weighted (sum(stat) / (sum(durationSeconds) / unit)), never an average of per-match ratios — reuse normalizeMetrics (A2) for the per-minute / per-10-minute rates.
- Zero-duration guard: every rate reads 0, never NaN/Infinity. KDA reads null when the window/period has zero deaths (no manufactured Infinity).
- Additive only: no migration, no dropped/renamed field. Existing GET /matches/trend is untouched.
- Tests live next to the code. Commands: bun test packages/shared-types; bun test apps/api; bun run --filter './apps/web' test; bun run typecheck.
- Scope of this chantier: data contract + endpoint + pure series tests. No page, no UI component (B1 owns /progress and its TrendChart).
- Spec deviation (documented at commit): the spec's A3 file list also names apps/web/app/composables/useProgressionTrend.ts and apps/web/app/components/progress/TrendChart.vue. Those are display-layer artifacts with no consumer until B1's /progress page and no A3 acceptance criterion; they are deferred to B1, exactly as A2 deferred its display to B1/B2.

## File Structure

- Modify packages/shared-types/src/stats.ts — TrendPoint, PeriodStats, TrendResponse, DEFAULT_TREND_WINDOW.
- Create apps/api/src/lib/trend-series.ts — pure rolling series, period stats, version changes, comparison.
- Create apps/api/src/lib/trend-series.test.ts — goldens for all of the above.
- Create apps/api/src/services/trend.service.ts — DB scoping/filtering/assembly.
- Modify apps/api/src/routes/stats.ts — GET /stats/trend.
- Modify tasks/progression-roadmap.md, tasks/README.md — done markers.

---

### Task 1: Shared contracts

**Files:**
- Modify: packages/shared-types/src/stats.ts (append at end)

**Interfaces:**
- Produces: DEFAULT_TREND_WINDOW (20), TrendPoint, PeriodStats, TrendResponse.

- [ ] **Step 1: Append the contracts to packages/shared-types/src/stats.ts**

    /** Default rolling window (in games) for the A3 trend series. Shared so the
     * API default and the web's later chart/legend cannot disagree. */
    export const DEFAULT_TREND_WINDOW = 20;

    /** One match's point on the rolling trend (A3). */
    export interface TrendPoint {
      matchId: string;
      playedAt: string;
      winner: boolean;
      /** 1-based index within the returned series. */
      index: number;
      /** Rolling winrate over the last window games; null before it fills. */
      rollingWinrate: number | null;
      rollingKda: number | null;
      rollingDeathsPer10Min: number | null;
      gameVersion: string | null;
    }

    /** Duration-weighted aggregate over one period of the series (A3). kda is
     * null when the period has no death -- never Infinity. */
    export interface PeriodStats {
      gamesPlayed: number;
      winrate: number;
      kda: number | null;
      deathsPer10Min: number;
      xpPerMinute: number;
    }

    /** Rolling trend response (A3). comparison is present only when the caller
     * passed compareTo; versionChanges marks every known gameVersion change. */
    export interface TrendResponse {
      window: number;
      points: TrendPoint[];
      comparison?: { label: string; from: string; to: string; stats: PeriodStats }[];
      versionChanges: Array<{ atIndex: number; gameVersion: string; playedAt: string }>;
    }

- [ ] **Step 2: Typecheck the package**

Run: bun run --filter './packages/shared-types' typecheck
Expected: PASS (interfaces are additive).

- [ ] **Step 3: Commit**

    git add packages/shared-types/src/stats.ts
    git commit -m "feat(shared-types): add trend series contracts (A3)"

---

### Task 2: Pure trend series (TDD)

**Files:**
- Create: apps/api/src/lib/trend-series.ts
- Test: apps/api/src/lib/trend-series.test.ts

**Interfaces:**
- Consumes: TrendPoint, PeriodStats, TrendResponse, DEFAULT_TREND_WINDOW from Task 1; normalizeMetrics from ../services/metrics.service.
- Produces:
    export interface TrendMatchInput { matchId: string; playedAt: string; winner: boolean; durationSeconds: number; kills: number; deaths: number; assists: number; experienceContribution: number; gameVersion: string | null; }
    export interface TrendOptions { window: number; compareTo?: string; }
    export function computePeriodStats(matches: TrendMatchInput[]): PeriodStats;
    export function buildTrendSeries(matches: TrendMatchInput[], window: number): TrendPoint[];
    export function buildVersionChanges(points: TrendPoint[]): TrendResponse["versionChanges"];
    export function buildComparison(matches: TrendMatchInput[], compareTo: string): NonNullable<TrendResponse["comparison"]>;
    export function buildTrendResponse(matches: TrendMatchInput[], options: TrendOptions): TrendResponse;

- [ ] **Step 1: Write the failing tests (apps/api/src/lib/trend-series.test.ts)**

    import { describe, expect, test } from "bun:test";
    import {
      buildTrendResponse,
      buildTrendSeries,
      buildVersionChanges,
      computePeriodStats,
      type TrendMatchInput,
    } from "./trend-series";

    function match(
      overrides: Partial<TrendMatchInput> & { matchId: string; playedAt: string },
    ): TrendMatchInput {
      return {
        winner: false,
        durationSeconds: 1200,
        kills: 0,
        deaths: 0,
        assists: 0,
        experienceContribution: 0,
        gameVersion: "2.55.0.1",
        ...overrides,
      };
    }

    /** 25 chronological matches: 1..10 wins, 11..25 losses. */
    function winThenLossSeries(): TrendMatchInput[] {
      return Array.from({ length: 25 }, (_, i) => {
        const index = i + 1;
        return match({
          matchId: "m" + String(index).padStart(2, "0"),
          playedAt: new Date(Date.UTC(2026, 0, index)).toISOString(),
          winner: index <= 10,
          kills: 4,
          deaths: 2,
          assists: 6,
        });
      });
    }

    describe("buildTrendSeries", () => {
      test("leaves rolling metrics null until the window fills, then uses the exact trailing window", () => {
        const points = buildTrendSeries(winThenLossSeries(), 20);
        expect(points).toHaveLength(25);
        for (let i = 0; i < 19; i++) {
          expect(points[i]!.rollingWinrate).toBeNull();
          expect(points[i]!.rollingKda).toBeNull();
          expect(points[i]!.rollingDeathsPer10Min).toBeNull();
        }
        // Point 20: trailing window = games 1..20 -> 10 wins / 20 = 0.5.
        expect(points[19]!.rollingWinrate).toBe(0.5);
        expect(points[19]!.rollingKda).toBe(5);
        expect(points[19]!.rollingDeathsPer10Min).toBe(1);
        // Point 25: trailing window = games 6..25 -> wins 6..10 = 5 / 20 = 0.25.
        expect(points[24]!.rollingWinrate).toBe(0.25);
      });

      test("numbers points 1-based and contiguous in chronological order even when input is shuffled", () => {
        const series = winThenLossSeries();
        const shuffled = [series[4]!, series[0]!, series[24]!, ...series.slice(1, 4), ...series.slice(5, 24)];
        const points = buildTrendSeries(shuffled, 20);
        expect(points.map((p) => p.index)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
        expect(points.map((p) => p.matchId)).toEqual(series.map((m) => m.matchId));
      });

      test("returns an empty series for no matches", () => {
        expect(buildTrendSeries([], 20)).toEqual([]);
      });

      test("a full window with zero deaths reports null KDA, never Infinity", () => {
        const series = Array.from({ length: 20 }, (_, i) =>
          match({ matchId: "m" + i, playedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString() }),
        );
        const points = buildTrendSeries(series, 20);
        expect(points[19]!.rollingKda).toBeNull();
        expect(points[19]!.rollingWinrate).toBe(0);
        expect(points[19]!.rollingDeathsPer10Min).toBe(0);
      });
    });

    describe("computePeriodStats", () => {
      test("weights per-minute rates by summed duration, not per-match ratios", () => {
        const stats = computePeriodStats([
          match({ matchId: "a", playedAt: "2026-01-01T00:00:00.000Z", durationSeconds: 600, experienceContribution: 10 }),
          match({ matchId: "b", playedAt: "2026-01-02T00:00:00.000Z", durationSeconds: 1800, experienceContribution: 30 }),
        ]);
        expect(stats.gamesPlayed).toBe(2);
        expect(stats.xpPerMinute).toBe(1);
        expect(stats.deathsPer10Min).toBe(0);
      });

      test("reports null KDA with no death and zero rates for zero duration", () => {
        const stats = computePeriodStats([
          match({ matchId: "a", playedAt: "2026-01-01T00:00:00.000Z", durationSeconds: 0, kills: 5, assists: 5 }),
        ]);
        expect(stats.kda).toBeNull();
        expect(stats.deathsPer10Min).toBe(0);
        expect(stats.xpPerMinute).toBe(0);
      });

      test("reads zeroes for an empty period", () => {
        expect(computePeriodStats([])).toEqual({
          gamesPlayed: 0,
          winrate: 0,
          kda: null,
          deathsPer10Min: 0,
          xpPerMinute: 0,
        });
      });
    });

    describe("buildVersionChanges", () => {
      test("emits one marker per known version change at the first match of the new version", () => {
        const points = buildTrendSeries(
          [
            match({ matchId: "m1", playedAt: "2026-01-01T00:00:00.000Z", gameVersion: "2.55.0" }),
            match({ matchId: "m2", playedAt: "2026-01-02T00:00:00.000Z", gameVersion: "2.55.0" }),
            match({ matchId: "m3", playedAt: "2026-01-03T00:00:00.000Z", gameVersion: "2.55.1" }),
            match({ matchId: "m4", playedAt: "2026-01-04T00:00:00.000Z", gameVersion: null }),
            match({ matchId: "m5", playedAt: "2026-01-05T00:00:00.000Z", gameVersion: "2.55.1" }),
            match({ matchId: "m6", playedAt: "2026-01-06T00:00:00.000Z", gameVersion: "2.56.0" }),
          ],
          20,
        );
        expect(buildVersionChanges(points)).toEqual([
          { atIndex: 3, gameVersion: "2.55.1", playedAt: "2026-01-03T00:00:00.000Z" },
          { atIndex: 6, gameVersion: "2.56.0", playedAt: "2026-01-06T00:00:00.000Z" },
        ]);
      });

      test("does not emit for a single known version nor duplicate one across an unknown gap", () => {
        const points = buildTrendSeries(
          [
            match({ matchId: "m1", playedAt: "2026-01-01T00:00:00.000Z", gameVersion: null }),
            match({ matchId: "m2", playedAt: "2026-01-02T00:00:00.000Z", gameVersion: "2.55.0" }),
            match({ matchId: "m3", playedAt: "2026-01-03T00:00:00.000Z", gameVersion: "2.55.0" }),
          ],
          20,
        );
        expect(buildVersionChanges(points)).toEqual([]);
      });
    });

    describe("buildTrendResponse", () => {
      test("omits comparison unless compareTo is passed", () => {
        const response = buildTrendResponse(winThenLossSeries(), { window: 20 });
        expect(response.window).toBe(20);
        expect(response.points).toHaveLength(25);
        expect(response.comparison).toBeUndefined();
      });

      test("splits at compareTo and computes each period over its own matches only", () => {
        const series = Array.from({ length: 10 }, (_, i) => {
          const index = i + 1;
          return match({
            matchId: "m" + index,
            playedAt: new Date(Date.UTC(2026, 0, index)).toISOString(),
            winner: index <= 5,
            durationSeconds: 600,
            experienceContribution: index <= 5 ? 10 : 20,
          });
        });
        const response = buildTrendResponse(series, { window: 20, compareTo: "2026-01-06T00:00:00.000Z" });
        expect(response.comparison).toHaveLength(2);
        const [previous, current] = response.comparison!;
        expect(previous).toEqual({
          label: "Période précédente",
          from: "2026-01-01T00:00:00.000Z",
          to: "2026-01-06T00:00:00.000Z",
          stats: { gamesPlayed: 5, winrate: 1, kda: null, deathsPer10Min: 0, xpPerMinute: 1 },
        });
        expect(current).toEqual({
          label: "Période actuelle",
          from: "2026-01-06T00:00:00.000Z",
          to: "2026-01-10T00:00:00.000Z",
          stats: { gamesPlayed: 5, winrate: 0, kda: null, deathsPer10Min: 0, xpPerMinute: 2 },
        });
      });
    });

- [ ] **Step 2: Run the tests to verify they fail**

Run: bun test apps/api/src/lib/trend-series.test.ts
Expected: FAIL — Cannot find module "./trend-series".

- [ ] **Step 3: Implement apps/api/src/lib/trend-series.ts**

    import type { PeriodStats, TrendPoint, TrendResponse } from "@hots-stats/shared-types";
    import { normalizeMetrics } from "../services/metrics.service";

    /** One scope-resolved match feeding the rolling trend (A3). */
    export interface TrendMatchInput {
      matchId: string;
      /** ISO datetime. */
      playedAt: string;
      winner: boolean;
      durationSeconds: number;
      kills: number;
      deaths: number;
      assists: number;
      experienceContribution: number;
      gameVersion: string | null;
    }

    export interface TrendOptions {
      window: number;
      compareTo?: string;
    }

    function chronological(matches: TrendMatchInput[]): TrendMatchInput[] {
      return [...matches].sort(
        (a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt) || a.matchId.localeCompare(b.matchId),
      );
    }

    /**
     * Duration-weighted stats over one match set (A3): sum(stat) /
     * (sum(duration)/unit), never an average of per-match ratios. Reuses the A2
     * normalizeMetrics rule for the per-minute / per-10-minute rates. KDA is
     * null (never Infinity) when the set has no death; every rate is 0 when the
     * summed duration is not positive.
     */
    export function computePeriodStats(matches: TrendMatchInput[]): PeriodStats {
      let durationSeconds = 0;
      let wins = 0;
      let kills = 0;
      let deaths = 0;
      let assists = 0;
      let experienceContribution = 0;
      for (const entry of matches) {
        durationSeconds += entry.durationSeconds;
        if (entry.winner) wins += 1;
        kills += entry.kills;
        deaths += entry.deaths;
        assists += entry.assists;
        experienceContribution += entry.experienceContribution;
      }
      const normalized = normalizeMetrics({
        durationSeconds,
        experienceContribution,
        heroDamage: 0,
        siegeDamage: 0,
        healing: 0,
        damageTaken: 0,
        kills,
        deaths,
        assists,
      });
      return {
        gamesPlayed: matches.length,
        winrate: matches.length > 0 ? wins / matches.length : 0,
        kda: deaths > 0 ? (kills + assists) / deaths : null,
        deathsPer10Min: normalized.deathsPer10Min,
        xpPerMinute: normalized.xpPerMinute,
      };
    }

    /**
     * Builds the chronological series. All three rolling fields stay null until
     * the trailing window holds window games; afterwards they describe exactly
     * the last window games ending at that point (index 1-based).
     */
    export function buildTrendSeries(matches: TrendMatchInput[], window: number): TrendPoint[] {
      const ordered = chronological(matches);
      return ordered.map((entry, i) => {
        const filled = i + 1 >= window;
        let rollingWinrate: number | null = null;
        let rollingKda: number | null = null;
        let rollingDeathsPer10Min: number | null = null;
        if (filled) {
          const stats = computePeriodStats(ordered.slice(i + 1 - window, i + 1));
          rollingWinrate = stats.winrate;
          rollingKda = stats.kda;
          rollingDeathsPer10Min = stats.deathsPer10Min;
        }
        return {
          matchId: entry.matchId,
          playedAt: entry.playedAt,
          winner: entry.winner,
          index: i + 1,
          rollingWinrate,
          rollingKda,
          rollingDeathsPer10Min,
          gameVersion: entry.gameVersion,
        };
      });
    }

    /**
     * One marker per known gameVersion change, at the first match of the new
     * version. Unknown (null) versions carry no marker (the wire type is a
     * non-null string), and an unknown gap never duplicates the following
     * version's marker.
     */
    export function buildVersionChanges(points: TrendPoint[]): TrendResponse["versionChanges"] {
      const changes: TrendResponse["versionChanges"] = [];
      let lastKnown: string | null = null;
      for (const point of points) {
        if (point.gameVersion === null) continue;
        if (lastKnown !== null && point.gameVersion !== lastKnown) {
          changes.push({ atIndex: point.index, gameVersion: point.gameVersion, playedAt: point.playedAt });
        }
        lastKnown = point.gameVersion;
      }
      return changes;
    }

    /**
     * Splits the series at compareTo into two contiguous periods, each
     * aggregate computed over its own matches alone.
     */
    export function buildComparison(
      matches: TrendMatchInput[],
      compareTo: string,
    ): NonNullable<TrendResponse["comparison"]> {
      const boundary = Date.parse(compareTo);
      const ordered = chronological(matches);
      const previous = ordered.filter((entry) => Date.parse(entry.playedAt) < boundary);
      const current = ordered.filter((entry) => Date.parse(entry.playedAt) >= boundary);
      return [
        {
          label: "Période précédente",
          from: previous[0]?.playedAt ?? compareTo,
          to: compareTo,
          stats: computePeriodStats(previous),
        },
        {
          label: "Période actuelle",
          from: compareTo,
          to: current[current.length - 1]?.playedAt ?? compareTo,
          stats: computePeriodStats(current),
        },
      ];
    }

    /** Full A3 response: series + patch markers + optional A/B comparison. */
    export function buildTrendResponse(matches: TrendMatchInput[], options: TrendOptions): TrendResponse {
      const points = buildTrendSeries(matches, options.window);
      const response: TrendResponse = {
        window: options.window,
        points,
        versionChanges: buildVersionChanges(points),
      };
      if (options.compareTo) response.comparison = buildComparison(matches, options.compareTo);
      return response;
    }

- [ ] **Step 4: Run the tests to verify they pass**

Run: bun test apps/api/src/lib/trend-series.test.ts
Expected: PASS.

- [ ] **Step 5: Commit**

    git add apps/api/src/lib/trend-series.ts apps/api/src/lib/trend-series.test.ts
    git commit -m "feat(api): add pure rolling-trend series module (A3)"

---

### Task 3: Trend service and route

**Files:**
- Create: apps/api/src/services/trend.service.ts
- Modify: apps/api/src/routes/stats.ts

**Interfaces:**
- Consumes: buildTrendResponse / TrendMatchInput (Task 2); resolveSubject / RosterPlayer from ../lib/pattern-aggregate; Scope/scopeConditions from ../lib/account-selection; TrendResponse from shared-types.
- Produces: getTrend(scope: Scope, filters: TrendFilters): Promise<TrendResponse>; GET /stats/trend.

- [ ] **Step 1: Implement apps/api/src/services/trend.service.ts**

    import { db, matchPlayers, matches } from "@hots-stats/db";
    import { UNKNOWN_GAME_VERSION, type GameMode, type TrendResponse } from "@hots-stats/shared-types";
    import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
    import { type Scope, scopeConditions } from "../lib/account-selection";
    import { type RosterPlayer, resolveSubject } from "../lib/pattern-aggregate";
    import { buildTrendResponse, type TrendMatchInput } from "../lib/trend-series";

    export interface TrendFilters {
      mode?: GameMode[];
      heroId?: string;
      mapId?: string;
      from?: string;
      to?: string;
      gameVersion?: string[];
      window: number;
      compareTo?: string;
    }

    /**
     * Builds the A3 rolling trend over every match the scope played, optionally
     * filtered by mode/hero/map/date/gameVersion. The subject of each match is
     * resolved with the same shared rule as A1 (resolveSubject): the SQL
     * scopeCondition already restricts candidate rows to the caller's own
     * battletags, so another user's match can never be selected. This service
     * only scopes, filters and orders rows -- the rolling math is pure (see
     * ../lib/trend-series.ts).
     */
    export async function getTrend(scope: Scope, filters: TrendFilters): Promise<TrendResponse> {
      const conditions = scopeConditions([], scope, matchPlayers.battletag);
      if (filters.mode && filters.mode.length > 0) conditions.push(inArray(matches.gameMode, filters.mode));
      if (filters.heroId) conditions.push(eq(matchPlayers.heroId, filters.heroId));
      if (filters.mapId) conditions.push(eq(matches.mapId, filters.mapId));
      if (filters.from) conditions.push(gte(matches.playedAt, new Date(filters.from)));
      if (filters.to) conditions.push(lte(matches.playedAt, new Date(filters.to)));
      if (filters.gameVersion && filters.gameVersion.length > 0) {
        const knownVersions = filters.gameVersion.filter((version) => version !== UNKNOWN_GAME_VERSION);
        const versionConditions = [
          ...(knownVersions.length > 0 ? [inArray(matches.gameVersion, knownVersions)] : []),
          ...(filters.gameVersion.includes(UNKNOWN_GAME_VERSION) ? [isNull(matches.gameVersion)] : []),
        ];
        // Never empty: gameVersionListSchema validates a non-empty list which
        // splits into exactly these two buckets.
        conditions.push(or(...versionConditions)!);
      }

      const rows = await db
        .select({
          matchId: matchPlayers.matchId,
          playedAt: matches.playedAt,
          durationSeconds: matches.durationSeconds,
          gameVersion: matches.gameVersion,
          battletag: matchPlayers.battletag,
          team: matchPlayers.team,
          kills: matchPlayers.kills,
          deaths: matchPlayers.deaths,
          assists: matchPlayers.assists,
          winner: matchPlayers.winner,
          experienceContribution: matchPlayers.experienceContribution,
        })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(asc(matches.playedAt), asc(matchPlayers.matchId));

      const candidatesByMatch = new Map<string, typeof rows>();
      for (const row of rows) {
        const list = candidatesByMatch.get(row.matchId) ?? [];
        list.push(row);
        candidatesByMatch.set(row.matchId, list);
      }

      const scopedBattletags = scope.mode === "personal" ? scope.battletags : [];
      const inputs: TrendMatchInput[] = [];
      for (const candidates of candidatesByMatch.values()) {
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
        if (!row) continue;
        inputs.push({
          matchId: row.matchId,
          playedAt: row.playedAt.toISOString(),
          winner: row.winner,
          durationSeconds: row.durationSeconds,
          kills: row.kills,
          deaths: row.deaths,
          assists: row.assists,
          experienceContribution: row.experienceContribution,
          gameVersion: row.gameVersion,
        });
      }

      return buildTrendResponse(inputs, { window: filters.window, compareTo: filters.compareTo });
    }

- [ ] **Step 2: Add GET /trend to apps/api/src/routes/stats.ts**

Merge gameVersionListSchema into the existing ../lib/query import, add the two new imports, then the schema and handler:

    import { gameModeListSchema, gameVersionListSchema } from "../lib/query";
    import { getTrend } from "../services/trend.service";
    import { DEFAULT_TREND_WINDOW } from "@hots-stats/shared-types";

    const trendQuerySchema = z.object({
      scope: heroStatsScopeSchema.optional(),
      accounts: accountsQuerySchema,
      mode: gameModeListSchema.optional(),
      heroId: z.string().optional(),
      mapId: z.string().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      gameVersion: gameVersionListSchema.optional(),
      window: z.coerce.number().int().min(1).max(200).default(DEFAULT_TREND_WINDOW),
      compareTo: z.string().datetime().optional(),
    });

    .get("/trend", async (c) => {
      const parsed = trendQuerySchema.safeParse(c.req.query());
      if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

      // "Am I improving?" only has a coherent subject when it is the caller's
      // own player row; a community-wide trend has no subject row to roll up,
      // so an explicit global scope is refused rather than faked (same rule as
      // /patterns). An omitted scope always falls back to the caller's accounts.
      const scope = withStatsScope(c.get("scope"), parsed.data.scope ?? "personal");
      if (scope.mode === "global") {
        return c.json(
          { error: "La tendance n'est disponible que pour ton profil (scope=personal)." },
          400,
        );
      }

      return c.json(await getTrend(scope, parsed.data));
    });

- [ ] **Step 3: Typecheck the API**

Run: bun run --filter './apps/api' typecheck
Expected: PASS.

- [ ] **Step 4: Run the API test suite**

Run: bun test apps/api
Expected: PASS (35 prior tests + the new trend-series tests).

- [ ] **Step 5: Commit**

    git add apps/api/src/services/trend.service.ts apps/api/src/routes/stats.ts
    git commit -m "feat(api): add GET /stats/trend rolling series (A3)"
---

### Task 4: Full verification and documentation

**Files:**
- Modify: tasks/progression-roadmap.md
- Modify: tasks/README.md

- [ ] **Step 1: Run the full gate**

    bun run typecheck
    bun test packages/shared-types
    bun test apps/api
    bun run --filter './apps/web' test

Expected: all PASS. The daemon is untouched, so pytest is not run.

- [ ] **Step 2: Tick A3 in tasks/progression-roadmap.md and record deviations**

Record: (a) pure math lives in apps/api/src/lib/trend-series.ts (db-free) so it is testable without DATABASE_URL, with the test at trend-series.test.ts instead of the spec's services/trend.service.test.ts; (b) scope=global is refused in 400 (no coherent subject row for a community trend), same rule as /patterns; (c) the spec's web files (useProgressionTrend.ts, TrendChart.vue) are deferred to B1, which owns /progress and is the only consumer; (d) rollingKda / PeriodStats.kda read null when the window/period has zero deaths, never Infinity; (e) versionChanges marks only known (non-null) gameVersion changes so an unknown gap never duplicates a marker.

- [ ] **Step 3: Add one line to the "Déjà fait" section of tasks/README.md**

- [ ] **Step 4: Commit the docs**

    git add tasks/progression-roadmap.md tasks/README.md
    git commit -m "docs(tasks): mark A3 rolling trend done"

- [ ] **Step 5: Push only if the gate is fully green**

Push only if Step 1 is entirely green, no new dependency was added and nothing doubts. Otherwise leave the commits local and report the blocker.

## Self-Review

- Spec coverage: TrendPoint/PeriodStats/TrendResponse types -> Task 1; rolling series + index + versionChanges -> Task 2; comparison only when compareTo -> Task 2; endpoint + scope/filters -> Task 3; criterion 1 (null before window-1, exact trailing winrate) -> Task 2 test 1; criterion 2 (chronological, contiguous index) -> Task 2 test 2; criterion 3 (one marker per change) -> Task 2 versionChanges tests; criterion 4 (comparison + per-period stats) -> Task 2 response test; criterion 5 (existing /matches/trend untouched) -> no edit to matches.ts, verified by the full suite.
- Placeholders: none; each step names the exact file, function and expected result.
- Type consistency: TrendMatchInput/PeriodStats/TrendPoint/TrendResponse defined once; buildTrendResponse consumed by the service; DEFAULT_TREND_WINDOW shared by the route default.



