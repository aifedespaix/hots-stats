# D1 — Draft assistance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Turn the live-draft snapshot D0 enriched into an actionable assistant: a composition alert on the viewer's own team, ranked pick suggestions for the current battleground, and ban suggestions from the viewer's worst matchups — all reusing the existing snapshot stream and existing hero endpoints.

**Architecture:** D0 already resolves the battleground (`mapId`) and each plate's hero (`heroId`) once at ingest, then rides the in-memory snapshot. D1 adds the resolved hero *role* to the same snapshot so the composition counter can work with no extra round trip, then ships one pure rules module (`apps/web/app/utils/draftAssist.ts`) and one presentational panel (`DraftAssistPanel.vue`) fed by the two existing endpoints `/heroes?scope=personal&mapId=` and `/heroes/:heroId/matchups?scope=personal`. No new API, no migration, no new dependency, no new polling loop.

**Tech Stack:** Nuxt 4 + Vue 3 + Nuxt UI (web), Hono + Drizzle + Zod (API), bun:test + vitest.

**Spec:** docs/superpowers/specs/2026-09-18-player-progression-design.md (section D1, Cross-cutting rules) completed by docs/superpowers/specs/2026-09-19-draft-capture-enrichment-design.md (D0 data layer + known localized-name gap).

## Global Constraints

- French UI strings; English identifiers and comments.
- Never invent data. A metric with no source is out of scope, not approximated. No rank/MMR, no objective timer.
- Every suggestion displays its `n` (acceptance criterion 3).
- The composition alert triggers exactly on the rules documented in `summarizeComposition` (acceptance criterion 2).
- When heroes are unresolved, the panel states what it is waiting for and shows no pick list (acceptance criterion 1).
- No new polling loop: reuse `useDraftStream`; the panel only issues one-shot fetches keyed to the snapshot (acceptance criterion 4).
- No new endpoint and no new dependency. The only API change is an additive field on the in-memory draft snapshot.
- Additive-only contract change: the deployed web build ignores the new `heroRole` JSON field.
- Multi-account: the panel reads the caller's own teams from `ownBattletags`; the fetches go through the existing session-authed, account-scoped `/heroes` routes (never `eq(matchPlayers.userId, ...)`).
- Gate commands before commit/push: `bun run typecheck`, `bun test packages/shared-types`, `bun test apps/api`, `bun run --filter './apps/web' test`.

---

## File Structure

| File | Responsibility |
|---|---|
| packages/shared-types/src/draft.ts | + `heroRole` on `DraftPlayerSlot` (modify) |
| apps/api/src/services/draft.service.ts | resolve + carry `heroRole` on each slot (modify) |
| apps/web/app/utils/draftAssist.ts | pure composition rules, pick ranking, ban ranking (create) |
| apps/web/app/utils/draftAssist.test.ts | vitest for the pure rules (create) |
| apps/web/app/components/draft/DraftAssistPanel.vue | the panel: waiting/empty/error states + suggestions (create) |
| apps/web/app/pages/draft/index.vue | mount the panel once, full width (modify) |
| tasks/progression-roadmap.md, tasks/README.md | tick D1 + notes (modify) |

---

### Task 1: The draft snapshot carries the resolved hero role

**Files:**
- Modify: `packages/shared-types/src/draft.ts`
- Modify: `apps/api/src/services/draft.service.ts`

**Interfaces:**
- Consumes: the existing `resolveHeroId(rawName, heroRows)` and the `heroes.role` column (D0).
- Produces: `DraftPlayerSlot.heroRole: string | null`, populated for every slot whose `heroId` resolved, `null` otherwise.

This task is contract plumbing, not calculation logic: there is no standalone algorithm to drive red-green (the role is a column lookup on an already-resolved id). It is verified by `bun run typecheck` plus the existing `draft-resolution` tests staying green. TDD starts at Task 2.

- [ ] **Step 1: Add the field to the shared contract**

In `packages/shared-types/src/draft.ts`, inside `DraftPlayerSlot`, after `heroId`:

~~~ts
  /** That name resolved against the app's canonical hero names; null when the localized name has no known match. */
  heroId: string | null;
  /** The resolved hero's `heroes.role` (Tank, Healer, ...); null when `heroId` is null. */
  heroRole: string | null;
~~~

- [ ] **Step 2: Carry the role through the in-memory snapshot**

In `apps/api/src/services/draft.service.ts`:

Add the field to the internal stored slot type (`ResolvedSlot`):

~~~ts
interface ResolvedSlot extends DraftSlotInput {
  candidates: string[];
  /** That slot's `heroName`, resolved against `heroes.name` once at ingest. */
  heroId: string | null;
  /** The resolved hero's `heroes.role`, carried so the web composition panel needs no extra fetch. */
  heroRole: string | null;
}
~~~

Return it from `resolveSlot` in `toViewerSnapshot`:

~~~ts
      heroName: slot.heroName ?? null,
      heroId: slot.heroId,
      heroRole: slot.heroRole,
    };
~~~

In `ingestDraftSnapshot`, select the role column and build the id → role map:

~~~ts
  const [mapRows, heroRows] = await Promise.all([
    db.select({ id: maps.id, name: maps.name }).from(maps),
    db.select({ id: heroes.id, name: heroes.name, role: heroes.role }).from(heroes),
  ]);
  const heroRoleById = new Map(heroRows.map((hero) => [hero.id, hero.role]));
~~~

