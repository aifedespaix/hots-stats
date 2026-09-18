# A4 — Outcome drivers (`GET /stats/drivers`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /stats/drivers` returning, for each candidate metric, the conditional win/loss means, Cohen's d, both sample sizes and a reliability flag, computed strictly from recorded stats.

**Architecture:** One pure analysis module (`apps/api/src/lib/driver-analysis.ts`) owns the metric definitions, Cohen's d and the ordering; a thin DB service (`apps/api/src/services/drivers.service.ts`) scopes and assembles rows exactly like `patterns.service.ts`; the route reuses the existing session auth + `withStatsScope` chain and refuses `scope=global`.

**Tech Stack:** Bun, TypeScript, Hono, Drizzle ORM, Zod, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-09-18-player-progression-design.md` § A4.

## Global Constraints

- UI copy (labels, methodology) in French; identifiers and comments in English.
- Every personal query goes through `scopeConditions([], scope, matchPlayers.battletag)`; never `eq(matchPlayers.userId, ...)`.
- No invented data: no MMR/rank, no map objective timing, no simulated respawn timer. Every number traces to a recorded column or a shared, documented constant.
- One rule = one place: reuse the `coach-rules.ts` predicates and `RESPAWN_ESTIMATE_SECONDS`.
- `PROGRESSION_MIN_PER_SIDE = 10` is imported from `@hots-stats/shared-types`; never re-declared.
- No migration, no new dependency.
- `scope=global` is refused with 400 (same rule as `/patterns` and `/trend`).
- `DriverList.vue` is deferred to B1: no page consumes it yet, exactly as A2/A3 deferred their UI. Recorded in the roadmap.

## File structure

- Modify `packages/shared-types/src/stats.ts` — wire contracts `DriverMetric`, `DriversResponse`.
- Create `apps/api/src/lib/driver-analysis.ts` — pure metric definitions, `cohensD`, `computeDrivers`, `buildDriversResponse`.
- Create `apps/api/src/lib/driver-analysis.test.ts` — unit tests (the spec listed `services/drivers.service.test.ts`; the pure/DB split used by A1 and A3 is kept so tests run without `DATABASE_URL`).
- Create `apps/api/src/services/drivers.service.ts` — DB scoping and assembly.
- Modify `apps/api/src/routes/stats.ts` — add `GET /drivers`.
- Modify `tasks/progression-roadmap.md`, `tasks/README.md`.

---

### Task 1: Shared contracts + Cohen's d

**Files:**
- Modify: `packages/shared-types/src/stats.ts` (append after `TrendResponse`)
- Create: `apps/api/src/lib/driver-analysis.ts`
- Test: `apps/api/src/lib/driver-analysis.test.ts`

**Interfaces:**
- Produces: `DriverMetric`, `DriversResponse` (shared wire types)
- Produces: `cohensD(wins: number[], losses: number[]): number`
- Produces: `DRIVER_LEVEL_READ_SECONDS = 600`

- [ ] **Step 1: Add the shared wire contracts**

Append to `packages/shared-types/src/stats.ts`:

```ts
/** One metric's win-vs-loss contrast in the A4 outcome-driver analysis. */
export interface DriverMetric {
  key: string;
  /** French display label. */
  label: string;
  /** Direction in which the metric is "good" -- drives the colour, not the maths. */
  betterWhen: "higher" | "lower";
  meanInWins: number;
  meanInLosses: number;
  /** Cohen's d. Positive means the metric is higher in wins. */
  effectSize: number;
  winsSample: number;
  lossesSample: number;
  /** False when either side has fewer than PROGRESSION_MIN_PER_SIDE (10) matches. */
  reliable: boolean;
}

/** Outcome-driver response (A4). `drivers` never carries a metric whose source
 * data is entirely absent for the scope. */
