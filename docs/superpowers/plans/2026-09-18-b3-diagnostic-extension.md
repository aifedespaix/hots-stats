# B3 — Diagnostic Page Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the A1 combat-pattern aggregate and the A4 outcome drivers into the
`/analysis` ("Diagnostic") page above the existing leaks/strengths, and delete the
now-pointless "Winrate par carte" stub card.

**Architecture:** UI-only chantier. The API endpoints (`GET /stats/patterns`,
`GET /stats/drivers`) already exist and are consumed by the `/progress` hub. B3 adds
a compact drivers-list component that shares its formatting/colour rules with the hub's
`WorkAxesCard` (one rule = one place), wires both progression fetches into `/analysis`
with an explicit ranked-only mode override, and removes the stub card. No API, DB or
migration change.

**Tech Stack:** Nuxt 4 / Vue 3 `<script setup>`, Nuxt UI, Pinia, TypeScript,
`@hots-stats/shared-types` contracts, Vitest for pure logic.

**Spec:** `docs/superpowers/specs/2026-09-18-player-progression-design.md` § B3
(lines 503-515). Roadmap brief: `tasks/progression-roadmap.md` (B3 entry).

## Global Constraints

- UI strings in French, identifiers and comments in English (repo rule).
- No new dependency, no hardcoded URL, no secret.
- No new API route, no DB migration: B3 is purely additive on the web side.
- Every personal request goes through `useApiFetch` (which bakes the account scope);
  never call `fetch` directly, never pass `userId`.
- The Diagnostic page is ranked-only end to end (`apps/api/src/services/weaknesses.service.ts`
  hardcodes `DRAFT_RANKED_MODES`). `/stats/patterns` and `/stats/drivers` must therefore
  be requested with the same explicit ranked `mode` override already used by the
  `/matches/trend` call on that page, so the global game-mode header filter can never
  mix casual modes into the diagnostic.
- Every aggregate shows its `n`; below the gate, show the count, never a verdict.
- Loading/empty/error states use `UiStateCard`.
- "One rule = one place": the driver value formatting/colour rule and the ranked-mode
  query live in exactly one module each.
- Verification commands (gate):
  - `bun run --filter './apps/web' test`
  - `bun run typecheck`
  - (CI also runs `bun run build`; optional locally)

---

### Task 1: Shared driver display rules

**Files:**
- Create: `apps/web/app/utils/driverDisplay.ts`
- Create: `apps/web/app/utils/driverDisplay.test.ts`
- Modify: `apps/web/app/components/progress/WorkAxesCard.vue`

**Interfaces:**
- Consumes: `DriverMetric` from `@hots-stats/shared-types`; `formatPercent` from
  `~/composables/useFormat`; `Tone` from `~/utils/tone`.
- Produces:
  - `formatDriverMetric(key: string, value: number): string`
  - `driverTone(driver: DriverMetric): Tone`
  - `interface DriverRow { key; label; valueInWins; valueInLosses; effect; sample; tone; reliable }`
  - `buildDriverRows(drivers: DriverMetric[]): DriverRow[]`

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/utils/driverDisplay.test.ts`:

```ts
import type { DriverMetric } from "@hots-stats/shared-types";
import { describe, expect, test } from "vitest";
import { buildDriverRows, driverTone, formatDriverMetric } from "./driverDisplay";

function driver(overrides: Partial<DriverMetric>): DriverMetric {
  return {
    key: "deathsPer10Min",
    label: "Morts / 10 min",
    betterWhen: "lower",
    meanInWins: 4,
    meanInLosses: 7,
    effectSize: -1.2,
    winsSample: 20,
    lossesSample: 20,
    reliable: true,
    ...overrides,
  };
}

describe("formatDriverMetric", () => {
  test("renders 0-1 share metrics as a percentage", () => {
    expect(formatDriverMetric("timeDeadShare", 0.123)).toBe("12%");
    expect(formatDriverMetric("firstDeath", 0.5)).toBe("50%");
  });

  test("renders every other metric on its own two-decimal scale", () => {
    expect(formatDriverMetric("deathsPer10Min", 3.456)).toBe("3.46");
    expect(formatDriverMetric("xpPerMinute", 512)).toBe("512.00");
  });
});