and inside the `resolvedSlots` mapping:

~~~ts
    allSlots.map(async (slot) => {
      const heroName = slot.heroName ?? null;
      const heroId = resolveHeroId(heroName, heroRows);
      return {
        ...slot,
        heroName,
        heroId,
        heroRole: heroId ? (heroRoleById.get(heroId) ?? null) : null,
        candidates: slot.status === "ok" && slot.rawName ? await resolveCandidates(slot.rawName) : [],
      };
    }),
~~~

- [ ] **Step 3: Verify**

Run: `bun test apps/api`
Expected: PASS (draft-resolution tests unchanged).

Run: `bun run typecheck`
Expected: PASS for every workspace.

- [ ] **Step 4: Commit**

~~~bash
git add packages/shared-types/src/draft.ts apps/api/src/services/draft.service.ts
git commit -m "feat(api): carry the picked hero role on the draft snapshot"
~~~

---

### Task 2: Pure composition summary (TDD)

**Files:**
- Create: `apps/web/app/utils/draftAssist.ts`
- Create: `apps/web/app/utils/draftAssist.test.ts`

**Interfaces:**
- Consumes: `wilsonLowerBound` from `apps/web/app/utils/wilson.ts` (Task 3), `DRAFT_MIN_RANKED_GAMES_FOR_RANKING` from `@hots-stats/shared-types` (Task 3).
- Produces: `DRAFT_ASSIST_TEAM_SIZE`, `summarizeComposition(slots)`, `CompositionSummary`, `CompositionWarning`, `RoleCount` (Task 5 consumes).

- [ ] **Step 1: Write the failing test**

~~~ts
import { describe, expect, test } from "vitest";
import { summarizeComposition } from "./draftAssist";

function team(roles: Array<string | null>) {
  return roles.map((heroRole) => ({ heroRole }));
}

describe("summarizeComposition", () => {
  test("counts resolved roles, most frequent first", () => {
    const summary = summarizeComposition(team(["Tank", "Healer", "RangedAssassin", "RangedAssassin", "Bruiser"]));
    expect(summary.resolved).toBe(5);
    expect(summary.total).toBe(5);
    expect(summary.counts).toEqual([
      { role: "RangedAssassin", count: 2 },
      { role: "Bruiser", count: 1 },
      { role: "Healer", count: 1 },
      { role: "Tank", count: 1 },
    ]);
    expect(summary.warnings).toEqual([]);
    expect(summary.partial).toBe(false);
  });

  test("warns when a fully resolved team has no healer", () => {
    const summary = summarizeComposition(team(["Tank", "Bruiser", "RangedAssassin", "MeleeAssassin", "RangedAssassin"]));
    expect(summary.healerCount).toBe(0);
    expect(summary.warnings.map((warning) => warning.kind)).toEqual(["noHealer", "manyAssassins"]);
  });

  test("does not claim a missing healer while a slot is unresolved", () => {
    const summary = summarizeComposition(team(["Tank", "Bruiser", "RangedAssassin", null, null]));
    expect(summary.resolved).toBe(3);
    expect(summary.partial).toBe(true);
    expect(summary.warnings.map((warning) => warning.kind)).not.toContain("noHealer");
  });

  test("warns at exactly three assassins, not two", () => {
    const two = summarizeComposition(team(["Tank", "Healer", "RangedAssassin", "MeleeAssassin", "Bruiser"]));
    expect(two.warnings).toEqual([]);

    const three = summarizeComposition(team(["Tank", "Healer", "RangedAssassin", "MeleeAssassin", "RangedAssassin"]));
    expect(three.assassinCount).toBe(3);
    expect(three.warnings.map((warning) => warning.kind)).toEqual(["manyAssassins"]);
  });

  test("warns when a fully resolved team has no tank", () => {
    const summary = summarizeComposition(team(["Healer", "Bruiser", "RangedAssassin", "MeleeAssassin", "Support"]));
    expect(summary.tankCount).toBe(0);
    expect(summary.warnings.map((warning) => warning.kind)).toEqual(["noTank"]);
  });

  test("returns nothing to warn about for an empty team", () => {
    const summary = summarizeComposition([]);
    expect(summary).toMatchObject({ resolved: 0, total: 0, warnings: [], partial: false });
  });
});
~~~

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --filter './apps/web' test apps/web/app/utils/draftAssist.test.ts`
Expected: FAIL — `./draftAssist` cannot be resolved.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/web/app/utils/draftAssist.ts`:

~~~ts
/** HotS teams are five slots. Named so the "3/5 héros reconnus" copy never
 * repeats a magic 5. */
export const DRAFT_ASSIST_TEAM_SIZE = 5;

const ASSASSIN_ROLES = ["RangedAssassin", "MeleeAssassin"];
const HEALER_ROLE = "Healer";
const TANK_ROLE = "Tank";

export type CompositionWarningKind = "noHealer" | "noTank" | "manyAssassins";

export interface CompositionWarning {
  kind: CompositionWarningKind;
  /** French, ready to render. */
  message: string;
}

export interface RoleCount {
  role: string;
  count: number;
}

export interface CompositionSummary {
  /** Slots whose hero resolved to a known role. */
  resolved: number;
  /** Slots on the team (five). */
  total: number;
  /** Resolved role counts, most frequent first, ties by role name. */
  counts: RoleCount[];
  healerCount: number;
  tankCount: number;
  /** RangedAssassin + MeleeAssassin. */
  assassinCount: number;
  /** Ordered noHealer, noTank, manyAssassins. */
  warnings: CompositionWarning[];
  /** True when at least one slot's hero is still unresolved. */
  partial: boolean;
}

