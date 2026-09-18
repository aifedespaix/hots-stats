# A2 — Duration-normalized metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop presenting raw per-match totals as if they were comparable by attaching duration-weighted per-minute / per-10-minute rates to the four existing aggregate contracts (`/stats/summary`, `/heroes`, `/heroes/:heroId`, `/matches/dashboard`, plus the player profile's `ownStats.summary`).

**Architecture:** One shared contract (`NormalizedMetrics` in `packages/shared-types/src/stats.ts`) and one pure, DB-free helper (`normalizeMetrics` in `apps/api/src/services/metrics.service.ts`) own the entire rule: `sum(stat) / (sum(durationSeconds) / unit)`. Each existing Drizzle query that already produces a per-player aggregate gains the raw SUM columns it was missing; the service maps those sums through the helper. Existing fields and SQL expressions stay byte-identical — every change is an added column/field.

**Tech Stack:** TypeScript, bun:test (shared-types, api), vitest (web), Drizzle ORM, Hono, Zod.

**Spec:** `docs/superpowers/specs/2026-09-18-player-progression-design.md` (section "A2 — Duration-normalized metrics").

## Global Constraints

- French UI strings, English identifiers and comments.
- Never invent data: no MMR/rank, no objective captures, no simulated respawn timer. Every number here is a SUM of an already-recorded `match_players` field divided by an already-recorded `matches.durationSeconds` sum.
- Personal queries always go through `accountScope` / `scopeConditions`, never `eq(matchPlayers.userId, ...)`.
- Computation is a weighted rate, never an average of per-match ratios: a 5-minute game and a 30-minute game must not weigh the same.
- Zero-duration guard: no division by zero, every field reads `0` (never `NaN`/`Infinity`).
- Additive only: no migration, no dropped/renamed field. Existing fields keep their exact previous values.
- Tests live next to the code. Commands: `bun test packages/shared-types`; `bun test apps/api`; `bun run --filter './apps/web' test`; `bun run typecheck`.
- Scope of this chantier: backend contract + service wiring + web response types. No new page, no new endpoint, no UI component change (B1/B2 own the display).

## File Structure

- Modify `packages/shared-types/src/stats.ts` — add the `NormalizedMetrics` interface (already re-exported by `index.ts`).
- Create `apps/api/src/services/metrics.service.ts` — pure `normalizeMetrics` + `NormalizedMetricSums`, no DB import.
- Create `apps/api/src/services/metrics.service.test.ts` — weighting + zero-duration goldens.
- Modify `apps/api/src/services/stats.service.ts` — `StatsSummary.normalized` (covers `/stats/summary` and `ownStats.summary`).
- Modify `apps/api/src/services/talents.service.ts` — `HeroStatsRow.normalized` (covers `/heroes` and `/heroes/:heroId`).
- Modify `apps/api/src/routes/matches.ts` — `DashboardOverviewStats.normalized`.
- Modify `apps/web/app/types/matches.ts` — `StatsSummary` + `DashboardOverviewStats` gain `normalized`.
- Modify `apps/web/app/types/analytics.ts` — `HeroStats` gains `normalized`.
- Note: `apps/api/src/routes/heroes.ts` needs no edit — the service-attached field propagates through the existing `c.json({ heroes })` / `c.json({ hero, other, scope })`. Documented as a spec deviation.

---

### Task 1: Shared contract

**Files:**
- Modify: `packages/shared-types/src/stats.ts` (append at end)

**Interfaces:**
- Produces: `NormalizedMetrics` (`normalized` field added to every later aggregate).

- [ ] **Step 1: Append the contract to `packages/shared-types/src/stats.ts`**

```ts
/** Duration-weighted per-minute (and per-10-minute) rates. Every field is
 * computed as `sum(stat) / (sum(durationSeconds) / unit)` across the matches
 * in the aggregate -- a weighted rate, never an average of per-match ratios,
 * so a 5-minute game and a 30-minute game do not weigh the same. All fields
 * are 0 when the summed duration is not a positive number (empty scope, or
 * corrupt zero-duration rows), never NaN/Infinity. */
export interface NormalizedMetrics {
  xpPerMinute: number;
  heroDamagePerMinute: number;
  siegeDamagePerMinute: number;
  healingPerMinute: number;
  damageTakenPerMinute: number;
  deathsPer10Min: number;
  killsPer10Min: number;
  assistsPer10Min: number;
}
```