describe("driverTone", () => {
  test("is success when wins sit on the metric's good side", () => {
    expect(driverTone(driver({ betterWhen: "lower", meanInWins: 4, meanInLosses: 7 }))).toBe("success");
    expect(driverTone(driver({ betterWhen: "higher", meanInWins: 600, meanInLosses: 420 }))).toBe("success");
  });

  test("is danger when wins sit on the metric's bad side", () => {
    expect(driverTone(driver({ betterWhen: "lower", meanInWins: 7, meanInLosses: 4 }))).toBe("danger");
    expect(driverTone(driver({ betterWhen: "higher", meanInWins: 420, meanInLosses: 600 }))).toBe("danger");
  });

  test("is muted when the sample is not reliable or the means are equal", () => {
    expect(driverTone(driver({ reliable: false }))).toBe("default");
    expect(driverTone(driver({ meanInWins: 5, meanInLosses: 5 }))).toBe("default");
  });
});

describe("buildDriverRows", () => {
  test("keeps the API order and formats every cell", () => {
    const rows = buildDriverRows([
      driver({
        key: "firstDeath",
        label: "Première mort",
        betterWhen: "lower",
        meanInWins: 0.2,
        meanInLosses: 0.6,
        effectSize: -0.83,
        winsSample: 31,
        lossesSample: 24,
      }),
      driver({
        key: "xpPerMinute",
        label: "XP / min",
        betterWhen: "higher",
        meanInWins: 612.4,
        meanInLosses: 540.2,
        effectSize: 0.61,
        winsSample: 31,
        lossesSample: 24,
      }),
    ]);

    expect(rows.map((row) => row.key)).toEqual(["firstDeath", "xpPerMinute"]);
    expect(rows[0]).toMatchObject({
      label: "Première mort",
      valueInWins: "20%",
      valueInLosses: "60%",
      effect: "-0.83",
      sample: "31 V / 24 D",
      tone: "success",
      reliable: true,
    });
    expect(rows[1]).toMatchObject({ valueInWins: "612.40", effect: "+0.61" });
  });

  test("never renders a signed zero effect", () => {
    const rows = buildDriverRows([driver({ effectSize: -0.001 })]);
    expect(rows[0]?.effect).toBe("0.00");
  });

  test("returns an empty list for no drivers", () => {
    expect(buildDriverRows([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter './apps/web' test app/utils/driverDisplay.test.ts`
Expected: FAIL — "Cannot find module './driverDisplay'" (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/app/utils/driverDisplay.ts`:

```ts
import type { DriverMetric } from "@hots-stats/shared-types";
import { formatPercent } from "~/composables/useFormat";
import type { Tone } from "~/utils/tone";

/**
 * A4 metrics that are 0-1 shares/rates and render as a percentage; every other
 * metric keeps its own scale, two decimals. The Diagnostic drivers list and the
 * hub's work-axes card both read this, so the two can never disagree.
 */
const PERCENT_KEYS = new Set(["firstDeath", "timeDeadShare"]);

export function formatDriverMetric(key: string, value: number): string {
  return PERCENT_KEYS.has(key) ? formatPercent(value) : value.toFixed(2);
}

/**
 * Colour of one driver row: the metric's good side is `betterWhen`, so the
 * win/loss gap is only green when wins actually sit on that side. Unreliable
 * entries (either side under PROGRESSION_MIN_PER_SIDE) and exact ties are muted
 * -- the number is always shown, never turned into a verdict.
 */
export function driverTone(driver: DriverMetric): Tone {
  if (!driver.reliable) return "default";
  const gap = driver.meanInWins - driver.meanInLosses;
  if (gap === 0) return "default";
  const favourable = driver.betterWhen === "higher" ? gap > 0 : gap < 0;
  return favourable ? "success" : "danger";
}

/** One display row of the Diagnostic drivers list (B3). */
export interface DriverRow {
  key: string;
  label: string;
  valueInWins: string;
  valueInLosses: string;
  effect: string;
  sample: string;
  tone: Tone;
  reliable: boolean;
}

function formatEffectSize(effectSize: number): string {
  const value = Number(effectSize.toFixed(2));
  return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

/** Maps the API-sorted A4 drivers to display rows, preserving the API order. */
export function buildDriverRows(drivers: DriverMetric[]): DriverRow[] {
  return drivers.map((driver) => ({
    key: driver.key,
    label: driver.label,
    valueInWins: formatDriverMetric(driver.key, driver.meanInWins),
    valueInLosses: formatDriverMetric(driver.key, driver.meanInLosses),
    effect: formatEffectSize(driver.effectSize),
    sample: `${driver.winsSample} V / ${driver.lossesSample} D`,
    tone: driverTone(driver),
    reliable: driver.reliable,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter './apps/web' test app/utils/driverDisplay.test.ts`
Expected: PASS (3 describe blocks, 6 tests).

- [ ] **Step 5: Point WorkAxesCard at the shared rule**

In `apps/web/app/components/progress/WorkAxesCard.vue`, add the import and delete the
local `formatMetric` function so the percent/two-decimal rule is not duplicated:

```ts
import { PROGRESSION_MIN_MATCHES, type DriverMetric } from "@hots-stats/shared-types";
import { selectWorkAxes } from "~/composables/useProgression";
import { formatDriverMetric } from "~/utils/driverDisplay";
```

Delete these lines:

```ts
function formatMetric(key: string, value: number): string {
  if (key === "timeDeadShare" || key === "firstDeath") return formatPercent(value);
  return value.toFixed(2);
}
```

Replace the two template calls `formatMetric(axis.key, ...)` with
`formatDriverMetric(axis.key, ...)`.

- [ ] **Step 6: Run the web test suite and typecheck**

Run: `bun run --filter './apps/web' test`
Expected: PASS (all existing tests plus the new `driverDisplay` ones).
Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/utils/driverDisplay.ts apps/web/app/utils/driverDisplay.test.ts apps/web/app/components/progress/WorkAxesCard.vue
git commit -m "feat(web): share the progression driver display rules (B3)"
```

---

### Task 2: Diagnostic driver list component

**Files:**
- Create: `apps/web/app/components/progress/DriverList.vue`

**Interfaces:**
- Consumes: `DriverMetric` / `PROGRESSION_MIN_PER_SIDE` from `@hots-stats/shared-types`;
  `buildDriverRows` / `DriverRow` from `~/utils/driverDisplay`; `Tone` / `TONE_TEXT_CLASS`
  from `~/utils/tone`; auto-imported `UiPanel`, `UiStateCard`, `UiDataTable`.
- Produces: `ProgressDriverList` — a `UiPanel` with `drivers`, `matches`, `loading`, `error` props.

- [ ] **Step 1: Create the component**

Create `apps/web/app/components/progress/DriverList.vue`:

```vue
<script setup lang="ts">
import { PROGRESSION_MIN_PER_SIDE, type DriverMetric } from "@hots-stats/shared-types";
import { buildDriverRows } from "~/utils/driverDisplay";
import { TONE_TEXT_CLASS, type Tone } from "~/utils/tone";

const props = withDefaults(
  defineProps<{
    drivers?: DriverMetric[];
    matches?: number;
    loading?: boolean;
    error?: boolean;
  }>(),
  { drivers: () => [], matches: 0, loading: false, error: false },
);

/** Columns match the A4 method: conditional means, Cohen's d, and both n. */
const columns = [
  { key: "label", label: "Métrique" },
  { key: "valueInWins", label: "En victoire", numeric: true },
  { key: "valueInLosses", label: "En défaite", numeric: true },
  { key: "effect", label: "Effet (d)", numeric: true },
  { key: "sample", label: "n (V / D)", numeric: true },
];

const rows = computed(() => buildDriverRows(props.drivers));
const isEmpty = computed(() => !props.loading && !props.error && rows.value.length === 0);
const hasReliable = computed(() => rows.value.some((row) => row.reliable));
</script>

<template>
  <UiPanel title="Ce qui sépare tes victoires de tes défaites" :count="matches">
    <UiStateCard v-if="loading" state="loading" size="sm" />
    <UiStateCard
      v-else-if="error"
      state="error"
      size="sm"
      message="Impossible de charger les facteurs de victoire."
    />
    <UiStateCard
      v-else-if="isEmpty"
      state="empty"
      size="sm"
      message="Aucune métrique exploitable pour cette période."
    />
    <div v-else class="space-y-3">
      <p
        v-if="!hasReliable"
        class="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted"
      >
        Moins de {{ PROGRESSION_MIN_PER_SIDE }} parties d'un côté ou de l'autre : les chiffres restent
        affichés, mais aucun écart n'est concluant.
      </p>

      <UiDataTable
        :columns="columns"
        :rows="rows"
        row-key="key"
        mobile-primary-key="label"
        mobile-badge-key="sample"
      >
        <template #cell-effect="{ row }">
          <span :class="TONE_TEXT_CLASS[row.tone as Tone]">{{ row.effect }}</span>
        </template>
      </UiDataTable>

      <p class="text-xs text-muted">
        d de Cohen : écart des moyennes victoires/défaites divisé par l'écart-type regroupé. Un effet
        fiable demande au moins {{ PROGRESSION_MIN_PER_SIDE }} parties de chaque côté.
      </p>
    </div>
  </UiPanel>
</template>
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors attributable to `DriverList.vue`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/progress/DriverList.vue
git commit -m "feat(web): add the Diagnostic drivers list component (B3)"
```

---

### Task 3: Wire patterns + drivers into `/analysis` and drop the stub card

**Files:**
- Modify: `apps/web/app/composables/useProgression.ts`
- Modify: `apps/web/app/composables/useProgression.test.ts`
- Modify: `apps/web/app/pages/analysis/index.vue`

**Interfaces:**
- Consumes: `ProgressPatternTable` (existing), `ProgressDriverList` (Task 2),
  `PatternsResponse` / `DriversResponse` (`@hots-stats/shared-types`).
- Produces: `rankedModeQuery(): { mode: string }` in `~/composables/useProgression`.

- [ ] **Step 1: Write the failing test for the ranked-only query**

Append to `apps/web/app/composables/useProgression.test.ts` (add the import and the
describe block):

```ts
import { rankedModeQuery, selectWorkAxes } from "./useProgression";
```

```ts
describe("rankedModeQuery", () => {
  test("covers exactly the ranked draft modes and no casual one", () => {
    const modes = rankedModeQuery().mode.split(",");
    expect(modes).toEqual(["UnrankedDraft", "HeroLeague", "TeamLeague", "StormLeague"]);
    expect(modes).not.toContain("QuickMatch");
    expect(modes).not.toContain("ARAM");
    expect(modes).not.toContain("Brawl");
    expect(modes).not.toContain("Custom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter './apps/web' test app/composables/useProgression.test.ts`
Expected: FAIL — `rankedModeQuery` is not exported.

- [ ] **Step 3: Implement the helper**

In `apps/web/app/composables/useProgression.ts`, import the value and add the helper:

```ts
import {
  DRAFT_RANKED_MODES,
  type ContextResponse,
  type DriverMetric,
  type DriversResponse,
  type PatternsResponse,
  type TrendResponse,
} from "@hots-stats/shared-types";

/**
 * The Diagnostic page (`/analysis`) is ranked-only end to end: it overrides the
 * global game-mode header filter with this exact `mode` query for every
 * progression endpoint it calls (patterns/drivers/trend). One place, so a future
 * caller cannot half-apply the rule.
 */
export function rankedModeQuery(): { mode: string } {
  return { mode: DRAFT_RANKED_MODES.join(",") };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter './apps/web' test app/composables/useProgression.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the page**

Edit `apps/web/app/pages/analysis/index.vue`.

Replace the shared-types import (line 2) so it becomes:

```ts
import {
  DRAFT_MIN_RANKED_GAMES_FOR_RANKING,
  type DriversResponse,
  type PatternsResponse,
} from "@hots-stats/shared-types";
```

Add the composable import next to the existing type imports:

```ts
import { rankedModeQuery } from "~/composables/useProgression";
```

Replace the `/matches/trend` call's inline mode with the shared helper:

```ts
const { data: trendData } = await useApiFetch<{ points: TrendPoint[] }>("/matches/trend", {
  query: rankedModeQuery(),
});
```

Add, right after the `trendData` declaration:

```ts
// B3: fold A1 (patterns) and A4 (drivers) into the Diagnostic. Both are
// personal-only endpoints, fetched with the same ranked override as the trend
// above -- the page never follows the global game-mode header filter. Neither is
// awaited, so the base /weaknesses + /matches/trend load is unchanged; the two
// panels render their own loading state.
const { data: patterns, pending: patternsPending, error: patternsError } = useApiFetch<PatternsResponse>(
  "/stats/patterns",
  { query: rankedModeQuery() },
);
const { data: drivers, pending: driversPending, error: driversError } = useApiFetch<DriversResponse>(
  "/stats/drivers",
  { query: rankedModeQuery() },
);
```

In the template, insert the two panels immediately after the header `</div>` and
before the leaks/strengths grid:

```vue
    <!-- B3: recurring combat patterns (A1) and win/loss drivers (A4), ranked-only
    like the rest of the page. Kept above the leaks/strengths synthesis so the
    Diagnostic reads as the full picture. -->
    <ProgressPatternTable
      :aggregate="patterns?.aggregate ?? null"
      :loading="patternsPending"
      :error="Boolean(patternsError)"
    />

    <ProgressDriverList
      :drivers="drivers?.drivers ?? []"
      :matches="drivers?.matches ?? 0"
      :loading="driversPending"
      :error="Boolean(driversError)"
    />
```

Delete the whole stub card block:

```vue
    <!-- Winrate par carte now lives on its own page (Hub des cartes), with the meta,
    l'historique et l'impact d'équipe qui n'ont pas leur place dans ce diagnostic compact. -->
    <NuxtLink
      to="/maps"
      class="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-brand/40"
    >
      <div class="flex items-center gap-2">
        <UIcon name="i-heroicons-map" class="h-5 w-5 text-brand" />
        <div>
          <p class="text-sm font-medium">Winrate par carte</p>
          <p class="text-xs text-muted">Déplacé vers le Hub des cartes -- méta, ton historique et l'impact d'équipe</p>
        </div>
      </div>
      <UIcon name="i-heroicons-arrow-right" class="h-4 w-4 shrink-0 text-muted" />
    </NuxtLink>
```

Update the SEO description strings (lines 10-14) so the page no longer advertises
"winrate par carte" as its content:

```ts
  description:
    "Tes patterns de combat récurrents, ce qui sépare tes victoires de tes défaites, tes matchups défavorables et tes talents sous-performants sur tes parties classées.",
  ogDescription:
    "Tes patterns de combat récurrents, ce qui sépare tes victoires de tes défaites, tes matchups défavorables et tes talents sous-performants sur tes parties classées.",
```

- [ ] **Step 6: Verify the stub is gone and `/maps` stays reachable**

Run: `git grep -n "Déplacé vers le Hub des cartes" -- apps/web`
Expected: no output.

Run: `git grep -n 'to: "/maps"' -- apps/web/app/pages/index.vue`
Expected: one hit — `/maps` is still a card in the Dashboard's nav card grid, so
removing the stub loses no navigation (the sidebar lists it on `md` and up too).

- [ ] **Step 7: Typecheck, tests, build**

Run: `bun run typecheck`
Expected: no errors.
Run: `bun run --filter './apps/web' test`
Expected: PASS.
Run: `bun run build`
Expected: build succeeds (catches any template/auto-import regression the typechecker
cannot see).

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/composables/useProgression.ts apps/web/app/composables/useProgression.test.ts apps/web/app/pages/analysis/index.vue
git commit -m "feat(web): surface patterns and drivers on the Diagnostic page (B3)"
```

---

### Task 4: Tracker docs and repo-wide gate

**Files:**
- Modify: `tasks/progression-roadmap.md`
- Modify: `tasks/README.md`
- Create: `docs/superpowers/plans/2026-09-18-b3-diagnostic-extension.md` (this plan)

- [ ] **Step 1: Check B3 off in the roadmap**

Replace `- [ ] **B3 — Extension de `/analysis`** · dépend de A1, A4` … (3 lines) with a
checked entry plus a factual "Fait" note listing:

- `DriverList.vue` created (A4's deferred component): all drivers, reliable first as
  returned by the API, `n` per side, Cohen's `d`, muted when unreliable.
- Display rules `formatDriverMetric` / `driverTone` / `buildDriverRows` extracted to
  `apps/web/app/utils/driverDisplay.ts` and shared with `WorkAxesCard.vue`.
- `rankedModeQuery()` in `useProgression.ts` single-sources the ranked-only override,
  now used by `/stats/patterns`, `/stats/drivers` and `/matches/trend`.
- Stub card deleted; `/maps` was already in the Dashboard nav card grid (and the
  sidebar), so criterion 1 needed no nav change.
- No API/DB/migration change.

- [ ] **Step 2: Add the one-line "Déjà fait" entry**

Append to `tasks/README.md`'s "Déjà fait" list, in the same style as the other
"Suite Progression" bullets:

```markdown
- **Suite Progression — B3 (extension du Diagnostic)** : `/analysis` intègre
  désormais le tableau des patterns (A1) et la liste des facteurs de victoire (A4)
  au-dessus des points faibles/forts ; carte-stub « Winrate par carte » supprimée
  (`/maps` reste accessible par la grille du Dashboard et la sidebar) ; règles
  d'affichage des drivers partagées avec `WorkAxesCard` via
  `apps/web/app/utils/driverDisplay.ts`, mode classé unique via
  `rankedModeQuery()`. Aucun changement d'API ni de migration.
```

- [ ] **Step 3: Run the full gate**

Run, in order:

```bash
bun run --filter './apps/web' test
bun run typecheck
bun run build
```

Expected: all green. (`packages/shared-types`, `apps/api` and `daemon-python` are not
touched by B3, so their suites are unchanged; run them anyway if anything unexpected
surfaces.)

- [ ] **Step 4: Commit the docs**

```bash
git add docs/superpowers/plans/2026-09-18-b3-diagnostic-extension.md tasks/progression-roadmap.md tasks/README.md
git commit -m "docs(tasks): add the B3 plan and mark it done"
```

- [ ] **Step 5: Push (only if every gate above is green)**

```bash
git push origin main
```

If any check is red or doubtful, do not push: commit locally, report the exact blocking
condition, and stop.

---

## Self-Review

**Spec coverage:**
- "Fold A1 + A4 into `/analysis` above the existing leaks/strengths" → Task 3 Step 5
  inserts `ProgressPatternTable` (A1) and `ProgressDriverList` (A4) above the synthesis.
- "delete the now-pointless stub card" → Task 3 Step 5 deletes it; Step 6 greps for it.
- Acceptance 1 "stub gone and `/maps` reachable from the nav card grid" → Step 6 pins
  `/maps` in `apps/web/app/pages/index.vue`'s card grid; no nav change needed.
- Acceptance 2 "patterns table and drivers list, both honouring the ranked-only filter"
  → `rankedModeQuery()` (Task 3 Steps 1-4) feeds both fetches.

**Placeholder scan:** none — every step carries the actual code or the exact command.

**Type consistency:** `DriverRow` fields produced in Task 1 are the exact keys consumed
by Task 2's columns (`label`, `valueInWins`, `valueInLosses`, `effect`, `sample`,
`tone`, `reliable`). `rankedModeQuery` is imported once in Task 3 and its two new
consumers match its `{ mode: string }` return shape.
