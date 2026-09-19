# F3 — Accessibility Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web app honest with colour-blind users (redundant win/loss glyphs), announce live-draft updates politely (throttled), give every interactive component one visible keyboard focus ring, and honour `prefers-reduced-motion`.

**Architecture:** All colour-independent meaning is produced by pure functions in `apps/web/app/utils/` (tested with vitest, no DOM). Components stay thin and consume those functions. Focus + reduced motion are a small `@layer base` block in `globals.css` plus a chart-wrapper helper for the canvas animations a CSS media query cannot reach. No API, DB, or dependency changes.

**Tech Stack:** Nuxt 3 (SSR) + Vue 3 + @nuxt/ui v4 + Tailwind v4, chart.js/vue-chartjs, @vueuse/core (already a dependency), vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-player-progression-design.md` § F3

## Global Constraints

- French UI strings, English identifiers and comments.
- No new dependency, no hard-coded URL/secret.
- Every new calculation rule is pure, lives in `apps/web/app/utils/`, and is locked by a `*.test.ts` written first (red → green).
- Web tests run with: `bun run --filter './apps/web' test`.
- Repo-wide typecheck: `bun run typecheck`.
- Existing endpoints/pages keep their values: this plan only changes presentation/a11y, never data selection (except the visible captured-counter label, which is unchanged in text).
- Colour is never the sole carrier of win/loss: every touched indicator also carries a glyph.

## File Structure

- `apps/web/app/utils/tone.ts` (modify) — add the redundant glyph rule next to the tone rule it derives from.
- `apps/web/app/utils/tone.test.ts` (create) — locks `outcomeGlyph` / `winrateGlyph`.
- `apps/web/app/components/ui/ResultBadge.vue` (create) — one win/loss badge: glyph + French text + tone.
- `apps/web/app/components/ui/WinrateBar.vue` (modify) — optional glyph + `role="img"` accessible name.
- `apps/web/app/components/ui/MapWinrateList.vue` (modify) — glyph next to the V/D summary.
- `apps/web/app/utils/liveRegion.ts` (create) + `liveRegion.test.ts` (create) — captured-ago formatter and the 10 s announcement throttle.
- `apps/web/app/pages/draft/index.vue` (modify) — `aria-live` live-draft status and visually-hidden throttled announcement.
- `apps/web/app/assets/css/globals.css` (modify) — shared `:focus-visible` ring + `prefers-reduced-motion` block.
- `apps/web/app/utils/chartMotion.ts` (create) + `chartMotion.test.ts` (create) — disable Chart.js canvas animation under reduced motion.
- `apps/web/app/components/charts/{Bar,Line,Doughnut,Radar}Chart.vue` (modify) — consume `usePreferredReducedMotion` + `withReducedMotion`.
- Focus-ring call sites (modify): `components/ui/DataTable.vue`, `components/ui/StarRating.vue`, `components/ui/CommandPalette.vue`, `components/draft/DraftTeamColumn.vue`, `components/draft/DraftTeamThreats.vue`.
- Result-cell call sites (modify): `pages/index.vue`, `pages/matches/index.vue`, `pages/friends/[userId].vue`, `components/players/ProfileDetail.vue`.

---

### Task 1: Redundant win/loss glyph rule

**Files:**
- Modify: `apps/web/app/utils/tone.ts`
- Test: `apps/web/app/utils/tone.test.ts`

**Interfaces:**
- Consumes: existing `winrateTone(winrate, threshold?): Tone`, `Tone`.
- Produces: `OUTCOME_GLYPH: { win: "▲"; loss: "▼" }`, `outcomeGlyph(won: boolean): string`, `winrateGlyph(winrate: number | null | undefined, threshold?: number): string | null`.

- [x] **Step 1: Write the failing test** — create `apps/web/app/utils/tone.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { outcomeGlyph, winrateGlyph } from "./tone";

describe("outcomeGlyph", () => {
  test("points up for a win and down for a loss", () => {
    expect(outcomeGlyph(true)).toBe("▲");
    expect(outcomeGlyph(false)).toBe("▼");
  });
});