/**
 * Role-by-role composition of one team. Absence warnings ("no healer", "no
 * tank") are only emitted on a *fully resolved* team: with an unresolved slot,
 * "no healer" could be a false alarm, so the panel shows the recognized count
 * instead. The presence warning ("3 assassins") is safe on a partial read:
 * those picks are facts, whatever the remaining plates say.
 */
export function summarizeComposition(slots: Array<{ heroRole: string | null }>): CompositionSummary {
  const total = slots.length;
  const counts = new Map<string, number>();
  for (const slot of slots) {
    if (!slot.heroRole) continue;
    counts.set(slot.heroRole, (counts.get(slot.heroRole) ?? 0) + 1);
  }

  let resolved = 0;
  for (const count of counts.values()) resolved += count;

  const healerCount = counts.get(HEALER_ROLE) ?? 0;
  const tankCount = counts.get(TANK_ROLE) ?? 0;
  let assassinCount = 0;
  for (const role of ASSASSIN_ROLES) assassinCount += counts.get(role) ?? 0;

  const warnings: CompositionWarning[] = [];
  if (total > 0 && resolved === total && healerCount === 0) {
    warnings.push({ kind: "noHealer", message: "Aucun soigneur dans ton équipe." });
  }
  if (total > 0 && resolved === total && tankCount === 0) {
    warnings.push({ kind: "noTank", message: "Aucun tank dans ton équipe." });
  }
  if (assassinCount >= 3) {
    warnings.push({ kind: "manyAssassins", message: "3 assassins ou plus dans ton équipe." });
  }

  const sortedCounts: RoleCount[] = [...counts.entries()]
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));

  return {
    resolved,
    total,
    counts: sortedCounts,
    healerCount,
    tankCount,
    assassinCount,
    warnings,
    partial: resolved < total,
  };
}
~~~

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --filter './apps/web' test apps/web/app/utils/draftAssist.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

~~~bash
git add apps/web/app/utils/draftAssist.ts apps/web/app/utils/draftAssist.test.ts
git commit -m "feat(web): summarize the draft team composition"
~~~

---

### Task 3: Pure pick ranking (TDD)

**Files:**
- Modify: `apps/web/app/utils/draftAssist.ts`
- Modify: `apps/web/app/utils/draftAssist.test.ts`

**Interfaces:**
- Consumes: `summarizeComposition` (Task 2), `wilsonLowerBound` from `apps/web/app/utils/wilson.ts`, `DRAFT_MIN_RANKED_GAMES_FOR_RANKING` from `@hots-stats/shared-types`.
- Produces: `DRAFT_ASSIST_MAX_PICKS`, `DRAFT_ASSIST_MAX_LIKELY_HEROES`, `DRAFT_ASSIST_CONTESTED_ROLE_PENALTY`, `rankPickSuggestions(candidates, takenRoles, limit)`, `PickCandidateInput`, `PickSuggestion` (Tasks 4 and 5 consume).

- [ ] **Step 1: Write the failing test**

Append to `apps/web/app/utils/draftAssist.test.ts`:

~~~ts
import { DRAFT_MIN_RANKED_GAMES_FOR_RANKING } from "@hots-stats/shared-types";
import { DRAFT_ASSIST_CONTESTED_ROLE_PENALTY, rankPickSuggestions } from "./draftAssist";
import { wilsonLowerBound } from "./wilson";

function candidate(overrides: Partial<Parameters<typeof rankPickSuggestions>[0][number]>) {
  return {
    heroId: "h",
    heroName: "Hero",
    heroRole: "RangedAssassin",
    gamesPlayed: 20,
    wins: 10,
    winrate: 0.5,
    ...overrides,
  };
}