- [ ] **Step 2: Typecheck the package**

Run: `bun run --filter './packages/shared-types' typecheck`
Expected: PASS (interface is additive and unused so far).

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/stats.ts
git commit -m "feat(shared-types): add NormalizedMetrics contract (A2)"
```

---

### Task 2: Pure `normalizeMetrics` helper (TDD)

**Files:**
- Create: `apps/api/src/services/metrics.service.ts`
- Test: `apps/api/src/services/metrics.service.test.ts`

**Interfaces:**
- Consumes: `NormalizedMetrics` from Task 1.
- Produces:
  - `interface NormalizedMetricSums { durationSeconds: number; experienceContribution: number; heroDamage: number; siegeDamage: number; healing: number; damageTaken: number; kills: number; deaths: number; assists: number }`
  - `function normalizeMetrics(sums: NormalizedMetricSums): NormalizedMetrics`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { normalizeMetrics, type NormalizedMetricSums } from "./metrics.service";

const zeroSums: NormalizedMetricSums = {
  durationSeconds: 0,
  experienceContribution: 0,
  heroDamage: 0,
  siegeDamage: 0,
  healing: 0,
  damageTaken: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
};

describe("normalizeMetrics", () => {
  test("weights each match by its duration instead of averaging per-match ratios", () => {
    // 10 min / 60 XP (6 XP/min) + 30 min / 30 XP (1 XP/min).
    // Weighted: 90 XP / 40 min = 2.25. A naive average of ratios would be 3.5.
    const metrics = normalizeMetrics({
      ...zeroSums,
      durationSeconds: 600 + 1800,
      experienceContribution: 60 + 30,
    });
    expect(metrics.xpPerMinute).toBe(2.25);
  });

  test("reads exactly 1 xp/min for the spec's 600s/10 XP + 1800s/30 XP pair", () => {
    const metrics = normalizeMetrics({
      ...zeroSums,
      durationSeconds: 600 + 1800,
      experienceContribution: 10 + 30,
    });
    expect(metrics.xpPerMinute).toBe(1);
  });

  test("converts each damage/healing total to a per-minute rate", () => {
    const metrics = normalizeMetrics({
      ...zeroSums,
      durationSeconds: 1800, // 30 min
      heroDamage: 30_000,
      siegeDamage: 9_000,
      healing: 6_000,
      damageTaken: 15_000,
    });
    expect(metrics.heroDamagePerMinute).toBe(1000);
    expect(metrics.siegeDamagePerMinute).toBe(300);
    expect(metrics.healingPerMinute).toBe(200);
    expect(metrics.damageTakenPerMinute).toBe(500);
  });

  test("expresses kills, deaths and assists per 10 minutes", () => {
    const metrics = normalizeMetrics({
      ...zeroSums,
      durationSeconds: 1200, // 20 min
      kills: 10,
      deaths: 4,
      assists: 6,
    });
    expect(metrics.killsPer10Min).toBe(5);
    expect(metrics.deathsPer10Min).toBe(2);
    expect(metrics.assistsPer10Min).toBe(3);
  });

  test("returns all-zero rates when no duration was recorded", () => {
    const metrics = normalizeMetrics({
      ...zeroSums,
      experienceContribution: 10_000,
      heroDamage: 10_000,
      kills: 9,
    });
    expect(metrics).toEqual({
      xpPerMinute: 0,
      heroDamagePerMinute: 0,
      siegeDamagePerMinute: 0,
      healingPerMinute: 0,
      damageTakenPerMinute: 0,
      deathsPer10Min: 0,
      killsPer10Min: 0,
      assistsPer10Min: 0,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test apps/api/src/services/metrics.service.test.ts`
Expected: FAIL — `Cannot find module "./metrics.service"`.

- [ ] **Step 3: Write the minimal implementation**