describe("winrateGlyph", () => {
  test("points up at or above the threshold", () => {
    expect(winrateGlyph(0.5)).toBe("▲");
    expect(winrateGlyph(0.62)).toBe("▲");
  });

  test("points down below the threshold", () => {
    expect(winrateGlyph(0.49)).toBe("▼");
    expect(winrateGlyph(0)).toBe("▼");
  });

  test("has no glyph without a winrate", () => {
    expect(winrateGlyph(null)).toBeNull();
    expect(winrateGlyph(undefined)).toBeNull();
  });

  test("honours a custom threshold like winrateTone does", () => {
    expect(winrateGlyph(0.2, 0)).toBe("▲");
    expect(winrateGlyph(-0.1, 0)).toBe("▼");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun run --filter './apps/web' test app/utils/tone.test.ts`
Expected: FAIL — `outcomeGlyph is not a function` / import error.

- [x] **Step 3: Write minimal implementation** — append to `apps/web/app/utils/tone.ts`:

```ts
/**
 * Redundant win/loss encoding (F3): a glyph carries the same meaning as the
 * success/danger colour, so the result stays readable in greyscale or with a
 * colour-vision deficiency.
 */
export const OUTCOME_GLYPH = { win: "▲", loss: "▼" } as const;

export function outcomeGlyph(won: boolean): string {
  return won ? OUTCOME_GLYPH.win : OUTCOME_GLYPH.loss;
}

/** Glyph for a winrate, derived from `winrateTone` so both stay in sync; null when there is no winrate to judge. */
export function winrateGlyph(winrate: number | null | undefined, threshold = 0.5): string | null {
  const tone = winrateTone(winrate, threshold);
  if (tone === "default") return null;
  return tone === "success" ? OUTCOME_GLYPH.win : OUTCOME_GLYPH.loss;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `bun run --filter './apps/web' test app/utils/tone.test.ts`
Expected: PASS (7 tests).

- [x] **Step 5: Commit**

```bash
git add apps/web/app/utils/tone.ts apps/web/app/utils/tone.test.ts
git commit -m "feat(web): add the redundant win/loss glyph rule"
```

---

### Task 2: One win/loss badge for DataTable result cells

**Files:**
- Create: `apps/web/app/components/ui/ResultBadge.vue`
- Modify: `apps/web/app/pages/index.vue` (334-336), `apps/web/app/pages/matches/index.vue` (385-389), `apps/web/app/pages/friends/[userId].vue` (118-122), `apps/web/app/components/players/ProfileDetail.vue` (287-291)

**Interfaces:**
- Consumes: `TONE_TEXT_CLASS`, `outcomeGlyph` (Task 1) — both Nuxt auto-imported.
- Produces: `<UiResultBadge :won="boolean" />` (auto-imported from `components/ui/`).

- [x] **Step 1: Create the component** — `apps/web/app/components/ui/ResultBadge.vue`:

```vue
<script setup lang="ts">
/**
 * Win/loss result cell shared by every UiDataTable "result" column. The
 * glyph is decorative (aria-hidden) because the French label already carries
 * the meaning -- the glyph is the redundant cue for colour-blind readers.
 */
defineProps<{ won: boolean }>();
</script>

<template>
  <span class="inline-flex items-center gap-1" :class="TONE_TEXT_CLASS[won ? 'success' : 'danger']">
    <span aria-hidden="true">{{ outcomeGlyph(won) }}</span>
    <span>{{ won ? "Victoire" : "Défaite" }}</span>
  </span>
</template>
```

- [x] **Step 2: Replace the four result cells**

In each of the four files, replace:

```html
<span :class="row.winner ? TONE_TEXT_CLASS.success : TONE_TEXT_CLASS.danger">
  {{ row.winner ? "Victoire" : "Défaite" }}
</span>
```

with:

```html
<UiResultBadge :won="Boolean(row.winner)" />
```

(`pages/matches/index.vue` uses the same slot body; `ProfileDetail.vue` and `friends/[userId].vue` too.)

- [x] **Step 3: Verify the build-level wiring**

Run: `bun run typecheck`
Expected: PASS (no missing component / type error).

- [x] **Step 4: Commit**

```bash
git add apps/web/app/components/ui/ResultBadge.vue apps/web/app/pages/index.vue apps/web/app/pages/matches/index.vue "apps/web/app/pages/friends/[userId].vue" apps/web/app/components/players/ProfileDetail.vue
git commit -m "feat(web): add a colour-blind-safe result badge to match tables"
```

---

### Task 3: WinrateBar glyph and accessible name

**Files:**
- Modify: `apps/web/app/components/ui/WinrateBar.vue`

**Interfaces:**
- Consumes: `winrateTone`, `TONE_TEXT_CLASS`, `winrateGlyph` (Task 1), `formatPercent`.
- Produces: no new exported API; the rendered bar now carries `role="img"` + `aria-label` and a trailing glyph.

- [x] **Step 1: Update the script block**

Add:

```ts
const toneTextClass = computed(() => TONE_TEXT_CLASS[tone.value]);
const glyph = computed(() => winrateGlyph(props.winrate));
const ariaLabel = computed(() => `Taux de victoire : ${formatPercent(props.winrate)}`);
```

- [x] **Step 2: Update the template**

Wrap the existing track in a flex row and move `relative` onto the track so the marker keeps its percentage basis:

```html
<div class="flex w-full items-center gap-1.5">
  <div class="relative min-w-0 flex-1" :class="heightClass" role="img" :aria-label="ariaLabel">
    <div class="h-full w-full overflow-hidden rounded-full bg-background">
      <span class="absolute inset-y-0 rounded-full" :class="toneBgClass" :style="{ left: segment.left, width: segment.width }" />
      <span v-if="centered" class="absolute inset-y-0 w-px bg-border" style="left: 50%" />
    </div>
    <span
      v-if="marker !== undefined"
      class="absolute -top-0.5 h-[calc(100%+4px)] w-px -translate-x-1/2 bg-foreground/70"
      :style="{ left: `${Math.min(100, Math.max(0, Math.round(marker * 100)))}%` }"
    />
  </div>
  <span v-if="glyph" class="shrink-0 text-[0.625rem] leading-none" :class="toneTextClass" aria-hidden="true">{{ glyph }}</span>
</div>
```

- [x] **Step 3: Verify call sites still lay out**

Run: `bun run typecheck` then `bun run --filter './apps/web' test`
Expected: PASS. Manually confirm the four call sites (`MapWinrateList`, `maps/index.vue`, `maps/[mapId].vue`, `talents/index.vue`) still render a full-width bar.

- [x] **Step 4: Commit**

```bash
git add apps/web/app/components/ui/WinrateBar.vue
git commit -m "feat(web): encode winrate direction with a glyph in UiWinrateBar"
```

---

### Task 4: Glyph in MapWinrateList

**Files:**
- Modify: `apps/web/app/components/ui/MapWinrateList.vue`

**Interfaces:**
- Consumes: `winrateGlyph` (Task 1), `winrateTone`, `TONE_TEXT_CLASS`.

- [x] **Step 1: Add the glyph to the summary line**

Replace:

```html
<span class="shrink-0 font-mono text-xs text-muted">
  {{ map.wins }}V / {{ map.losses }}D · {{ map.gamesPlayed }} partie{{ map.gamesPlayed > 1 ? "s" : "" }}
</span>
```

with:

```html
<span class="shrink-0 font-mono text-xs text-muted">
  <span aria-hidden="true" :class="TONE_TEXT_CLASS[winrateTone(map.winrate)]">{{ winrateGlyph(map.winrate) }}</span>
  {{ map.wins }}V / {{ map.losses }}D · {{ map.gamesPlayed }} partie{{ map.gamesPlayed > 1 ? "s" : "" }}
</span>
```

- [x] **Step 2: Verify**

Run: `bun run typecheck`
Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add apps/web/app/components/ui/MapWinrateList.vue
git commit -m "feat(web): add a redundant glyph to the map winrate list"
```

---

### Task 5: Live-draft regions with a throttled counter announcement

**Files:**
- Create: `apps/web/app/utils/liveRegion.ts`
- Create: `apps/web/app/utils/liveRegion.test.ts`
- Modify: `apps/web/app/pages/draft/index.vue`

**Interfaces:**
- Produces: `LIVE_ANNOUNCE_INTERVAL_MS = 10_000`, `formatCapturedAgo(seconds: number): string`, `shouldAnnounce(lastAnnouncedAtMs: number | null, nowMs: number, intervalMs?: number): boolean`.

- [x] **Step 1: Write the failing test** — `apps/web/app/utils/liveRegion.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { LIVE_ANNOUNCE_INTERVAL_MS, formatCapturedAgo, shouldAnnounce } from "./liveRegion";

describe("formatCapturedAgo", () => {
  test("renders seconds under a minute", () => {
    expect(formatCapturedAgo(0)).toBe("Capturée il y a 0s");
    expect(formatCapturedAgo(59)).toBe("Capturée il y a 59s");
  });

  test("renders minutes under an hour", () => {
    expect(formatCapturedAgo(60)).toBe("Capturée il y a 1 min");
    expect(formatCapturedAgo(3599)).toBe("Capturée il y a 60 min");
  });

  test("renders hours beyond an hour", () => {
    expect(formatCapturedAgo(3600)).toBe("Capturée il y a 1 h");
    expect(formatCapturedAgo(7199)).toBe("Capturée il y a 2 h");
  });

  test("clamps negative and non-finite inputs instead of inventing a label", () => {
    expect(formatCapturedAgo(-5)).toBe("Capturée il y a 0s");
    expect(formatCapturedAgo(Number.NaN)).toBe("");
  });
});

describe("shouldAnnounce", () => {
  test("announces the first reading immediately", () => {
    expect(shouldAnnounce(null, 1_000)).toBe(true);
  });

  test("waits the full interval between announcements", () => {
    expect(shouldAnnounce(0, LIVE_ANNOUNCE_INTERVAL_MS - 1)).toBe(false);
    expect(shouldAnnounce(0, LIVE_ANNOUNCE_INTERVAL_MS)).toBe(true);
  });

  test("does not announce again when the clock goes backwards", () => {
    expect(shouldAnnounce(10_000, 9_000)).toBe(false);
  });

  test("accepts a custom interval", () => {
    expect(shouldAnnounce(0, 500, 500)).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun run --filter './apps/web' test app/utils/liveRegion.test.ts`
Expected: FAIL — module `./liveRegion` not found.

- [x] **Step 3: Write minimal implementation** — `apps/web/app/utils/liveRegion.ts`:

```ts
/**
 * F3 live regions. The visible "captured Xs ago" counter ticks every second,
 * but a screen reader must not be interrupted every second: the announced
 * text is throttled to one update per `LIVE_ANNOUNCE_INTERVAL_MS`.
 */
export const LIVE_ANNOUNCE_INTERVAL_MS = 10_000;

/** French label for "captured N seconds ago"; empty when the input is not a finite number. */
export function formatCapturedAgo(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) return `Capturée il y a ${safe}s`;
  if (safe < 3600) return `Capturée il y a ${Math.round(safe / 60)} min`;
  return `Capturée il y a ${Math.round(safe / 3600)} h`;
}

/** True when the live region may be updated again (the very first reading always may). */
export function shouldAnnounce(
  lastAnnouncedAtMs: number | null,
  nowMs: number,
  intervalMs = LIVE_ANNOUNCE_INTERVAL_MS,
): boolean {
  if (lastAnnouncedAtMs === null) return true;
  return nowMs - lastAnnouncedAtMs >= intervalMs;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `bun run --filter './apps/web' test app/utils/liveRegion.test.ts`
Expected: PASS (8 tests).

- [x] **Step 5: Wire the draft page**

Replace the `capturedAgoLabel` block (lines ~106-127) with:

```ts
const capturedAgoLabel = ref("");
const announcedCapturedAgo = ref("");
let lastAnnouncedAt: number | null = null;
let tickTimer: ReturnType<typeof setInterval> | undefined;

function updateCapturedAgoLabel() {
  if (!snapshot.value) {
    capturedAgoLabel.value = "";
    announcedCapturedAgo.value = "";
    lastAnnouncedAt = null;
    return;
  }
  const seconds = (Date.now() - new Date(snapshot.value.capturedAt).getTime()) / 1000;
  capturedAgoLabel.value = formatCapturedAgo(seconds);
  const now = Date.now();
  if (shouldAnnounce(lastAnnouncedAt, now)) {
    announcedCapturedAgo.value = capturedAgoLabel.value;
    lastAnnouncedAt = now;
  }
}
```

Keep the existing `onMounted`/`onUnmounted`/`watch(snapshot, ...)` wiring unchanged.

- [x] **Step 6: Add the live regions to the template**

Status row (lines ~137-140): add `role="status" aria-live="polite"` to the wrapping div:

```html
<div class="flex shrink-0 items-center gap-1.5 text-xs text-muted" role="status" aria-live="polite">
  <span class="h-2 w-2 rounded-full" :class="connected ? 'bg-success' : 'bg-danger'" aria-hidden="true" />
  {{ connected ? "En direct" : "Hors ligne" }}
</div>
```

Counter (line ~156): keep the visible paragraph silent and add the throttled announced text:

```html
<p v-if="capturedAgoLabel" class="text-xs text-muted">{{ capturedAgoLabel }}</p>
<p class="sr-only" aria-live="polite">{{ announcedCapturedAgo }}</p>
```

- [x] **Step 7: Verify**

Run: `bun run typecheck` then `bun run --filter './apps/web' test`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add apps/web/app/utils/liveRegion.ts apps/web/app/utils/liveRegion.test.ts apps/web/app/pages/draft/index.vue
git commit -m "feat(web): announce live-draft status politely and throttle the captured counter"
```

---

### Task 6: One consistent focus-visible ring

**Files:**
- Modify: `apps/web/app/assets/css/globals.css`
- Modify: `apps/web/app/components/ui/DataTable.vue`, `apps/web/app/components/ui/StarRating.vue`, `apps/web/app/components/ui/CommandPalette.vue`, `apps/web/app/components/draft/DraftTeamColumn.vue`, `apps/web/app/components/draft/DraftTeamThreats.vue`

**Interfaces:** no exported API; CSS is `@layer base` with a zero-specificity `:where()` selector so component utilities (including Nuxt UI's own `focus-visible:outline-3`) still win.

- [x] **Step 1: Add the base rule** at the end of `globals.css`:

```css
/*
 * F3 -- one consistent focus ring for interactive components. `:where()`
 * keeps specificity at 0 so a component utility (e.g. `outline-none` or
 * Nuxt UI's own `focus-visible:outline-3`) can still override it, and
 * `:focus-visible` keeps the ring off pointer clicks. Outline rather than a
 * box-shadow ring so it never adds to the element's layout box.
 */
@layer base {
  :where(a, button, input, select, textarea, summary, [role="button"], [tabindex]):focus-visible {
    outline: 2px solid oklch(var(--raw-primary));
    outline-offset: 2px;
  }
}
```

- [x] **Step 2: Remove the ad-hoc box-shadow rings so the global outline is the only ring**

- `DataTable.vue` line ~118: drop `outline-none` and `focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand`; keep `focus-visible:bg-surface` and add `focus-visible:[outline-offset:-2px]` (the row lives in an `overflow-x-auto` container, an inset ring cannot be clipped).
- `DataTable.vue` line ~151: drop `outline-none` and `focus-visible:border-brand/40 focus-visible:ring-1 focus-visible:ring-brand`.
- `StarRating.vue` line ~31: drop `outline-none`; line ~35: drop `focus-visible:ring-1 focus-visible:ring-brand`.
- `DraftTeamColumn.vue` line ~54/57: drop `outline-none` and `focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand`; keep `focus-visible:bg-background`.
- `DraftTeamThreats.vue` line ~54: drop `outline-none` and `focus-visible:ring-1 focus-visible:ring-brand`; keep `focus-visible:bg-background`.
- `CommandPalette.vue` line ~110: drop `outline-none` so the input gets the shared ring on top of its `focus:border-brand`.

- [x] **Step 3: Verify**

Run: `bun run --filter './apps/web' test` then `bun run typecheck`
Expected: PASS. Manual: tab through the dashboard, matches list, draft and command palette -- every stop shows the same brand ring.

- [x] **Step 4: Commit**

```bash
git add apps/web/app/assets/css/globals.css apps/web/app/components/ui/DataTable.vue apps/web/app/components/ui/StarRating.vue apps/web/app/components/ui/CommandPalette.vue apps/web/app/components/draft/DraftTeamColumn.vue apps/web/app/components/draft/DraftTeamThreats.vue
git commit -m "feat(web): unify the focus-visible ring across interactive components"
```

---

### Task 7: Honour prefers-reduced-motion

**Files:**
- Modify: `apps/web/app/assets/css/globals.css`
- Create: `apps/web/app/utils/chartMotion.ts`
- Create: `apps/web/app/utils/chartMotion.test.ts`
- Modify: `apps/web/app/components/charts/BarChart.vue`, `LineChart.vue`, `DoughnutChart.vue`, `RadarChart.vue`

**Interfaces:**
- Produces: `withReducedMotion<T extends object>(options: T, reduced: boolean): T`.

- [x] **Step 1: Write the failing test** — `apps/web/app/utils/chartMotion.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { withReducedMotion } from "./chartMotion";

describe("withReducedMotion", () => {
  test("disables Chart.js animation when reduced motion is on, even over a caller's own animation", () => {
    expect(withReducedMotion({ responsive: true, animation: { duration: 400 } }, true)).toEqual({
      responsive: true,
      animation: false,
    });
  });

  test("leaves the options untouched when motion is allowed", () => {
    const options = { responsive: true };
    expect(withReducedMotion(options, false)).toBe(options);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun run --filter './apps/web' test app/utils/chartMotion.test.ts`
Expected: FAIL — module `./chartMotion` not found.

- [x] **Step 3: Write minimal implementation** — `apps/web/app/utils/chartMotion.ts`:

```ts
/**
 * F3 -- Chart.js draws to a canvas, so the CSS `prefers-reduced-motion`
 * block in `globals.css` cannot reach it. The base chart wrappers merge this
 * into their options instead; every other Chart.js option is preserved.
 */
export function withReducedMotion<T extends object>(options: T, reduced: boolean): T {
  return reduced ? ({ ...options, animation: false } as T) : options;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `bun run --filter './apps/web' test app/utils/chartMotion.test.ts`
Expected: PASS (2 tests).

- [x] **Step 5: Add the CSS media query** at the end of `globals.css`:

```css
/*
 * F3 -- reduced motion: neutralise the CSS-driven transitions/animations
 * (spinners, hover/press transitions, the token glow). Chart.js canvas
 * animations are handled per-wrapper in app/utils/chartMotion.ts.
 */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [x] **Step 6: Wire the four base chart wrappers**

In each of `BarChart.vue`, `LineChart.vue`, `DoughnutChart.vue`, `RadarChart.vue`, replace the `withDefaults(defineProps<...>(), ...)` line with a named `props`, and add the options computed. For example `BarChart.vue`:

```ts
import { usePreferredReducedMotion } from "@vueuse/core";

const props = withDefaults(
  defineProps<{ data: ChartData<"bar">; options?: ChartOptions<"bar"> }>(),
  { options: undefined },
);

const reducedMotion = usePreferredReducedMotion();
const chartOptions = computed(() =>
  withReducedMotion(
    { responsive: true, maintainAspectRatio: false, ...props.options },
    reducedMotion.value === "reduce",
  ),
);
```

and the template becomes `<Bar :data="data" :options="chartOptions" />`. Repeat the same shape for `Line`, `Doughnut` and `Radar`.

- [x] **Step 7: Verify**

Run: `bun run --filter './apps/web' test` then `bun run typecheck`
Expected: PASS. Manual: with the OS "reduce motion" setting on, chart updates do not animate and spinners stop.

- [x] **Step 8: Commit**

```bash
git add apps/web/app/assets/css/globals.css apps/web/app/utils/chartMotion.ts apps/web/app/utils/chartMotion.test.ts apps/web/app/components/charts/BarChart.vue apps/web/app/components/charts/LineChart.vue apps/web/app/components/charts/DoughnutChart.vue apps/web/app/components/charts/RadarChart.vue
git commit -m "feat(web): honour prefers-reduced-motion in CSS and charts"
```

---

### Task 8: Verification and docs

**Files:**
- Modify: `tasks/progression-roadmap.md`, `tasks/README.md`

- [x] **Step 1: Run the full gate**

```bash
bun run typecheck
bun run --filter './apps/web' test
```

Expected: both green. (`bun test apps/api` / `packages/shared-types` / `pytest` untouched by this chantier.)

- [x] **Step 2: Manual accessibility checklist** (the spec allows an equivalent to axe-core; no new dependency is added)

For `/` (dashboard), `/progress`, `/matches`, `/matches/[id]`:
1. Every win/loss/winrate indicator carries a glyph as well as colour (greyscale-safe).
2. Tab through every interactive element: one identical brand focus ring, always visible.
3. Every interactive element has a non-empty accessible name; the draft live regions announce at most once per 10 s.
4. With `prefers-reduced-motion: reduce` emulated, transitions/spinners/chart animation stop.

- [x] **Step 3: Tick the chantier and record the gaps** in `tasks/progression-roadmap.md` (`- [x] **F3 ...` + "Fait" note) and add one line to `tasks/README.md`.

- [x] **Step 4: Commit**

```bash
git add tasks/progression-roadmap.md tasks/README.md
git commit -m "docs(tasks): record the F3 accessibility pass chantier"
```

## Self-Review

- **Spec coverage:** colour-blind glyphs (Tasks 1, 2, 3, 4) ✓; live regions + 10 s throttle (Task 5) ✓; focus visibility (Task 6) ✓; reduced motion (Task 7) ✓; acceptance criteria 1-3 (Tasks 7/8 verification) ✓.
- **Placeholders:** none — every code step shows the actual code.
- **Type consistency:** `outcomeGlyph` / `winrateGlyph` / `withReducedMotion` / `formatCapturedAgo` / `shouldAnnounce` names match across tasks and call sites.
- **Out of scope (documented, not implemented):** axe-core is not added (dependency rule); F4 CSV export is a separate chantier; non-result colour-only indicators on pages outside the spec's entry points (e.g. `/maps` recent-form dots) are left for a follow-up.