describe("rankPickSuggestions", () => {
  test("keeps confident records ahead of a three-game fluke", () => {
    const suggestions = rankPickSuggestions(
      [
        candidate({ heroId: "lucky", gamesPlayed: 3, wins: 3, winrate: 1 }),
        candidate({ heroId: "solid", gamesPlayed: 40, wins: 24, winrate: 0.6 }),
      ],
      [],
    );
    expect(suggestions.map((entry) => entry.heroId)).toEqual(["solid", "lucky"]);
    expect(suggestions[0]?.score).toBeCloseTo(wilsonLowerBound(24, 40));
  });

  test("orders confident heroes by their Wilson lower bound", () => {
    const suggestions = rankPickSuggestions(
      [
        candidate({ heroId: "low", gamesPlayed: 20, wins: 8 }),
        candidate({ heroId: "high", gamesPlayed: 20, wins: 14 }),
      ],
      [],
    );
    expect(suggestions.map((entry) => entry.heroId)).toEqual(["high", "low"]);
  });

  test("down-weights a role the team already picked", () => {
    const suggestions = rankPickSuggestions(
      [
        candidate({ heroId: "healer", heroName: "Healer", heroRole: "Healer", gamesPlayed: 20, wins: 11, winrate: 0.55 }),
        candidate({ heroId: "tank", heroName: "Tank", heroRole: "Tank", gamesPlayed: 20, wins: 10, winrate: 0.5 }),
      ],
      ["Healer"],
    );
    expect(suggestions.map((entry) => entry.heroId)).toEqual(["tank", "healer"]);
    expect(suggestions[1]?.score).toBeCloseTo(wilsonLowerBound(11, 20) - DRAFT_ASSIST_CONTESTED_ROLE_PENALTY);
  });

  test("flags a thin sample while keeping its game count", () => {
    const below = rankPickSuggestions([candidate({ gamesPlayed: DRAFT_MIN_RANKED_GAMES_FOR_RANKING - 1 })], []);
    expect(below[0]).toMatchObject({ gamesPlayed: DRAFT_MIN_RANKED_GAMES_FOR_RANKING - 1, smallSample: true });

    const atFloor = rankPickSuggestions([candidate({ gamesPlayed: DRAFT_MIN_RANKED_GAMES_FOR_RANKING })], []);
    expect(atFloor[0]?.smallSample).toBe(false);
  });

  test("caps the list at the requested limit", () => {
    const candidates = ["a", "b", "c", "d"].map((id) => candidate({ heroId: id }));
    expect(rankPickSuggestions(candidates, [], 2)).toHaveLength(2);
  });
});
~~~

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --filter './apps/web' test apps/web/app/utils/draftAssist.test.ts`
Expected: FAIL — `rankPickSuggestions` is not exported.

- [ ] **Step 3: Write the minimal implementation**

Add to `apps/web/app/utils/draftAssist.ts`, above the exported functions:

~~~ts
import { DRAFT_MIN_RANKED_GAMES_FOR_RANKING } from "@hots-stats/shared-types";
import { wilsonLowerBound } from "./wilson";

/** How many pick suggestions the panel shows. */
export const DRAFT_ASSIST_MAX_PICKS = 3;
/** How many of the viewer's top picks feed the ban search (one
 * /heroes/:heroId/matchups call each). */
export const DRAFT_ASSIST_MAX_LIKELY_HEROES = 3;
/** Score penalty, per already-picked team-mate sharing the role, applied to
 * the Wilson bound: a second healer is worse than a fresh role, all else
 * equal. Expressed on the same 0..1 scale as the bound it subtracts. */
export const DRAFT_ASSIST_CONTESTED_ROLE_PENALTY = 0.1;
~~~

and, at the end of the file:

~~~ts
export interface PickCandidateInput {
  heroId: string;
  heroName: string;
  heroRole: string | null;
  gamesPlayed: number;
  wins: number;
  winrate: number;
}

export interface PickSuggestion extends PickCandidateInput {
  wilsonLowerBound: number;
  /** Wilson lower bound minus the contested-role penalty; the ranking key. */
  score: number;
  /** True under DRAFT_MIN_RANKED_GAMES_FOR_RANKING — shown, but flagged. */
  smallSample: boolean;
}

/**
 * Ranks the viewer's own heroes on the current battleground. Confidence comes
 * first: a hero below DRAFT_MIN_RANKED_GAMES_FOR_RANKING is flagged and sorts
 * after every confident one, so three lucky games never lead the list. Among
 * confident heroes the key is the Wilson lower bound, not the raw winrate,
 * and each role the team already picked subtracts
 * DRAFT_ASSIST_CONTESTED_ROLE_PENALTY — so a fresh role surfaces over a
 * duplicate. Ties break on more games, then hero name, for a stable order.
 */
export function rankPickSuggestions(
  candidates: PickCandidateInput[],
  takenRoles: Array<string | null>,
  limit = DRAFT_ASSIST_MAX_PICKS,
): PickSuggestion[] {
  const taken = takenRoles.filter((role): role is string => Boolean(role));
  const suggestions: PickSuggestion[] = candidates.map((candidate) => {
    const bound = wilsonLowerBound(candidate.wins, candidate.gamesPlayed);
    const duplicates = candidate.heroRole ? taken.filter((role) => role === candidate.heroRole).length : 0;
    return {
      ...candidate,
      wilsonLowerBound: bound,
      score: bound - duplicates * DRAFT_ASSIST_CONTESTED_ROLE_PENALTY,
      smallSample: candidate.gamesPlayed < DRAFT_MIN_RANKED_GAMES_FOR_RANKING,
    };
  });

  suggestions.sort(
    (a, b) =>
      Number(a.smallSample) - Number(b.smallSample) ||
      b.score - a.score ||
      b.gamesPlayed - a.gamesPlayed ||
      a.heroName.localeCompare(b.heroName),
  );

  return suggestions.slice(0, Math.max(0, limit));
}
~~~

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --filter './apps/web' test apps/web/app/utils/draftAssist.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

~~~bash
git add apps/web/app/utils/draftAssist.ts apps/web/app/utils/draftAssist.test.ts
git commit -m "feat(web): rank draft pick suggestions by Wilson bound"
~~~

---

### Task 4: Pure ban ranking (TDD)

**Files:**
- Modify: `apps/web/app/utils/draftAssist.ts`
- Modify: `apps/web/app/utils/draftAssist.test.ts`

**Interfaces:**
- Consumes: `rankPickSuggestions` (Task 3).
- Produces: `DRAFT_ASSIST_MAX_BANS`, `rankBanSuggestions(groups, limit)`, `LikelyHeroMatchups`, `MatchupCandidateInput`, `BanSuggestion` (Task 5 consumes).

- [ ] **Step 1: Write the failing test**

Append to `apps/web/app/utils/draftAssist.test.ts`:

~~~ts
import { rankBanSuggestions } from "./draftAssist";

function matchup(overrides: Partial<Parameters<typeof rankBanSuggestions>[0][number]["worstMatchups"][number]>) {
  return {
    heroId: "opp",
    heroName: "Opponent",
    heroRole: "RangedAssassin",
    gamesPlayed: 20,
    winrate: 0.4,
    deltaWinrate: -0.1,
    smallSample: false,
    ...overrides,
  };
}

describe("rankBanSuggestions", () => {
  test("bans the opponent with the most negative winrate delta", () => {
    const bans = rankBanSuggestions([
      {
        heroId: "likely",
        heroName: "Mon héros",
        worstMatchups: [
          matchup({ heroId: "x", heroName: "X", deltaWinrate: -0.1 }),
          matchup({ heroId: "y", heroName: "Y", deltaWinrate: -0.25 }),
        ],
      },
    ]);
    expect(bans.map((ban) => ban.heroId)).toEqual(["y", "x"]);
    expect(bans[0]).toMatchObject({ heroId: "y", counteredHeroId: "likely", counteredHeroName: "Mon héros" });
  });

  test("prefers a confident entry over a noisier, more negative one", () => {
    const bans = rankBanSuggestions([
      {
        heroId: "likely",
        heroName: "Mon héros",
        worstMatchups: [
          matchup({ heroId: "noisy", deltaWinrate: -0.5, smallSample: true }),
          matchup({ heroId: "solid", deltaWinrate: -0.1, smallSample: false }),
        ],
      },
    ]);
    expect(bans[0]?.heroId).toBe("solid");
  });

  test("collapses the same opponent seen through several likely heroes to its worst entry", () => {
    const bans = rankBanSuggestions([
      { heroId: "a", heroName: "A", worstMatchups: [matchup({ heroId: "x", deltaWinrate: -0.05, gamesPlayed: 30 })] },
      { heroId: "b", heroName: "B", worstMatchups: [matchup({ heroId: "x", deltaWinrate: -0.3, gamesPlayed: 8 })] },
    ]);
    expect(bans).toHaveLength(1);
    expect(bans[0]).toMatchObject({ heroId: "x", deltaWinrate: -0.3, gamesPlayed: 8, counteredHeroId: "b" });
  });

  test("caps the list at the requested limit", () => {
    const group = {
      heroId: "a",
      heroName: "A",
      worstMatchups: [matchup({ heroId: "x" }), matchup({ heroId: "y" }), matchup({ heroId: "z" })],
    };
    expect(rankBanSuggestions([group], 2)).toHaveLength(2);
  });
});
~~~

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --filter './apps/web' test apps/web/app/utils/draftAssist.test.ts`
Expected: FAIL — `rankBanSuggestions` is not exported.