```ts
import type { NormalizedMetrics } from "@hots-stats/shared-types";

/** Raw per-player-per-match SUMs a NormalizedMetrics bundle is derived from.
 * `durationSeconds` is the summed match duration, not one match's. */
export interface NormalizedMetricSums {
  durationSeconds: number;
  experienceContribution: number;
  heroDamage: number;
  siegeDamage: number;
  healing: number;
  damageTaken: number;
  kills: number;
  deaths: number;
  assists: number;
}

const ZERO_METRICS: NormalizedMetrics = {
  xpPerMinute: 0,
  heroDamagePerMinute: 0,
  siegeDamagePerMinute: 0,
  healingPerMinute: 0,
  damageTakenPerMinute: 0,
  deathsPer10Min: 0,
  killsPer10Min: 0,
  assistsPer10Min: 0,
};

/**
 * Duration-weighted rates: sum(stat) / (sum(durationSeconds) / unit). Never an
 * average of per-match ratios -- a 5-minute game and a 30-minute game must not
 * weigh the same. Falls back to all-zero metrics when the summed duration is
 * not a positive number, so an empty scope reads 0 instead of NaN/Infinity.
 */
export function normalizeMetrics(sums: NormalizedMetricSums): NormalizedMetrics {
  if (!(sums.durationSeconds > 0)) return { ...ZERO_METRICS };
  const minutes = sums.durationSeconds / 60;
  const tenMinutes = sums.durationSeconds / 600;
  return {
    xpPerMinute: sums.experienceContribution / minutes,
    heroDamagePerMinute: sums.heroDamage / minutes,
    siegeDamagePerMinute: sums.siegeDamage / minutes,
    healingPerMinute: sums.healing / minutes,
    damageTakenPerMinute: sums.damageTaken / minutes,
    deathsPer10Min: sums.deaths / tenMinutes,
    killsPer10Min: sums.kills / tenMinutes,
    assistsPer10Min: sums.assists / tenMinutes,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test apps/api/src/services/metrics.service.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/metrics.service.ts apps/api/src/services/metrics.service.test.ts
git commit -m "feat(api): add duration-weighted metrics helper (A2)"
```

---

### Task 3: Attach `normalized` to `GET /stats/summary`

**Files:**
- Modify: `apps/api/src/services/stats.service.ts`