export interface DriversResponse {
  scope: "personal" | "global";
  matches: number;
  /** Sorted by |effectSize| descending, reliable entries first. */
  drivers: DriverMetric[];
  methodology: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/lib/driver-analysis.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { cohensD } from "./driver-analysis";

describe("cohensD", () => {
  test("standardizes the win-minus-loss mean difference by the pooled deviation", () => {
    // wins mean 3 (var 2), losses mean 1 (var 2) -> pooled sd sqrt(2).
    expect(cohensD([2, 4], [0, 2])).toBeCloseTo(Math.SQRT2, 10);
  });

  test("returns 0 when both sides hold the same single value", () => {
    expect(cohensD([1, 1, 1], [1, 1, 1])).toBe(0);
  });

  test("keeps the direction of a perfectly separated zero-variance split", () => {
    expect(cohensD([0, 0, 0], [2, 2, 2])).toBeLessThan(0);
    expect(cohensD([2, 2, 2], [0, 0, 0])).toBeGreaterThan(0);
  });

  test("returns 0 when one side is empty", () => {
    expect(cohensD([1, 2, 3], [])).toBe(0);
    expect(cohensD([], [1, 2, 3])).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test apps/api/src/lib/driver-analysis.test.ts`
Expected: FAIL — `driver-analysis` cannot be resolved / `cohensD` not exported.

- [ ] **Step 4: Implement the minimal module**

Create `apps/api/src/lib/driver-analysis.ts`:

```ts
import { PROGRESSION_MIN_PER_SIDE, RESPAWN_ESTIMATE_SECONDS } from "@hots-stats/shared-types";
import type { DriverMetric, DriversResponse } from "@hots-stats/shared-types";

/** Seconds after gates open at which the "hero level at 10 min" metric is read. */
export const DRIVER_LEVEL_READ_SECONDS = 600;

function mean(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return values.length > 0 ? sum / values.length : 0;
}

function sampleVariance(values: number[], average: number): number {
  if (values.length < 2) return 0;
  let sumSquared = 0;
  for (const value of values) sumSquared += (value - average) ** 2;
  return sumSquared / (values.length - 1);
}

/**
 * Cohen's d for the win-minus-loss contrast: (meanWins - meanLosses) /
 * pooled standard deviation. Positive means the metric is higher in wins.
 *
 * A degenerate split (pooled variance zero) cannot be standardized, so the
 * sign of the raw difference is returned instead: a perfectly clean
 * separation still reads as an effect, an identical distribution on both
 * sides returns exactly 0, and one empty side returns 0. Never NaN or
 * Infinity.
 */
export function cohensD(wins: number[], losses: number[]): number {
  if (wins.length === 0 || losses.length === 0) return 0;
  const meanWins = mean(wins);
  const meanLosses = mean(losses);
  const pooledVariance =
    ((wins.length - 1) * sampleVariance(wins, meanWins) +
      (losses.length - 1) * sampleVariance(losses, meanLosses)) /
    (wins.length + losses.length - 2);
  if (!(pooledVariance > 0)) {
    if (meanWins === meanLosses) return 0;
    return meanWins > meanLosses ? 1 : -1;
  }
  return (meanWins - meanLosses) / Math.sqrt(pooledVariance);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test apps/api/src/lib/driver-analysis.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/src/stats.ts apps/api/src/lib/driver-analysis.ts apps/api/src/lib/driver-analysis.test.ts
git commit -m "feat(shared-types): add outcome-driver contracts (A4)"
```

---

### Task 2: `computeDrivers` and `buildDriversResponse`

**Files:**
- Modify: `apps/api/src/lib/driver-analysis.ts`
- Test: `apps/api/src/lib/driver-analysis.test.ts`

**Interfaces:**
- Consumes: `cohensD`, `PROGRESSION_MIN_PER_SIDE`, `RESPAWN_ESTIMATE_SECONDS`
- Produces: `DriverMatchInput`, `computeDrivers(matches: DriverMatchInput[]): DriverMetric[]`, `buildDriversResponse(matches, scope): DriversResponse`, `DRIVER_METHODOLOGY`, `DRIVER_LEVEL_READ_SECONDS`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/lib/driver-analysis.test.ts`:

```ts
import { buildDriversResponse, computeDrivers, type DriverMatchInput } from "./driver-analysis";

function match(overrides: Partial<DriverMatchInput> = {}): DriverMatchInput {
  return {
    matchId: "m",
    winner: true,
    durationSeconds: 1200,
    kills: 5,
    deaths: 2,
    assists: 5,
    heroDamage: 30_000,
    experienceContribution: 12_000,
    teamKills: 20,
    earlyDeaths: 0,
    firstDeath: false,
    outnumberedDeaths: 0,
    levelAt10Min: 10,
    ...overrides,
  };
}

function series(count: number, overrides: Partial<DriverMatchInput>): DriverMatchInput[] {
  return Array.from({ length: count }, (_, i) => match({ matchId: "m" + i, ...overrides }));
}

describe("computeDrivers", () => {
  test("AC1: a clean early-death split is a negative effect for a lower-is-better metric", () => {
    const matches = [...series(12, { winner: true, earlyDeaths: 0 }), ...series(12, { winner: false, earlyDeaths: 2 })];
    const earlyDeaths = computeDrivers(matches).find((d) => d.key === "earlyDeaths");
    expect(earlyDeaths).toBeDefined();
    expect(earlyDeaths!.betterWhen).toBe("lower");
    expect(earlyDeaths!.effectSize).toBeLessThan(0);
    expect(earlyDeaths!.meanInWins).toBe(0);
    expect(earlyDeaths!.meanInLosses).toBe(2);
  });

  test("AC2: a thin sample is flagged unreliable but still returned with its counts", () => {
    const matches = [...series(5, { winner: true }), ...series(5, { winner: false })];
    const earlyDeaths = computeDrivers(matches).find((d) => d.key === "earlyDeaths");
    expect(earlyDeaths!.reliable).toBe(false);
    expect(earlyDeaths!.winsSample).toBe(5);
    expect(earlyDeaths!.lossesSample).toBe(5);
  });

  test("AC3: an identical distribution on both sides reads 0, never NaN or Infinity", () => {
    const matches = [...series(10, { winner: true, earlyDeaths: 1 }), ...series(10, { winner: false, earlyDeaths: 1 })];
    const drivers = computeDrivers(matches);
    for (const driver of drivers) expect(Number.isFinite(driver.effectSize)).toBe(true);
    expect(drivers.find((d) => d.key === "earlyDeaths")!.effectSize).toBe(0);
  });

  test("AC5: a metric whose source data is absent is omitted, the others stay", () => {
    const matches = series(20, {
      levelAt10Min: null,
      earlyDeaths: null,
      firstDeath: null,
      outnumberedDeaths: null,
    });
    const keys = computeDrivers(matches).map((d) => d.key);
    expect(keys).not.toContain("avgHeroLevelAt10Min");
    expect(keys).not.toContain("earlyDeaths");
    expect(keys).not.toContain("firstDeath");
    expect(keys).not.toContain("outnumberedDeaths");
    expect(keys).toContain("deathsPer10Min");
  });

  test("sorts reliable entries before unreliable ones", () => {
    const matches = [
      ...series(10, { winner: true, earlyDeaths: 1, levelAt10Min: null }),
      ...series(10, { winner: false, earlyDeaths: 1, levelAt10Min: null }),
      ...series(3, { winner: true, earlyDeaths: 1, levelAt10Min: 20 }),
      ...series(3, { winner: false, earlyDeaths: 1, levelAt10Min: 5 }),
    ];
    const keys = computeDrivers(matches).map((d) => d.key);
    expect(keys.indexOf("earlyDeaths")).toBeLessThan(keys.indexOf("avgHeroLevelAt10Min"));
  });

  test("omits kill participation when no team kill total was recorded", () => {
    const matches = [...series(5, { winner: true, teamKills: 0 }), ...series(5, { winner: false, teamKills: 0 })];
    expect(computeDrivers(matches).map((d) => d.key)).not.toContain("killParticipation");
  });

  test("returns no drivers for an empty scope", () => {
    expect(computeDrivers([])).toEqual([]);
  });

  test("never emits NaN or Infinity on zero-duration matches", () => {
    const matches = [
      ...series(2, { winner: true, durationSeconds: 0 }),
      ...series(2, { winner: false, durationSeconds: 0 }),
    ];
    for (const driver of computeDrivers(matches)) expect(Number.isFinite(driver.effectSize)).toBe(true);
  });
});

describe("buildDriversResponse", () => {
  test("AC4: methodology names Cohen's d and the minimum sample, and counts the matches", () => {
    const response = buildDriversResponse(series(3, {}), "personal");
    expect(response.scope).toBe("personal");
    expect(response.matches).toBe(3);
    expect(response.methodology).toContain("Cohen");
    expect(response.methodology).toContain(String(PROGRESSION_MIN_PER_SIDE));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test apps/api/src/lib/driver-analysis.test.ts`
Expected: FAIL — `computeDrivers` / `buildDriversResponse` not exported.

- [ ] **Step 3: Implement the analysis**

Append to `apps/api/src/lib/driver-analysis.ts`:

```ts
/** One scope-resolved match's raw inputs for the A4 driver analysis. */
export interface DriverMatchInput {
  matchId: string;
  winner: boolean;
  durationSeconds: number;
  kills: number;
  deaths: number;
  assists: number;
  heroDamage: number;
  experienceContribution: number;
  /** Kills by every player on the subject's team, subject included. */
  teamKills: number;
  /** Subject deaths before EARLY_DEATH_BEFORE_SECONDS; null when the match has
   * no death log at all (never read as "zero early deaths"). */
  earlyDeaths: number | null;
  /** Whether the subject took the match's first death; null when no death log. */
  firstDeath: boolean | null;
  /** Subject deaths while outnumbered; null when no death log. */
  outnumberedDeaths: number | null;
  /** Subject's hero level at the 10-minute mark; null when unreadable or the
   * match ended before 10 minutes. */
  levelAt10Min: number | null;
}

interface DriverMetricDefinition {
  key: string;
  label: string;
  betterWhen: "higher" | "lower";
  /** null when this match cannot provide the metric. */
  value: (match: DriverMatchInput) => number | null;
}

function perMinute(total: number, durationSeconds: number): number | null {
  if (!(durationSeconds > 0)) return null;
  return total / (durationSeconds / 60);
}

function perTenMinutes(total: number, durationSeconds: number): number | null {
  if (!(durationSeconds > 0)) return null;
  return total / (durationSeconds / 600);
}

const DRIVER_METRICS: DriverMetricDefinition[] = [
  {
    key: "earlyDeaths",
    label: "Morts précoces (avant 5 min)",
    betterWhen: "lower",
    value: (match) => match.earlyDeaths,
  },
  {
    key: "deathsPer10Min",
    label: "Morts / 10 min",
    betterWhen: "lower",
    value: (match) => perTenMinutes(match.deaths, match.durationSeconds),
  },
  {
    key: "firstDeath",
    label: "Première mort de la partie",
    betterWhen: "lower",
    value: (match) => (match.firstDeath === null ? null : match.firstDeath ? 1 : 0),
  },
  {
    key: "outnumberedDeaths",
    label: "Morts en sous-nombre",
    betterWhen: "lower",
    value: (match) => match.outnumberedDeaths,
  },
  {
    key: "xpPerMinute",
    label: "XP / min",
    betterWhen: "higher",
    value: (match) => perMinute(match.experienceContribution, match.durationSeconds),
  },
  {
    key: "heroDamagePerMinute",
    label: "Dégâts héros / min",
    betterWhen: "higher",
    value: (match) => perMinute(match.heroDamage, match.durationSeconds),
  },
  {
    key: "killParticipation",
    label: "Participation aux éliminations",
    betterWhen: "higher",
    value: (match) => (match.teamKills > 0 ? (match.kills + match.assists) / match.teamKills : null),
  },
  {
    key: "timeDeadShare",
    // Estimated from the shared flat respawn constant, never a real timer.
    label: "Part du temps mort (estimation)",
    betterWhen: "lower",
    value: (match) =>
      match.durationSeconds > 0 ? (match.deaths * RESPAWN_ESTIMATE_SECONDS) / match.durationSeconds : null,
  },
  {
    key: "avgHeroLevelAt10Min",
    label: "Niveau de héros à 10 min",
    betterWhen: "higher",
    value: (match) => match.levelAt10Min,
  },
];

function sortDrivers(drivers: DriverMetric[]): DriverMetric[] {
  return [...drivers].sort((a, b) => {
    if (a.reliable !== b.reliable) return a.reliable ? -1 : 1;
    const magnitude = Math.abs(b.effectSize) - Math.abs(a.effectSize);
    if (magnitude !== 0) return magnitude;
    return a.key.localeCompare(b.key);
  });
}

/**
 * Splits every match's metric value into wins and losses and reports the
 * conditional means, Cohen's d and both sample sizes. A metric with no
 * readable value on either side is omitted (source data entirely absent),
 * never returned as a zero; a metric with data on only one side is returned
 * with the matching count and `reliable: false`.
 */
export function computeDrivers(matches: DriverMatchInput[]): DriverMetric[] {
  const drivers: DriverMetric[] = [];
  for (const definition of DRIVER_METRICS) {
    const winValues: number[] = [];
    const lossValues: number[] = [];
    for (const match of matches) {
      const value = definition.value(match);
      if (value === null || !Number.isFinite(value)) continue;
      if (match.winner) winValues.push(value);
      else lossValues.push(value);
    }
    if (winValues.length === 0 && lossValues.length === 0) continue;
    drivers.push({
      key: definition.key,
      label: definition.label,
      betterWhen: definition.betterWhen,
      meanInWins: mean(winValues),
      meanInLosses: mean(lossValues),
      effectSize: cohensD(winValues, lossValues),
      winsSample: winValues.length,
      lossesSample: lossValues.length,
      reliable:
        winValues.length >= PROGRESSION_MIN_PER_SIDE && lossValues.length >= PROGRESSION_MIN_PER_SIDE,
    });
  }
  return sortDrivers(drivers);
}

/** Honest description of the method, shown to the user. */
export const DRIVER_METHODOLOGY =
  "Cohen's d standardisé : écart des moyennes (victoires − défaites) divisé par l'écart-type regroupé des deux groupes. " +
  "Une entrée n'est fiable qu'à partir de " +
  PROGRESSION_MIN_PER_SIDE +
  " parties de chaque côté ; en dessous, seuls les comptes sont affichés. " +
  "Aucun modèle ajusté : chaque statistique est comparée seule, sans contrôle des autres facteurs.";

/** Full A4 response over an already scoped/filtered match set. */
export function buildDriversResponse(
  matches: DriverMatchInput[],
  scope: "personal" | "global",
): DriversResponse {
  return {
    scope,
    matches: matches.length,
    drivers: computeDrivers(matches),
    methodology: DRIVER_METHODOLOGY,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test apps/api/src/lib/driver-analysis.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/driver-analysis.ts apps/api/src/lib/driver-analysis.test.ts
git commit -m "feat(api): add pure outcome-driver analysis (A4)"
```

---

### Task 3: DB service `getDrivers`

**Files:**
- Create: `apps/api/src/services/drivers.service.ts`

**Interfaces:**
- Consumes: `buildDriversResponse`, `DriverMatchInput`, `DRIVER_LEVEL_READ_SECONDS`, `resolveSubject`, `scopeConditions`, the coach-rules predicates.
- Produces: `getDrivers(scope: Scope, filters: DriversFilters): Promise<DriversResponse>`, `DriversFilters`.

- [ ] **Step 1: Create the service**

Create `apps/api/src/services/drivers.service.ts`:

```ts
import { db, matchDeaths, matchLevelSnapshots, matchPlayers, matches } from "@hots-stats/db";
import {
  EARLY_DEATH_BEFORE_SECONDS,
  earlyDeathsCount,
  firstDeathCount,
  levelAt,
  outnumberedDeathsCount,
  type GameMode,
  type RuleDeath,
  type RuleLevelSnapshot,
  type RuleSubject,
} from "@hots-stats/shared-types";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { type Scope, scopeConditions } from "../lib/account-selection";
import {
  DRIVER_LEVEL_READ_SECONDS,
  buildDriversResponse,
  type DriverMatchInput,
} from "../lib/driver-analysis";
import { type RosterPlayer, resolveSubject } from "../lib/pattern-aggregate";

export interface DriversFilters {
  mode?: GameMode[];
  heroId?: string;
  mapId?: string;
  from?: string;
  to?: string;
}

/**
 * Builds the A4 outcome-driver response over every match the scope played,
 * optionally filtered by mode/hero/map/date. The subject of each match is
 * resolved with the same shared rule as A1/A3 (resolveSubject): the SQL
 * scopeCondition already restricts candidate rows to the caller's own
 * battletags, so another user's match can never be selected. This service
 * only scopes, filters and assembles raw rows -- the maths is pure (see
 * ../lib/driver-analysis.ts).
 */
export async function getDrivers(scope: Scope, filters: DriversFilters): Promise<DriversResponse> {
  const conditions = scopeConditions([], scope, matchPlayers.battletag);
  if (filters.mode && filters.mode.length > 0) conditions.push(inArray(matches.gameMode, filters.mode));
  if (filters.heroId) conditions.push(eq(matchPlayers.heroId, filters.heroId));
  if (filters.mapId) conditions.push(eq(matches.mapId, filters.mapId));
  if (filters.from) conditions.push(gte(matches.playedAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(matches.playedAt, new Date(filters.to)));

  const candidateRows = await db
    .select({
      matchId: matchPlayers.matchId,
      durationSeconds: matches.durationSeconds,
      battletag: matchPlayers.battletag,
      team: matchPlayers.team,
      kills: matchPlayers.kills,
      deaths: matchPlayers.deaths,
      assists: matchPlayers.assists,
      heroDamage: matchPlayers.heroDamage,
      experienceContribution: matchPlayers.experienceContribution,
      winner: matchPlayers.winner,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(matches.playedAt), asc(matchPlayers.matchId));

  if (candidateRows.length === 0) return buildDriversResponse([], scope.mode);

  const scopedBattletags = scope.mode === "personal" ? scope.battletags : [];

  const candidatesByMatch = new Map<string, typeof candidateRows>();
  for (const row of candidateRows) {
    const list = candidatesByMatch.get(row.matchId) ?? [];
    list.push(row);
    candidatesByMatch.set(row.matchId, list);
  }

  // One subject row per match: the scope's first account that played it.
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
  if (matchIds.length === 0) return buildDriversResponse([], scope.mode);

  // Full roster of those matches, not scope-filtered: kill participation needs
  // the subject's whole team, including teammates the scope does not own.
  const rosterRows = await db
    .select({
      matchId: matchPlayers.matchId,
      team: matchPlayers.team,
      kills: matchPlayers.kills,
    })
    .from(matchPlayers)
    .where(inArray(matchPlayers.matchId, matchIds));

  const teamKillsByMatch = new Map<string, number>();
  for (const row of rosterRows) {
    const subject = subjectsByMatch.get(row.matchId);
    if (!subject || row.team !== subject.team) continue;
    teamKillsByMatch.set(row.matchId, (teamKillsByMatch.get(row.matchId) ?? 0) + row.kills);
  }

  const deathRows = await db
    .select({
      matchId: matchPlayers.matchId,
      battletag: matchPlayers.battletag,
      team: matchPlayers.team,
      atSeconds: matchDeaths.atSeconds,
    })
    .from(matchDeaths)
    .innerJoin(matchPlayers, eq(matchPlayers.id, matchDeaths.matchPlayerId))
    .where(inArray(matchPlayers.matchId, matchIds));

  const deathsByMatch = new Map<string, RuleDeath[]>();
  for (const row of deathRows) {
    const list = deathsByMatch.get(row.matchId) ?? [];
    list.push({ battletag: row.battletag, team: row.team === 1 ? 1 : 0, atSeconds: row.atSeconds });
    deathsByMatch.set(row.matchId, list);
  }

  const levelRows = await db
    .select({
      matchId: matchPlayers.matchId,
      battletag: matchPlayers.battletag,
      atSeconds: matchLevelSnapshots.atSeconds,
      level: matchLevelSnapshots.level,
    })
    .from(matchLevelSnapshots)
    .innerJoin(matchPlayers, eq(matchPlayers.id, matchLevelSnapshots.matchPlayerId))
    .where(inArray(matchPlayers.matchId, matchIds));

  const levelsByMatch = new Map<string, RuleLevelSnapshot[]>();
  for (const row of levelRows) {
    const list = levelsByMatch.get(row.matchId) ?? [];
    list.push({ battletag: row.battletag, atSeconds: row.atSeconds, level: row.level });
    levelsByMatch.set(row.matchId, list);
  }

  const inputs: DriverMatchInput[] = [...subjectsByMatch.values()].map((row) => {
    const deaths = deathsByMatch.get(row.matchId) ?? [];
    const snapshots = levelsByMatch.get(row.matchId) ?? [];
    const subject: RuleSubject = {
      battletag: row.battletag,
      team: row.team === 1 ? 1 : 0,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
    };
    const first = firstDeathCount(deaths, subject);
    const early = earlyDeathsCount(deaths, subject, EARLY_DEATH_BEFORE_SECONDS, row.durationSeconds);
    const outnumbered = outnumberedDeathsCount(deaths, subject);
    return {
      matchId: row.matchId,
      winner: row.winner,
      durationSeconds: row.durationSeconds,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      heroDamage: row.heroDamage,
      experienceContribution: row.experienceContribution,
      teamKills: teamKillsByMatch.get(row.matchId) ?? 0,
      earlyDeaths: early.evaluated > 0 ? early.occurrences : null,
      firstDeath: deaths.length === 0 ? null : first.isFirst,
      outnumberedDeaths: deaths.length === 0 ? null : outnumbered.occurrences,
      levelAt10Min:
        row.durationSeconds < DRIVER_LEVEL_READ_SECONDS
          ? null
          : levelAt(snapshots, subject.battletag, DRIVER_LEVEL_READ_SECONDS),
    };
  });

  return buildDriversResponse(inputs, scope.mode);
}
```

- [ ] **Step 2: Typecheck the file**

Run: `bun run --filter './apps/api' typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/drivers.service.ts
git commit -m "feat(api): scope outcome-driver rows over the caller accounts (A4)"
```

---

### Task 4: `GET /stats/drivers` route

**Files:**
- Modify: `apps/api/src/routes/stats.ts`

**Interfaces:**
- Consumes: `getDrivers`, `withStatsScope`, `accountsQuerySchema`, `gameModeListSchema`, `heroStatsScopeSchema`.

- [ ] **Step 1: Add the imports and query schema**

In `apps/api/src/routes/stats.ts`, add `getDrivers` to the service imports:

```ts
import { getDrivers } from "../services/drivers.service";
```

and after `trendQuerySchema`:

```ts
const driversQuerySchema = z.object({
  scope: heroStatsScopeSchema.optional(),
  accounts: accountsQuerySchema,
  mode: gameModeListSchema.optional(),
  heroId: z.string().optional(),
  mapId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
```

- [ ] **Step 2: Add the route handler**

Append to the `statsRoute` chain:

```ts
  .get("/drivers", async (c) => {
    const parsed = driversQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    // "Which of my stats correlate with my wins?" has no coherent community
    // subject, so an explicit global scope is refused rather than faked (same
    // rule as /patterns and /trend). An omitted scope always falls back to the
    // caller's accounts.
    const scope = withStatsScope(c.get("scope"), parsed.data.scope ?? "personal");
    if (scope.mode === "global") {
      return c.json(
        { error: "Les facteurs de victoire ne sont disponibles que pour ton profil (scope=personal)." },
        400,
      );
    }

    return c.json(
      await getDrivers(scope, {
        mode: parsed.data.mode,
        heroId: parsed.data.heroId,
        mapId: parsed.data.mapId,
        from: parsed.data.from,
        to: parsed.data.to,
      }),
    );
  });
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/stats.ts
git commit -m "feat(api): expose GET /stats/drivers (A4)"
```

---

### Task 5: Documentation and full verification

**Files:**
- Modify: `tasks/progression-roadmap.md`, `tasks/README.md`

- [ ] **Step 1: Run every verification command**

```bash
bun run typecheck
bun test packages/shared-types
bun test apps/api
bun run --filter './apps/web' test
cd daemon-python && pytest -q
```

Expected: all pass. The daemon is untouched but the CI runs pytest.

- [ ] **Step 2: Tick A4 in the roadmap**

Change `- [ ] **A4 — Facteurs de victoire**` to `- [x]` and append a **Fait** block recording the deviations against the spec: pure module in `lib/driver-analysis.ts` (test split, like A1/A3), `scope=global` refused in 400, `teamCompHasHealer` omitted (C4 data not available yet), `DriverList.vue` deferred to B1, and `avgHeroLevelAt10Min` only read on matches >= 10 minutes.

- [ ] **Step 3: Add the one-line entry to `tasks/README.md`**

- [ ] **Step 4: Commit**

```bash
git add tasks/progression-roadmap.md tasks/README.md
git commit -m "docs(tasks): mark A4 outcome drivers done"
```

- [ ] **Step 5: Push only if the gate is fully green**

```bash
git push origin main
```