- [ ] **Step 3: Write the minimal implementation**

Add to `apps/web/app/utils/draftAssist.ts`:

~~~ts
/** How many ban suggestions the panel shows. */
export const DRAFT_ASSIST_MAX_BANS = 2;

export interface MatchupCandidateInput {
  heroId: string;
  heroName: string;
  heroRole: string | null;
  gamesPlayed: number;
  winrate: number;
  /** This matchup's winrate minus the likely hero's own baseline. */
  deltaWinrate: number;
  smallSample: boolean;
}

export interface LikelyHeroMatchups {
  heroId: string;
  heroName: string;
  worstMatchups: MatchupCandidateInput[];
}

export interface BanSuggestion {
  heroId: string;
  heroName: string;
  heroRole: string | null;
  gamesPlayed: number;
  winrate: number;
  deltaWinrate: number;
  smallSample: boolean;
  counteredHeroId: string;
  counteredHeroName: string;
}

/**
 * One ban candidate per opponent hero, taken from the viewer's worst matchups
 * over their likely picks. deltaWinrate is the drop versus the likely hero's
 * own baseline, so the most negative value is the biggest threat. The same
 * opponent seen through several likely heroes collapses to its worst entry.
 * Confident entries rank first; a flagged one only leads when nothing
 * confident is available.
 */
export function rankBanSuggestions(
  groups: LikelyHeroMatchups[],
  limit = DRAFT_ASSIST_MAX_BANS,
): BanSuggestion[] {
  const byOpponent = new Map<string, BanSuggestion>();
  for (const group of groups) {
    for (const found of group.worstMatchups) {
      const existing = byOpponent.get(found.heroId);
      if (!existing || found.deltaWinrate < existing.deltaWinrate) {
        byOpponent.set(found.heroId, {
          heroId: found.heroId,
          heroName: found.heroName,
          heroRole: found.heroRole,
          gamesPlayed: found.gamesPlayed,
          winrate: found.winrate,
          deltaWinrate: found.deltaWinrate,
          smallSample: found.smallSample,
          counteredHeroId: group.heroId,
          counteredHeroName: group.heroName,
        });
      }
    }
  }

  const suggestions = [...byOpponent.values()];
  suggestions.sort(
    (a, b) =>
      Number(a.smallSample) - Number(b.smallSample) ||
      a.deltaWinrate - b.deltaWinrate ||
      b.gamesPlayed - a.gamesPlayed ||
      a.heroName.localeCompare(b.heroName),
  );

  return suggestions.slice(0, Math.max(0, limit));
}
~~~

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --filter './apps/web' test apps/web/app/utils/draftAssist.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

~~~bash
git add apps/web/app/utils/draftAssist.ts apps/web/app/utils/draftAssist.test.ts
git commit -m "feat(web): rank draft ban suggestions from worst matchups"
~~~