**Interfaces:**
- Consumes: `normalizeMetrics`, `NormalizedMetrics`.
- Produces: `StatsSummary.normalized: NormalizedMetrics` (also serves the player profile's `ownStats.summary`).

- [ ] **Step 1: Import the helper and extend `StatsSummary`**

```ts
import { db, matchPlayers, matches } from "@hots-stats/db";
import type { GameMode, NormalizedMetrics } from "@hots-stats/shared-types";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type Scope, scopeConditions } from "../lib/account-selection";
import { normalizeMetrics } from "./metrics.service";

export interface StatsSummary {
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgDurationSeconds: number;
  /** Duration-weighted rates over the same filtered match set. Added by A2. */
  normalized: NormalizedMetrics;
}
```

- [ ] **Step 2: Add the nine SUM columns to the existing select**

Append these keys to the `.select({ ... })` in `getStatsSummary`, keeping the three existing keys untouched:

```ts
      durationSeconds: sql<number>`coalesce(sum(${matches.durationSeconds}), 0)::int`,
      experienceContribution: sql<number>`coalesce(sum(${matchPlayers.experienceContribution}), 0)::float`,
      heroDamage: sql<number>`coalesce(sum(${matchPlayers.heroDamage}), 0)::float`,
      siegeDamage: sql<number>`coalesce(sum(${matchPlayers.siegeDamage}), 0)::float`,
      healing: sql<number>`coalesce(sum(${matchPlayers.healing}), 0)::float`,
      damageTaken: sql<number>`coalesce(sum(${matchPlayers.damageTaken}), 0)::float`,
      kills: sql<number>`coalesce(sum(${matchPlayers.kills}), 0)::int`,
      deaths: sql<number>`coalesce(sum(${matchPlayers.deaths}), 0)::int`,
      assists: sql<number>`coalesce(sum(${matchPlayers.assists}), 0)::int`,
```

- [ ] **Step 3: Return the normalized bundle alongside the untouched existing fields**

```ts
  return {
    gamesPlayed,
    wins,
    winrate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
    avgDurationSeconds: row?.avgDurationSeconds ?? 0,
    normalized: normalizeMetrics({
      durationSeconds: row?.durationSeconds ?? 0,
      experienceContribution: row?.experienceContribution ?? 0,
      heroDamage: row?.heroDamage ?? 0,
      siegeDamage: row?.siegeDamage ?? 0,
      healing: row?.healing ?? 0,
      damageTaken: row?.damageTaken ?? 0,
      kills: row?.kills ?? 0,
      deaths: row?.deaths ?? 0,
      assists: row?.assists ?? 0,
    }),
  };
```

- [ ] **Step 4: Typecheck**

Run: `bun run --filter './apps/api' typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/stats.service.ts
git commit -m "feat(api): expose duration-normalized rates on /stats/summary (A2)"
```

---

### Task 4: Attach `normalized` to `/heroes` and `/heroes/:heroId`

**Files:**
- Modify: `apps/api/src/services/talents.service.ts`

**Interfaces:**
- Consumes: `normalizeMetrics`, `NormalizedMetrics`.
- Produces: `HeroStatsRow.normalized: NormalizedMetrics`.

- [ ] **Step 1: Import the helper and extend `HeroStatsRow`**

```ts
import { db, heroes, matchPlayers, matches, talentPicks } from "@hots-stats/db";
import type { GameMode, NormalizedMetrics, TalentTierStats } from "@hots-stats/shared-types";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type Scope, scopeConditions } from "../lib/account-selection";
import { normalizeMetrics } from "./metrics.service";

export interface HeroStatsRow {
  heroId: string;
  heroName: string;
  heroRole: string | null;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgKillParticipation: number;
  /** Duration-weighted rates over the same filtered match set. Added by A2. */
  normalized: NormalizedMetrics;
}
```

- [ ] **Step 2: Add the nine SUM columns to `heroStatsQuery`'s select**

Append the same nine keys as Task 3 to the `.select({ ... })` (grouped by hero, so each hero gets its own duration-weighted rates). Keep `avgKills`/`avgDeaths`/`avgAssists` and the team-kills join exactly as they are.

- [ ] **Step 3: Map the sums out of the row and into `normalized`**

Replace the bodies of `getHeroSummaries` and `getHeroSummary`:

```ts
export async function getHeroSummaries(
  scope: Scope,
  mode?: GameMode[],
  mapId?: string,
): Promise<HeroStatsRow[]> {
  const rows = await heroStatsQuery(scope, undefined, mode, mapId);
  return rows.map(toHeroStatsRow);
}

export async function getHeroSummary(
  scope: Scope,
  heroId: string,
  mode?: GameMode[],
): Promise<HeroStatsRow | null> {
  const rows = await heroStatsQuery(scope, heroId, mode);
  const row = rows[0];
  if (!row) return null;
  return toHeroStatsRow(row);
}

type HeroStatsQueryRow = Awaited<ReturnType<typeof heroStatsQuery>>[number];

/** Keeps the raw SUM columns out of the API response -- only the derived
 * weighted rates are exposed. */
function toHeroStatsRow(row: HeroStatsQueryRow): HeroStatsRow {
  const {
    durationSeconds,
    experienceContribution,
    heroDamage,
    siegeDamage,
    healing,
    damageTaken,
    kills,
    deaths,
    assists,
    ...hero
  } = row;
  return {
    ...hero,
    winrate: hero.gamesPlayed > 0 ? hero.wins / hero.gamesPlayed : 0,
    normalized: normalizeMetrics({
      durationSeconds,
      experienceContribution,
      heroDamage,
      siegeDamage,
      healing,
      damageTaken,
      kills,
      deaths,
      assists,
    }),
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `bun run --filter './apps/api' typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/talents.service.ts
git commit -m "feat(api): expose duration-normalized rates per hero (A2)"
```

---

### Task 5: Attach `normalized` to `GET /matches/dashboard`

**Files:**
- Modify: `apps/api/src/routes/matches.ts` (dashboard handler, around the `overviewRows` select and the `c.json` assembly)

**Interfaces:**
- Consumes: `normalizeMetrics`.
- Produces: `overview.normalized` in the dashboard response.

- [ ] **Step 1: Import the helper at the top of `matches.ts`**

Add to the existing service imports:

```ts
import { normalizeMetrics } from "../services/metrics.service";
```

- [ ] **Step 2: Add the nine SUM columns to the `overviewRows` select**

Append them to the `.select({ ... })` that currently yields `gamesPlayed`/`wins`/`avgKills`/`avgDeaths`/`avgAssists` (same aliases as Task 3).

- [ ] **Step 3: Extend the fallback and add `normalized` to the overview**

```ts
    const overview = overviewRows[0] ?? {
      gamesPlayed: 0,
      wins: 0,
      avgKills: 0,
      avgDeaths: 0,
      avgAssists: 0,
      durationSeconds: 0,
      experienceContribution: 0,
      heroDamage: 0,
      siegeDamage: 0,
      healing: 0,
      damageTaken: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
    };
```

Then inside the returned `overview: { ... }` object, after `kda`, append:

```ts
        normalized: normalizeMetrics({
          durationSeconds: overview.durationSeconds,
          experienceContribution: overview.experienceContribution,
          heroDamage: overview.heroDamage,
          siegeDamage: overview.siegeDamage,
          healing: overview.healing,
          damageTaken: overview.damageTaken,
          kills: overview.kills,
          deaths: overview.deaths,
          assists: overview.assists,
        }),
```

- [ ] **Step 4: Typecheck**

Run: `bun run --filter './apps/api' typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/matches.ts
git commit -m "feat(api): expose duration-normalized rates on /matches/dashboard (A2)"
```

---

### Task 6: Web response types

**Files:**
- Modify: `apps/web/app/types/matches.ts`
- Modify: `apps/web/app/types/analytics.ts`

**Interfaces:**
- Consumes: `NormalizedMetrics` from `@hots-stats/shared-types`.

- [ ] **Step 1: `apps/web/app/types/matches.ts`**

Extend the existing top import and both interfaces:

```ts
import type { GameMode, NormalizedMetrics } from "@hots-stats/shared-types";
```

```ts
export interface StatsSummary {
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgDurationSeconds: number;
  normalized: NormalizedMetrics;
}
```

```ts
export interface DashboardOverviewStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winrate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  kda: number | null;
  normalized: NormalizedMetrics;
}
```

- [ ] **Step 2: `apps/web/app/types/analytics.ts`**

Extend the shared-types import and `HeroStats`:

```ts
import type {
  HeroMatchupEntry,
  HeroStatsScope,
  NormalizedMetrics,
  PlayerEncounterStats,
  TalentTierStats,
} from "@hots-stats/shared-types";
```

```ts
export interface HeroStats {
  heroId: string;
  heroName: string;
  heroRole: string | null;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgKillParticipation: number;
  normalized: NormalizedMetrics;
}
```

- [ ] **Step 3: Typecheck the web app**

Run: `bun run --filter './apps/web' typecheck`
Expected: PASS (no component builds a `StatsSummary`/`HeroStats` literal).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/types/matches.ts apps/web/app/types/analytics.ts
git commit -m "feat(web): type duration-normalized rates in API responses (A2)"
```

---

### Task 7: Full verification and docs

**Files:**
- Modify: `tasks/progression-roadmap.md`
- Modify: `tasks/README.md`

- [ ] **Step 1: Run the full gate**

```bash
bun run typecheck
bun test packages/shared-types
bun test apps/api
bun run --filter './apps/web' test
```

Expected: all PASS. Run `cd daemon-python && pytest -q` only if the daemon was touched (it is not).

- [ ] **Step 2: Mark A2 done in `tasks/progression-roadmap.md` and add the one-line entry to `tasks/README.md`**

- [ ] **Step 3: Commit the docs**

```bash
git add tasks/progression-roadmap.md tasks/README.md
git commit -m "docs(tasks): mark A2 duration-normalized metrics done"
```