---

### Task 5: The draft-assist panel

**Files:**
- Create: `apps/web/app/components/draft/DraftAssistPanel.vue`
- Modify: `apps/web/app/pages/draft/index.vue`

**Interfaces:**
- Consumes: `summarizeComposition`, `rankPickSuggestions`, `rankBanSuggestions`, `DRAFT_ASSIST_MAX_PICKS`, `DRAFT_ASSIST_MAX_LIKELY_HEROES`, `DRAFT_ASSIST_MAX_BANS`, `LikelyHeroMatchups` (Tasks 2-4); `useAsyncResource`; `HeroStats` / `HeroMatchupsResponse` from `~/types/analytics`; `isMine` from `~/utils/myAccounts`; `winrateTone` / `TONE_TEXT_CLASS` from `~/utils/tone`; auto-imported `formatHeroRole`, `formatPercent`, `formatSignedPercent`, `HeroesHeroAvatar`, `UiStateCard`.
- Produces: `<DraftAssistPanel>` mounted once in `pages/draft/index.vue`.

No unit test: the panel is presentational wiring over the pure functions tested in Tasks 2-4. Its states are verified by the gate (typecheck + web suite) and by the acceptance walkthrough in Task 6.

- [ ] **Step 1: Create the component**

Create `apps/web/app/components/draft/DraftAssistPanel.vue`:

~~~vue
<script setup lang="ts">
import type { DraftPlayerSlot } from "@hots-stats/shared-types";
import type { HeroMatchupsResponse, HeroStats } from "~/types/analytics";
import {
  DRAFT_ASSIST_MAX_BANS,
  DRAFT_ASSIST_MAX_LIKELY_HEROES,
  DRAFT_ASSIST_MAX_PICKS,
  rankBanSuggestions,
  rankPickSuggestions,
  summarizeComposition,
  type LikelyHeroMatchups,
} from "~/utils/draftAssist";
import { isMine } from "~/utils/myAccounts";
import { TONE_TEXT_CLASS, winrateTone } from "~/utils/tone";

const props = defineProps<{
  /** The two teams *after* the page's client-side pseudo overrides are applied. */
  teamLeft: DraftPlayerSlot[];
  teamRight: DraftPlayerSlot[];
  /** Resolved battleground id; null while the OCR read has no known match. */
  mapId: string | null;
  /** Every BattleTag the viewer owns -- the same Set the team columns use. */
  ownBattletags: Set<string>;
  /** Whether a snapshot exists at all, to distinguish "no draft" from "draft, no map". */
  hasSnapshot: boolean;
}>();

const config = useRuntimeConfig();

// The team the viewer is on. Empty while their own slot is unresolved --
// "your composition" has no meaning until we know which side is yours.
const ownTeam = computed<DraftPlayerSlot[]>(() => {
  if (props.ownBattletags.size === 0) return [];
  const isLeft = props.teamLeft.some((slot) => isMine(slot.effectiveBattletag, props.ownBattletags));
  const isRight = props.teamRight.some((slot) => isMine(slot.effectiveBattletag, props.ownBattletags));
  // Unknown, or (impossible) on both sides: refuse to guess a side.
  if (isLeft === isRight) return [];
  return isLeft ? props.teamLeft : props.teamRight;
});

const composition = computed(() => summarizeComposition(ownTeam.value));
const takenRoles = computed(() => ownTeam.value.map((slot) => slot.heroRole));

// Refetch the pick pool only when the map or the *roles* already picked on the
// viewer's team change: rebuilding the array reference on every SSE push must
// not flash the panel back to its spinner (same guard as DraftTeamThreats).
const picksKey = computed(() =>
  props.mapId && composition.value.resolved > 0
    ? props.mapId + "|" + takenRoles.value.map((role) => role ?? "-").join(",")
    : "",
);

const {
  data: mapHeroes,
  pending: picksPending,
  errored: picksErrored,
} = useAsyncResource<HeroStats[]>({
  fetcher: async () => {
    if (!picksKey.value || !props.mapId) return [];
    const res = await $fetch<{ heroes: HeroStats[] }>("/heroes", {
      baseURL: config.public.apiBase,
      credentials: "include",
      // Personal only: these are the viewer's own picks, whatever their
      // persisted heroStatsScope says.
      query: { scope: "personal", mapId: props.mapId },
    });
    return res.heroes;
  },
  watch: () => picksKey.value,
});

const pickSuggestions = computed(() =>
  rankPickSuggestions(mapHeroes.value ?? [], takenRoles.value, DRAFT_ASSIST_MAX_PICKS),
);

// Ban search runs off the top pick suggestions: each one costs a
// /heroes/:heroId/matchups call, so the count is capped.
const likelyHeroes = computed(() => pickSuggestions.value.slice(0, DRAFT_ASSIST_MAX_LIKELY_HEROES));
const bansKey = computed(() => likelyHeroes.value.map((hero) => hero.heroId).join(","));

const {
  data: matchupGroups,
  pending: bansPending,
  errored: bansErrored,
} = useAsyncResource<LikelyHeroMatchups[]>({
  fetcher: async () => {
    if (likelyHeroes.value.length === 0) return [];
    return Promise.all(
      likelyHeroes.value.map(async (hero) => {
        const res = await $fetch<HeroMatchupsResponse>(
          "/heroes/" + encodeURIComponent(hero.heroId) + "/matchups",
          {
            baseURL: config.public.apiBase,
            credentials: "include",
            query: { scope: "personal" },
          },
        );
        return { heroId: hero.heroId, heroName: hero.heroName, worstMatchups: res.worstMatchups };
      }),
    );
  },
  watch: () => bansKey.value,
});

const banSuggestions = computed(() => rankBanSuggestions(matchupGroups.value ?? [], DRAFT_ASSIST_MAX_BANS));

const waitingMessage = computed(() => {
  if (!props.hasSnapshot) return "En attente d'une draft capturée.";
  if (ownTeam.value.length === 0) return "En attente de ton pseudo dans la draft.";
  if (composition.value.resolved === 0) return "En attente des héros de ton équipe (lecture OCR).";
  if (!props.mapId) return "Carte non reconnue : suggestions de pick indisponibles.";
  return null;
});
</script>

<template>
  <div class="rounded-lg border border-border bg-surface p-3">
    <div class="mb-2 flex items-center gap-2">
      <UIcon name="i-heroicons-sparkles" class="h-4 w-4 text-muted" />
      <h2 class="text-xs font-medium uppercase tracking-wide text-muted">Aide au draft</h2>
    </div>

    <p v-if="waitingMessage" class="py-1 text-xs text-muted">{{ waitingMessage }}</p>

    <template v-else>
      <div class="flex flex-wrap items-center gap-1.5">
        <span
          v-for="role in composition.counts"
          :key="role.role"
          class="rounded-full bg-background px-2 py-0.5 text-[11px]"
        >
          {{ formatHeroRole(role.role) }} ×{{ role.count }}
        </span>
        <span v-if="composition.partial" class="text-[11px] text-muted">
          {{ composition.resolved }}/{{ composition.total }} héros reconnus
        </span>
      </div>

      <ul v-if="composition.warnings.length" class="mt-1.5 space-y-0.5">
        <li
          v-for="warning in composition.warnings"
          :key="warning.kind"
          class="flex items-center gap-1.5 text-[11px] text-danger"
        >
          <UIcon name="i-heroicons-exclamation-triangle" class="h-3 w-3 shrink-0" />
          {{ warning.message }}
        </li>
      </ul>

      <div class="mt-2.5">
        <h3 class="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Picks suggérés</h3>
        <UiStateCard v-if="picksPending && !mapHeroes" state="loading" size="sm" />
        <p v-else-if="picksErrored" class="py-1 text-xs text-danger">
          Impossible de charger tes héros sur cette carte.
        </p>
        <p v-else-if="pickSuggestions.length === 0" class="py-1 text-xs text-muted">
          Pas assez de parties à toi sur cette carte.
        </p>
        <div v-else class="flex flex-wrap gap-2">
          <div
            v-for="pick in pickSuggestions"
            :key="pick.heroId"
            class="flex min-w-[8rem] flex-1 items-center gap-2 rounded-md border border-border px-2 py-1.5"
          >
            <HeroesHeroAvatar :hero-id="pick.heroId" :name="pick.heroName" :role="pick.heroRole" :size="24" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">{{ pick.heroName }}</p>
              <p class="text-[10px] text-muted">
                {{ pick.gamesPlayed }} partie{{ pick.gamesPlayed > 1 ? "s" : "" }} ·
                <span :class="TONE_TEXT_CLASS[winrateTone(pick.winrate)]">{{ formatPercent(pick.winrate) }}</span>
                <span v-if="pick.smallSample"> · échantillon faible</span>
              </p>
            </div>
          </div>
        </div>

        <template v-if="pickSuggestions.length > 0">
          <h3 class="mb-1 mt-2 text-[11px] font-medium uppercase tracking-wide text-muted">Bans suggérés</h3>
          <UiStateCard v-if="bansPending && !matchupGroups" state="loading" size="sm" />
          <p v-else-if="bansErrored" class="py-1 text-xs text-danger">
            Impossible de charger tes pires matchups.
          </p>
          <p v-else-if="banSuggestions.length === 0" class="py-1 text-xs text-muted">
            Aucun adversaire ne se détache nettement.
          </p>
          <div v-else class="flex flex-wrap gap-2">
            <div
              v-for="ban in banSuggestions"
              :key="ban.heroId"
              class="flex min-w-[9rem] flex-1 items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5"
            >
              <HeroesHeroAvatar :hero-id="ban.heroId" :name="ban.heroName" :role="ban.heroRole" :size="24" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm">{{ ban.heroName }}</p>
                <p class="text-[10px] text-muted">
                  contre {{ ban.counteredHeroName }} ·
                  <span :class="TONE_TEXT_CLASS[winrateTone(ban.deltaWinrate, 0)]">
                    {{ formatSignedPercent(ban.deltaWinrate) }}
                  </span>
                  · {{ ban.gamesPlayed }} partie{{ ban.gamesPlayed > 1 ? "s" : "" }}
                  <span v-if="ban.smallSample"> · échantillon faible</span>
                </p>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
~~~

- [ ] **Step 2: Mount it once, full width**

In `apps/web/app/pages/draft/index.vue`, inside the `<template v-else>` just after the `capturedAgoLabel` paragraph, add:

~~~vue
      <!-- Composition/picks/bans for the viewer's own team. One instance only:
           it fires its own one-shot fetches, so the CSS-hidden mobile/desktop
           duplication used for DraftTeamThreats would double them. -->
      <DraftAssistPanel
        class="max-h-44 shrink-0 overflow-y-auto"
        :team-left="teamLeft"
        :team-right="teamRight"
        :map-id="snapshot.mapId"
        :own-battletags="ownBattletags"
        :has-snapshot="true"
      />
~~~

Then make room for it by adding 12rem to both container offsets (the panel's 11rem max height plus the root's 1rem gap):

- Mobile container: `style="height: calc(100dvh - 19rem)"` becomes `style="height: calc(100dvh - 31rem)"`.
- Desktop container: `style="height: calc(100dvh - 13rem)"` becomes `style="height: calc(100dvh - 25rem)"`.

- [ ] **Step 3: Verify**

Run: `bun run typecheck`
Expected: PASS (the new component props and imports resolve).

Run: `bun run --filter './apps/web' test`
Expected: PASS (15 draftAssist tests + the existing suite).

- [ ] **Step 4: Commit**

~~~bash
git add apps/web/app/components/draft/DraftAssistPanel.vue apps/web/app/pages/draft/index.vue
git commit -m "feat(web): show the draft-assist panel on /draft"
~~~

---

### Task 6: Roadmap, README, full gate

**Files:**
- Modify: `tasks/progression-roadmap.md`
- Modify: `tasks/README.md`

- [ ] **Step 1: Run the full verification gate**

~~~bash
bun run typecheck
bun test packages/shared-types
bun test apps/api
bun run --filter './apps/web' test
~~~

Expected: all PASS. The daemon is untouched (`cd daemon-python && pytest -q` not required, but harmless to run).

- [ ] **Step 2: Tick the roadmap**

In `tasks/progression-roadmap.md`, change the D1 line to `- [x] **D1 — Aide au draft** · dépend de D0` and append a `**Fait** (2026-09-19). Écarts / précisions vs spec :` block covering:

- the composition alert warns on a fully resolved team for absences (no healer / no tank) and at ≥3 assassins on any read;
- `heroRole` was added to the in-memory `DraftPlayerSlot` (additive, no migration) so composition needs no extra fetch;
- pick suggestions rank confident heroes first, then Wilson bound, minus a contested-role penalty;
- bans come from the top-3 pick candidates' `worstMatchups`, collapsed per opponent;
- the panel is mounted once (not per responsive block) to avoid duplicate fetches.

- [ ] **Step 3: Add the one-line README entry**

In `tasks/README.md` "Déjà fait", add:

~~~markdown
- **Suite Progression — D1 (aide au draft)** : alerte de composition de ton
  équipe (rôles résolus portés par le snapshot, absence de soigneur/tank
  annoncée seulement si les 5 héros sont lus, ≥3 assassins), suggestions de
  pick classées par borne inférieure de Wilson moins une pénalité de rôle déjà
  pris, bans issus des pires matchups des 3 meilleurs picks. Aucune nouvelle
  route, aucune migration, aucune dépendance ; la carte/les héros non résolus
  affichent un état d'attente.
~~~

- [ ] **Step 4: Commit and push**

~~~bash
git add tasks/progression-roadmap.md tasks/README.md
git commit -m "docs(tasks): record the D1 draft-assist chantier"
git push origin main
~~~

Push only if Step 1 is entirely green.

---

## Self-review

**Spec coverage (D1):**

| Spec requirement | Task |
|---|---|
| Composition alert on the viewer's own team, warns on "aucun soigneur" / "3 assassins" | 2 (rules) + 5 (render) |
| Pick suggestion ranked by personal winrate + Wilson lower bound, down-weighted by contested role, reuses `/heroes?scope=personal&mapId=` | 3 (ranking) + 5 (fetch) |
| Ban suggestion from `worstMatchups` across the viewer's likely heroes | 4 (ranking) + 5 (fetch) |
| Unresolved heroes → waiting state, no pick list | 5 (`waitingMessage`) |
| No suggestion without its `n` | 5 (renders `gamesPlayed`) |
| No new polling loop, reuse `useDraftStream` | 5 (one-shot `useAsyncResource` keyed to the snapshot; the page keeps `useDraftStream`) |
| Acceptance 2 (rules exactly as documented) | 2 (tests: 2 vs 3 assassins, full vs partial team) |
| Acceptance 3 (every suggestion shows its games count) | 3/4 carry `gamesPlayed`, 5 renders it |

**Type consistency:** `summarizeComposition` takes `Array<{ heroRole: string | null }>`, which `DraftPlayerSlot[]` satisfies. `rankPickSuggestions` takes `PickCandidateInput[]`; `HeroStats` carries every field plus extras (structural typing allows the extra `normalized`). `rankBanSuggestions` takes `LikelyHeroMatchups[]` whose `worstMatchups` are `HeroMatchupEntry` subsets — `banSuggestions` is built from `LikelyHeroMatchups` built from the `worstMatchups` of `HeroMatchupsResponse`.

**Placeholder scan:** none — every step carries its code or its exact edit.

---

## Execution notes (2026-09-19)

- The panel is mounted once, full-width, with its natural height: the two
  responsive containers keep their original `calc(100dvh - 19rem)` /
  `calc(100dvh - 13rem)` heights, so the page scrolls by the panel's height
  instead of compressing the existing draft area.
- The `hasSnapshot` prop proposed in Task 5 was dropped: the panel only ever
  renders inside the page's snapshot branch, so the prop was always `true`.
- `DRAFT_ASSIST_TEAM_SIZE` was dropped: `CompositionSummary.total` already
  carries the team size from the slot array.
