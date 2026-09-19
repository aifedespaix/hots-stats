# E1 — Récap de session (GET /stats/session) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ajouter `GET /stats/session` (récap de la dernière session, ou de la session à une date donnée), une page `/session` et brancher la carte « Dernière session » du Dashboard dessus.

**Architecture:** Le calcul (sélection de session via le clustering 90 min partagé C4, stats de session, baseline, deltas) vit dans un module pur sans DB `apps/api/src/lib/session-recap.ts`, donc testable sans `DATABASE_URL`. Un service mince `session.service.ts` scope/filtre/assemble les lignes (`resolveSubject` + `scopeConditions`) et délègue au module pur. La route vit sur `statsRoute` (session-auth). Les contrats partagés sont dans `packages/shared-types/src/stats.ts`. Côté web, un composable `useSessionRecap`, une page `pages/session.vue`, et la carte du Dashboard consomme la réponse de l'endpoint (l'utilitaire client `sessionSummary.ts`, devenu un doublon du serveur, est supprimé).

**Tech Stack:** TypeScript, bun:test (shared-types, api), Vitest (web), Drizzle ORM, Hono, Zod, Nuxt 3.

**Spec:** docs/superpowers/specs/2026-09-18-player-progression-design.md (section « E1 — Session recap »).

## Global Constraints

- UI en français, identifiants et commentaires en anglais.
- N'invente aucune donnée : seuls des champs stockés (matchId, playedAt, winner, durationSeconds, kills, deaths, assists, experienceContribution, heroId/heroName, mapId/mapName). Pas de MMR/rang, pas d'objectif de carte, pas de timer de résurrection simulé.
- Toute requête personnelle passe par `accountScope`/`scopeConditions`, jamais `eq(matchPlayers.userId, ...)`. Le sujet de chaque partie est résolu par `resolveSubject` (règle partagée A1).
- La frontière de session est le clustering 90 min partagé : `clusterSessions` de `packages/shared-types/src/sessions.ts`, jamais une réimplémentation.
- Les taux sont pondérés par la durée : on réutilise `computePeriodStats` (A3/A2), jamais une moyenne de ratios par partie.
- Aucun échantillon ne conclut sous `PROGRESSION_MIN_MATCHES` (20) : les deltas sont null et `insufficientSample` vaut true.
- Une partie sans mort => KDA null, jamais Infinity. Une session d'une partie ne divise pas par zéro.
- `scope=global` refusé en 400 (même règle que /patterns, /trend, /drivers, /context, /killers) : « ma session versus ma moyenne » n'a pas de sujet communautaire.
- Purement additif : aucune migration, aucun DROP/RENAME, aucun endpoint existant modifié dans ses valeurs.
- États vides/erreur via `UiStateCard` ; ce qui est livré est atteignable depuis la navigation.
- Aucune nouvelle dépendance.

## File Structure

- Modify `packages/shared-types/src/stats.ts` — contrats E1 (SessionRecapMatch/Stats/BaselineDelta/Recap/Response).
- Create `apps/api/src/lib/session-recap.ts` — logique pure (sélection, stats, baseline, deltas).
- Create `apps/api/src/lib/session-recap.test.ts` — goldens des règles ci-dessus.
- Create `apps/api/src/services/session.service.ts` — scoping/filtrage/assemblage DB.
- Modify `apps/api/src/routes/stats.ts` — `GET /stats/session`.
- Create `apps/web/app/composables/useSessionRecap.ts` — fetch partagé.
- Create `apps/web/app/utils/sessionDisplay.ts` + `sessionDisplay.test.ts` — règle d'affichage des deltas (ton directionnel, signe).
- Modify `apps/web/app/components/progress/SessionSummaryCard.vue` — consomme `SessionRecapResponse`.
- Modify `apps/web/app/pages/index.vue` — appelle `/stats/session` et passe le récap à la carte ; carte de nav `/session`.
- Create `apps/web/app/pages/session.vue` — page `/session`.
- Modify `apps/web/app/layouts/default.vue` — entrée sidebar.
- Delete `apps/web/app/utils/sessionSummary.ts` + `sessionSummary.test.ts` — remplacés par le serveur.
- Modify `tasks/progression-roadmap.md`, `tasks/README.md` — marqueurs de fin.

---

### Task 1: Shared contracts

**Files:**
- Modify: `packages/shared-types/src/stats.ts` (append at end)
- Test: `apps/api/src/lib/session-recap.test.ts` (compilation)

**Interfaces:**
- Produces: `SessionRecapMatch`, `SessionRecapStats`, `SessionBaselineDelta`, `SessionRecap`, `SessionRecapResponse`.

- [ ] **Step 1: Append the E1 contracts to packages/shared-types/src/stats.ts**

```ts
// --- Player progression suite (E1 — Session recap) ---

/** One match inside a session recap (E1). Hero and map names are resolved at
 * the DB boundary so the recap renders without a second round-trip. */
export interface SessionRecapMatch {
  matchId: string;
  /** ISO datetime. */
  playedAt: string;
  winner: boolean;
  durationSeconds: number;
  heroId: string;
  heroName: string;
  mapId: string;
  mapName: string;
  kills: number;
  deaths: number;
  assists: number;
}

/** Record plus duration-weighted rates over one match set (E1). The rates reuse
 * the A2 rule; kda is null when the set has no death (never Infinity). */
export interface SessionRecapStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winrate: number;
  kda: number | null;
  deathsPer10Min: number;
  xpPerMinute: number;
}

/** Session-minus-baseline deltas (E1). kda is null when either side has no
 * death, so a delta is never fabricated from a missing ratio. */
export interface SessionBaselineDelta {
  winrate: number;
  kda: number | null;
  deathsPer10Min: number;
  xpPerMinute: number;
}

/** The selected session, oldest match first. */
export interface SessionRecap {
  /** ISO datetime of the first match. */
  startedAt: string;
  /** ISO datetime of the last match. */
  endedAt: string;
  matches: SessionRecapMatch[];
  stats: SessionRecapStats;
}

/** Response for GET /stats/session (E1). session is null when the scope has no
 * match at or after the requested at (or no match at all). baselineDelta is
 * null until the session AND its baseline each clear PROGRESSION_MIN_MATCHES,
 * so the endpoint never claims a trend on a thin sample; insufficientSample
 * carries that gate for the UI. */
export interface SessionRecapResponse {
  scope: "personal" | "global";
  session: SessionRecap | null;
  /** One row per pre-session scope match, or null with no session. */
  baseline: SessionRecapStats | null;
  baselineDelta: SessionBaselineDelta | null;
  insufficientSample: boolean;
}
```

- [ ] **Step 2: Typecheck the package**

Run: `bun run --filter './packages/shared-types' typecheck`
Expected: PASS (no output errors).

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/stats.ts
git commit -m "feat(shared-types): add the E1 session-recap contracts"
```

---

### Task 2: Pure recap module + tests

**Files:**
- Create: `apps/api/src/lib/session-recap.ts`
- Test: `apps/api/src/lib/session-recap.test.ts`

**Interfaces:**
- Consumes: `SessionRecapResponse` etc. (Task 1); `clusterSessions` (shared-types/sessions); `computePeriodStats`, `TrendMatchInput` (`./trend-series`); `PROGRESSION_MIN_MATCHES`.
- Produces: `SessionMatchInput`, `SessionRecapCore`, `computeSessionStats`, `selectSession`, `buildSessionRecap`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { PROGRESSION_MIN_MATCHES } from "@hots-stats/shared-types";
import { buildSessionRecap, type SessionMatchInput } from "./session-recap";

function match(
  overrides: Partial<SessionMatchInput> & { matchId: string; playedAt: string },
): SessionMatchInput {
  return {
    winner: true,
    durationSeconds: 1200,
    kills: 5,
    deaths: 1,
    assists: 3,
    experienceContribution: 10000,
    gameVersion: "2.55.0",
    heroId: "li-ming",
    heroName: "Li-Ming",
    mapId: "cursed-hollow",
    mapName: "Bois maudit",
    ...overrides,
  };
}

/** n matches 15 minutes apart, all inside a single session. */
function block(startIso: string, count: number, prefix: string, winner = true): SessionMatchInput[] {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, index) =>
    match({
      matchId: prefix + index,
      playedAt: new Date(start + index * 15 * 60_000).toISOString(),
      winner,
    }),
  );
}

describe("buildSessionRecap", () => {
  test("uses the shared 90-minute clustering: 89 minutes apart is one session", () => {
    const recap = buildSessionRecap([
      match({ matchId: "a", playedAt: "2026-09-01T20:00:00.000Z" }),
      match({ matchId: "b", playedAt: "2026-09-01T21:29:00.000Z" }),
    ]);
    expect(recap.session?.matches.map((entry) => entry.matchId)).toEqual(["a", "b"]);
  });

  test("uses the shared 90-minute clustering: 91 minutes apart is two sessions", () => {
    const recap = buildSessionRecap([
      match({ matchId: "a", playedAt: "2026-09-01T20:00:00.000Z" }),
      match({ matchId: "b", playedAt: "2026-09-01T21:31:00.000Z" }),
    ]);
    expect(recap.session?.matches.map((entry) => entry.matchId)).toEqual(["b"]);
  });

  test("returns a null session with no match", () => {
    const recap = buildSessionRecap([]);
    expect(recap.session).toBeNull();
    expect(recap.baseline).toBeNull();
    expect(recap.baselineDelta).toBeNull();
    expect(recap.insufficientSample).toBe(true);
  });

  test("selects the last session starting at or before at", () => {
    const recap = buildSessionRecap(
      [
        match({ matchId: "a", playedAt: "2026-09-01T20:00:00.000Z" }),
        match({ matchId: "b", playedAt: "2026-09-02T20:00:00.000Z" }),
      ],
      "2026-09-01T22:00:00.000Z",
    );
    expect(recap.session?.matches.map((entry) => entry.matchId)).toEqual(["a"]);
  });

  test("a timestamp before the first match selects no session", () => {
    const recap = buildSessionRecap(
      [match({ matchId: "a", playedAt: "2026-09-01T20:00:00.000Z" })],
      "2026-08-01T00:00:00.000Z",
    );
    expect(recap.session).toBeNull();
  });

  test("a one-match session renders without division by zero and without a trend claim", () => {
    const recap = buildSessionRecap([
      match({ matchId: "solo", playedAt: "2026-09-01T20:00:00.000Z", winner: false }),
    ]);
    expect(recap.session?.stats).toMatchObject({
      gamesPlayed: 1,
      wins: 0,
      losses: 1,
      winrate: 0,
      kda: null,
    });
    expect(recap.baselineDelta).toBeNull();
    expect(recap.insufficientSample).toBe(true);
  });

  test("the baseline excludes the session's own matches", () => {
    const baseline = block("2026-09-01T10:00:00.000Z", 4, "b");
    const session = block("2026-09-02T20:00:00.000Z", 2, "s");
    const recap = buildSessionRecap([...baseline, ...session]);
    expect(recap.session?.matches).toHaveLength(2);
    expect(recap.baseline).toMatchObject({ gamesPlayed: 4, wins: 4 });
  });

  test("baselineDelta is null below PROGRESSION_MIN_MATCHES on either side", () => {
    const baseline = block("2026-09-01T10:00:00.000Z", PROGRESSION_MIN_MATCHES, "b");
    const session = block("2026-09-02T20:00:00.000Z", PROGRESSION_MIN_MATCHES - 1, "s");
    const recap = buildSessionRecap([...baseline, ...session]);
    expect(recap.insufficientSample).toBe(true);
    expect(recap.baselineDelta).toBeNull();
  });

  test("baselineDelta is exposed once both sides clear the gate", () => {
    const baseline = block("2026-09-01T10:00:00.000Z", PROGRESSION_MIN_MATCHES, "b", false);
    const session = block("2026-09-02T20:00:00.000Z", PROGRESSION_MIN_MATCHES, "s", true);
    const recap = buildSessionRecap([...baseline, ...session]);
    expect(recap.insufficientSample).toBe(false);
    expect(recap.baselineDelta?.winrate).toBeCloseTo(1);
  });

  test("kda delta is null when either side has no death", () => {
    const baseline = block("2026-09-01T10:00:00.000Z", PROGRESSION_MIN_MATCHES, "b").map((entry) => ({
      ...entry,
      deaths: 0,
    }));
    const session = block("2026-09-02T20:00:00.000Z", PROGRESSION_MIN_MATCHES, "s").map((entry) => ({
      ...entry,
      deaths: 2,
    }));
    const recap = buildSessionRecap([...baseline, ...session]);
    expect(recap.session?.stats.kda).not.toBeNull();
    expect(recap.baseline?.kda).toBeNull();
    expect(recap.baselineDelta?.kda).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/src/lib/session-recap.test.ts`
Expected: FAIL — Cannot find module './session-recap'.

- [ ] **Step 3: Write the minimal implementation**

```ts
import {
  PROGRESSION_MIN_MATCHES,
  clusterSessions,
  type SessionBaselineDelta,
  type SessionRecap,
  type SessionRecapResponse,
  type SessionRecapStats,
} from "@hots-stats/shared-types";
import { computePeriodStats, type TrendMatchInput } from "./trend-series";

/** One scope-resolved match feeding the E1 recap. Extends the A3 trend input so
 * the duration-weighted rate rule (A2) is reused rather than re-implemented. */
export interface SessionMatchInput extends TrendMatchInput {
  heroId: string;
  heroName: string;
  mapId: string;
  mapName: string;
}

/** Everything the pure module decides; the service stamps scope. */
export type SessionRecapCore = Omit<SessionRecapResponse, "scope">;

function chronological(matches: SessionMatchInput[]): SessionMatchInput[] {
  return [...matches].sort(
    (a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt) || a.matchId.localeCompare(b.matchId),
  );
}

/** Record + duration-weighted rates over one match set, built on the A3 period
 * rule so E1 and the trend cannot disagree. */
export function computeSessionStats(matches: SessionMatchInput[]): SessionRecapStats {
  const period = computePeriodStats(matches);
  const wins = matches.filter((entry) => entry.winner).length;
  return {
    gamesPlayed: period.gamesPlayed,
    wins,
    losses: period.gamesPlayed - wins,
    winrate: period.winrate,
    kda: period.kda,
    deathsPer10Min: period.deathsPer10Min,
    xpPerMinute: period.xpPerMinute,
  };
}

/**
 * Picks the session to recap. With no at, the most recent session. With an at,
 * the last session that started at or before it; a timestamp before the first
 * match has no session (null). sessions is oldest-first, as returned by the
 * shared clusterSessions, so the 90-minute boundary is the single C4 rule.
 */
export function selectSession(
  sessions: SessionMatchInput[][],
  at?: string,
): SessionMatchInput[] | null {
  if (sessions.length === 0) return null;
  if (!at) return sessions[sessions.length - 1] ?? null;
  const boundary = Date.parse(at);
  let chosen: SessionMatchInput[] | null = null;
  for (const session of sessions) {
    const first = session[0];
    if (!first || Date.parse(first.playedAt) > boundary) break;
    chosen = session;
  }
  return chosen;
}

function computeDelta(
  current: SessionRecapStats,
  baseline: SessionRecapStats,
): SessionBaselineDelta {
  return {
    winrate: current.winrate - baseline.winrate,
    kda: current.kda !== null && baseline.kda !== null ? current.kda - baseline.kda : null,
    deathsPer10Min: current.deathsPer10Min - baseline.deathsPer10Min,
    xpPerMinute: current.xpPerMinute - baseline.xpPerMinute,
  };
}

function buildSession(matches: SessionMatchInput[], stats: SessionRecapStats): SessionRecap {
  const first = matches[0]!;
  const last = matches[matches.length - 1]!;
  return {
    startedAt: first.playedAt,
    endedAt: last.playedAt,
    matches: matches.map((entry) => ({
      matchId: entry.matchId,
      playedAt: entry.playedAt,
      winner: entry.winner,
      durationSeconds: entry.durationSeconds,
      heroId: entry.heroId,
      heroName: entry.heroName,
      mapId: entry.mapId,
      mapName: entry.mapName,
      kills: entry.kills,
      deaths: entry.deaths,
      assists: entry.assists,
    })),
    stats,
  };
}

/**
 * Builds the E1 recap: the selected session, the player's baseline (every scope
 * match strictly before the session), and the deltas between them. The deltas
 * are exposed only when BOTH sides clear PROGRESSION_MIN_MATCHES, so the
 * endpoint never claims a trend on a thin sample.
 */
export function buildSessionRecap(matches: SessionMatchInput[], at?: string): SessionRecapCore {
  const ordered = chronological(matches);
  const session = selectSession(clusterSessions(ordered), at);
  if (!session) {
    return { session: null, baseline: null, baselineDelta: null, insufficientSample: true };
  }
  const sessionStart = Date.parse(session[0]!.playedAt);
  const baselineMatches = ordered.filter((entry) => Date.parse(entry.playedAt) < sessionStart);
  const stats = computeSessionStats(session);
  const baseline = computeSessionStats(baselineMatches);
  const sufficientSample =
    stats.gamesPlayed >= PROGRESSION_MIN_MATCHES &&
    baseline.gamesPlayed >= PROGRESSION_MIN_MATCHES;
  return {
    session: buildSession(session, stats),
    baseline,
    baselineDelta: sufficientSample ? computeDelta(stats, baseline) : null,
    insufficientSample: !sufficientSample,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test apps/api/src/lib/session-recap.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/session-recap.ts apps/api/src/lib/session-recap.test.ts
git commit -m "feat(api): aggregate the E1 session recap in a pure module"
```

---

### Task 3: DB service

**Files:**
- Create: `apps/api/src/services/session.service.ts`

**Interfaces:**
- Consumes: `buildSessionRecap`, `SessionMatchInput` (Task 2); `Scope`, `scopeConditions`, `resolveSubject`, `RosterPlayer`.
- Produces: `getSessionRecap(scope, filters): Promise<SessionRecapResponse>`, `SessionFilters`.

- [ ] **Step 1: Write the service**

```ts
import { db, heroes, maps, matchPlayers, matches } from "@hots-stats/db";
import type { GameMode, SessionRecapResponse } from "@hots-stats/shared-types";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type Scope, scopeConditions } from "../lib/account-selection";
import { type RosterPlayer, resolveSubject } from "../lib/pattern-aggregate";
import { buildSessionRecap, type SessionMatchInput } from "../lib/session-recap";

export interface SessionFilters {
  mode?: GameMode[];
  /** ISO datetime; omitted = the most recent session. */
  at?: string;
}

/**
 * Builds the E1 session recap over every match the scope played, optionally
 * filtered by mode. The subject of each match is resolved with the same shared
 * rule as A1/A3/A4 (resolveSubject): the SQL scopeCondition already restricts
 * candidate rows to the caller's own battletags, so another user's match can
 * never be selected. This service only scopes, filters and assembles rows --
 * the session selection and stats maths are pure (see ../lib/session-recap.ts).
 */
export async function getSessionRecap(
  scope: Scope,
  filters: SessionFilters,
): Promise<SessionRecapResponse> {
  const conditions = scopeConditions([], scope, matchPlayers.battletag);
  if (filters.mode && filters.mode.length > 0) {
    conditions.push(inArray(matches.gameMode, filters.mode));
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
      heroId: matchPlayers.heroId,
      heroName: heroes.name,
      mapId: matches.mapId,
      mapName: maps.name,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .innerJoin(maps, eq(maps.id, matches.mapId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(matches.playedAt), asc(matchPlayers.matchId));

  const candidatesByMatch = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = candidatesByMatch.get(row.matchId) ?? [];
    list.push(row);
    candidatesByMatch.set(row.matchId, list);
  }

  const scopedBattletags = scope.mode === "personal" ? scope.battletags : [];
  const inputs: SessionMatchInput[] = [];
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
      heroId: row.heroId,
      heroName: row.heroName,
      mapId: row.mapId,
      mapName: row.mapName,
    });
  }

  return { scope: scope.mode, ...buildSessionRecap(inputs, filters.at) };
}
```

- [ ] **Step 2: Typecheck the API**

Run: `bun run --filter './apps/api' typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/session.service.ts
git commit -m "feat(api): scope and assemble the E1 session recap"
```

---

### Task 4: API route

**Files:**
- Modify: `apps/api/src/routes/stats.ts`

**Interfaces:**
- Consumes: `getSessionRecap` (Task 3).
- Produces: `GET /stats/session?scope=&accounts=&mode=&at=`.

- [ ] **Step 1: Add the import and the query schema**

After the `getKillers` import line, add:
```ts
import { getSessionRecap } from "../services/session.service";
```

After `killersQuerySchema` (before `export const statsRoute`), add:
```ts
const sessionQuerySchema = z.object({
  scope: heroStatsScopeSchema.optional(),
  accounts: accountsQuerySchema,
  mode: gameModeListSchema.optional(),
  at: z.string().datetime().optional(),
});
```

- [ ] **Step 2: Append the route to the chain**

Change the final `.get("/killers", ...);` terminator so the chain ends with:
```ts
  .get("/session", async (c) => {
    const parsed = sessionQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    // "My session versus my baseline" has no coherent community subject, so an
    // explicit global scope is refused rather than faked (same rule as
    // /patterns, /trend, /drivers, /context and /killers). An omitted scope
    // always falls back to the caller's own accounts.
    const scope = withStatsScope(c.get("scope"), parsed.data.scope ?? "personal");
    if (scope.mode === "global") {
      return c.json(
        { error: "Le récap de session n'est disponible que pour ton profil (scope=personal)." },
        400,
      );
    }

    return c.json(await getSessionRecap(scope, { mode: parsed.data.mode, at: parsed.data.at }));
  });
```

- [ ] **Step 3: Typecheck the API**

Run: `bun run --filter './apps/api' typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/stats.ts
git commit -m "feat(api): expose GET /stats/session"
```

---

### Task 5: Web — shared fetch, card rewire, remove duplicate

**Files:**
- Create: `apps/web/app/composables/useSessionRecap.ts`
- Create: `apps/web/app/utils/sessionDisplay.ts` + `sessionDisplay.test.ts`
- Modify: `apps/web/app/components/progress/SessionSummaryCard.vue`
- Modify: `apps/web/app/pages/index.vue`
- Delete: `apps/web/app/utils/sessionSummary.ts`, `apps/web/app/utils/sessionSummary.test.ts`

**Interfaces:**
- Consumes: `SessionRecapResponse`; `useApiFetch`; `Tone`, `winrateTone`, `TONE_TEXT_CLASS`.
- Produces: `useSessionRecap`, `deltaTone`, `formatSignedNumber`.

- [ ] **Step 1: Write the failing util test**

```ts
import { describe, expect, test } from "vitest";
import { deltaTone, formatSignedNumber } from "./sessionDisplay";

describe("deltaTone", () => {
  test("no movement or missing value is neutral", () => {
    expect(deltaTone(0, "higher")).toBe("default");
    expect(deltaTone(null, "lower")).toBe("default");
  });

  test("higher-is-better is green only when the delta is positive", () => {
    expect(deltaTone(0.1, "higher")).toBe("success");
    expect(deltaTone(-0.1, "higher")).toBe("danger");
  });

  test("lower-is-better (deaths) is green only when the delta is negative", () => {
    expect(deltaTone(-1.2, "lower")).toBe("success");
    expect(deltaTone(1.2, "lower")).toBe("danger");
  });
});

describe("formatSignedNumber", () => {
  test("always shows the sign of a rounded non-zero value", () => {
    expect(formatSignedNumber(1.44)).toBe("+1.4");
    expect(formatSignedNumber(-0.34)).toBe("-0.3");
  });

  test("does not print a negative zero", () => {
    expect(formatSignedNumber(-0.01)).toBe("0.0");
    expect(formatSignedNumber(0)).toBe("0.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter './apps/web' test app/utils/sessionDisplay.test.ts`
Expected: FAIL — Cannot find module './sessionDisplay'.

- [ ] **Step 3: Write the util**

```ts
import type { Tone } from "./tone";

/** Colour of a session-vs-baseline delta: green only when the metric moved in
 * the direction that is good for the player. betterWhen names that direction
 * explicitly, so a lower-is-better metric (deaths) is not coloured backwards. */
export function deltaTone(delta: number | null, betterWhen: "higher" | "lower"): Tone {
  if (delta === null || delta === 0) return "default";
  const improving = betterWhen === "higher" ? delta > 0 : delta < 0;
  return improving ? "success" : "danger";
}

/** Signed fixed-point value (e.g. "+1.4", "-0.3") for deltas that are not
 * percentages or KDA ratios. Avoids printing a negative zero. */
export function formatSignedNumber(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  return (rounded > 0 ? "+" : "") + rounded.toFixed(digits);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --filter './apps/web' test app/utils/sessionDisplay.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Create the fetch composable**

```ts
import type { SessionRecapResponse } from "@hots-stats/shared-types";

/**
 * The E1 session recap for the current viewer. Personal-only: GET
 * /stats/session refuses the global scope (see the API route), exactly like
 * /patterns, /trend, /drivers, /context and /killers. useApiFetch bakes the
 * active game-mode and account selection into the request.
 */
export function useSessionRecap(query?: ComputedRef<Record<string, unknown>>) {
  return useApiFetch<SessionRecapResponse>("/stats/session", { query });
}
```

- [ ] **Step 6: Rewrite SessionSummaryCard.vue to consume the endpoint**

```vue
<script setup lang="ts">
import { PROGRESSION_MIN_MATCHES, type SessionRecapResponse } from "@hots-stats/shared-types";

const props = withDefaults(
  defineProps<{ recap?: SessionRecapResponse | null; loading?: boolean; error?: boolean }>(),
  { recap: null, loading: false, error: false },
);

const session = computed(() => props.recap?.session ?? null);
const stats = computed(() => session.value?.stats ?? null);
const lastResult = computed(() =>
  session.value ? session.value.matches[session.value.matches.length - 1]?.winner : undefined,
);
const record = computed(() =>
  stats.value ? stats.value.wins + " V · " + stats.value.losses + " D" : "—",
);
const isEmpty = computed(() => !props.loading && !props.error && !session.value);
const recordTone = computed(() =>
  props.recap?.insufficientSample ? "default" : winrateTone(stats.value?.winrate),
);
</script>

<template>
  <UiPanel title="Dernière session" :count="stats?.gamesPlayed">
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
    <div v-else-if="session && stats" class="space-y-2">
      <div class="flex items-baseline gap-3">
        <span class="font-mono text-lg font-semibold" :class="TONE_TEXT_CLASS[recordTone]">
          {{ record }}
        </span>
        <span class="text-sm text-muted">
          {{ stats.gamesPlayed }} partie{{ stats.gamesPlayed > 1 ? "s" : "" }}
        </span>
      </div>
      <p class="text-sm text-muted">{{ formatDate(session.startedAt) }}</p>
      <p class="text-sm">
        Session terminée sur une {{ lastResult ? "victoire" : "défaite" }}.
      </p>
      <p v-if="recap?.insufficientSample" class="text-xs text-muted">
        Échantillon de {{ stats.gamesPlayed }} partie{{ stats.gamesPlayed > 1 ? "s" : "" }} — au
        moins {{ PROGRESSION_MIN_MATCHES }} sont nécessaires pour comparer à ta moyenne.
      </p>
      <UiArrowLink to="/session" class="text-xs">Voir le récap complet</UiArrowLink>
    </div>
  </UiPanel>
</template>
```

- [ ] **Step 7: Rewire the Dashboard**

In `apps/web/app/pages/index.vue`, add `SessionRecapResponse` to the `@hots-stats/shared-types` import, import `useSessionRecap`, then next to the existing `/stats/trend` fetch add:
```ts
// The "Dernière session" card now reads the E1 endpoint (GET /stats/session)
// instead of re-clustering the trend points client-side: one source of truth
// for the 90-minute rule. Not awaited, like the other additive B2 calls.
const {
  data: sessionRecap,
  pending: sessionPending,
  error: sessionError,
} = useSessionRecap({ scope: "personal" });
```

Replace the card usage with:
```vue
<ProgressSessionSummaryCard
  :recap="sessionRecap"
  :loading="sessionPending"
  :error="Boolean(sessionError)"
/>
```

- [ ] **Step 8: Delete the superseded client-side duplicate**

```bash
git rm apps/web/app/utils/sessionSummary.ts apps/web/app/utils/sessionSummary.test.ts
```

- [ ] **Step 9: Run the web tests and typecheck**

Run: `bun run --filter './apps/web' test`
Expected: PASS (sessionDisplay replaces the 4 removed sessionSummary tests).

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A apps/web/app/composables/useSessionRecap.ts apps/web/app/utils/sessionDisplay.ts apps/web/app/utils/sessionDisplay.test.ts apps/web/app/components/progress/SessionSummaryCard.vue apps/web/app/pages/index.vue
git commit -m "feat(web): feed the Dashboard session card from GET /stats/session"
```

---

### Task 6: Web — /session page + navigation

**Files:**
- Create: `apps/web/app/pages/session.vue`
- Modify: `apps/web/app/layouts/default.vue`
- Modify: `apps/web/app/pages/index.vue`

**Interfaces:**
- Consumes: `useSessionRecap`, `deltaTone`, `formatSignedNumber` (Task 5); `formatPercent`, `formatSignedPercent`, `formatSignedKda`, `formatDate`, `formatDuration`, `winrateTone`.

- [ ] **Step 1: Create the page**

```vue
<script setup lang="ts">
import { PROGRESSION_MIN_MATCHES } from "@hots-stats/shared-types";
import { useSessionRecap } from "~/composables/useSessionRecap";
import { deltaTone, formatSignedNumber } from "~/utils/sessionDisplay";

definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Récap de session",
  description:
    "Le bilan de ta dernière session Heroes of the Storm : record, écart à ta moyenne et détail des parties.",
  ogTitle: "Récap de session - HotS Analytics",
  ogDescription:
    "Le bilan de ta dernière session Heroes of the Storm : record, écart à ta moyenne et détail des parties.",
  ogImage: "/og/index.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/index.png",
  robots: "noindex, follow",
});

const { data, pending, error } = await useSessionRecap();

const session = computed(() => data.value?.session ?? null);
const stats = computed(() => session.value?.stats ?? null);
const baseline = computed(() => data.value?.baseline ?? null);
const delta = computed(() => data.value?.baselineDelta ?? null);

const record = computed(() =>
  stats.value ? stats.value.wins + " V · " + stats.value.losses + " D" : "—",
);
const insufficientMessage = computed(() => {
  const sessionGames = stats.value?.gamesPlayed ?? 0;
  const baselineGames = baseline.value?.gamesPlayed ?? 0;
  return (
    "Échantillon insuffisant pour comparer : " +
    sessionGames +
    " partie(s) dans la session, " +
    baselineGames +
    " dans ta moyenne — au moins " +
    PROGRESSION_MIN_MATCHES +
    " sont nécessaires des deux côtés."
  );
});
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <div class="min-w-0">
      <h1 class="font-heading text-2xl font-semibold">Récap de session</h1>
      <p class="mt-1 text-sm text-muted">
        Le bilan de ta dernière session : record, écart à ta moyenne et détail des parties.
      </p>
    </div>

    <UiStateCard v-if="pending" state="loading" message="Chargement de ta session…" />
    <UiStateCard
      v-else-if="error"
      state="error"
      message="Impossible de charger le récap de session."
    />
    <UiStateCard
      v-else-if="!session"
      state="empty"
      message="Aucune session enregistrée pour l'instant."
    />

    <template v-else-if="stats">
      <UiPanel title="Bilan de la session" :count="stats.gamesPlayed" :scrollable="false">
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <UiStatTile label="Record" :value="record" :tone="winrateTone(stats.winrate)" />
          <UiStatTile
            label="Winrate"
            :value="formatPercent(stats.winrate)"
            :tone="winrateTone(stats.winrate)"
          />
          <UiStatTile label="KDA" :value="stats.kda === null ? '—' : stats.kda.toFixed(2)" />
          <UiStatTile label="Morts / 10 min" :value="stats.deathsPer10Min.toFixed(1)" />
        </div>
        <p class="mt-3 text-sm text-muted">
          Du {{ formatDate(session.startedAt) }} au {{ formatDate(session.endedAt) }}.
        </p>
      </UiPanel>

      <UiPanel title="Écart à ta moyenne" :scrollable="false">
        <div v-if="delta" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <UiStatTile
            label="Winrate"
            :value="formatSignedPercent(delta.winrate)"
            :tone="deltaTone(delta.winrate, 'higher')"
          />
          <UiStatTile
            label="KDA"
            :value="delta.kda === null ? '—' : formatSignedKda(delta.kda)"
            :tone="delta.kda === null ? 'default' : deltaTone(delta.kda, 'higher')"
          />
          <UiStatTile
            label="Morts / 10 min"
            :value="formatSignedNumber(delta.deathsPer10Min)"
            :tone="deltaTone(delta.deathsPer10Min, 'lower')"
          />
          <UiStatTile
            label="XP / min"
            :value="formatSignedNumber(delta.xpPerMinute)"
            :tone="deltaTone(delta.xpPerMinute, 'higher')"
          />
        </div>
        <UiStateCard v-else state="empty" size="sm" :message="insufficientMessage" />
        <p v-if="baseline" class="mt-3 text-xs text-muted">
          Moyenne de référence : {{ baseline.gamesPlayed }} partie(s) avant cette session.
        </p>
      </UiPanel>

      <UiPanel title="Parties de la session" :count="session.matches.length" :scrollable="false">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[36rem] text-left text-sm">
            <thead class="text-xs uppercase tracking-wide text-muted">
              <tr>
                <th class="px-3 py-2">Date</th>
                <th class="px-3 py-2">Carte</th>
                <th class="px-3 py-2">Héros</th>
                <th class="px-3 py-2 text-right">K / D / A</th>
                <th class="px-3 py-2 text-right">Durée</th>
                <th class="px-3 py-2">Résultat</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="game in session.matches"
                :key="game.matchId"
                class="border-t border-border"
              >
                <td class="px-3 py-2 text-muted">{{ formatDate(game.playedAt) }}</td>
                <td class="px-3 py-2">{{ game.mapName }}</td>
                <td class="px-3 py-2">{{ game.heroName }}</td>
                <td class="px-3 py-2 text-right font-mono">
                  {{ game.kills }} / {{ game.deaths }} / {{ game.assists }}
                </td>
                <td class="px-3 py-2 text-right font-mono">
                  {{ formatDuration(game.durationSeconds) }}
                </td>
                <td class="px-3 py-2">
                  <NuxtLink
                    :to="'/matches/' + game.matchId"
                    :class="game.winner ? TONE_TEXT_CLASS.success : TONE_TEXT_CLASS.danger"
                  >
                    {{ game.winner ? "Victoire" : "Défaite" }}
                  </NuxtLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiPanel>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Add the sidebar entry**

In `apps/web/app/layouts/default.vue`, in `navItems`, insert after the `/progress` line:
```ts
  { to: "/session", label: "Récap session", icon: "i-heroicons-clipboard-document-list" },
```

- [ ] **Step 3: Add a mobile Dashboard nav card**

In `apps/web/app/pages/index.vue`, in `progressCards`, insert after the `/progress` card:
```ts
  {
    to: "/session",
    icon: "i-heroicons-clipboard-document-list",
    title: "Récap session",
    description: "Ton dernier bilan de session et son écart à ta moyenne.",
    color: "accent",
  },
```

- [ ] **Step 4: Run web tests + full typecheck**

Run: `bun run --filter './apps/web' test`
Expected: PASS.

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/pages/session.vue apps/web/app/layouts/default.vue apps/web/app/pages/index.vue
git commit -m "feat(web): add the /session recap page and its navigation"
```

---

### Task 7: Docs and final verification

**Files:**
- Modify: `tasks/progression-roadmap.md`
- Modify: `tasks/README.md`

- [ ] **Step 1: Tick the roadmap chantier**

In `tasks/progression-roadmap.md`, change `- [ ] **E1 — Récap de session**` to `- [x]` and append a `**Fait** (2026-09-19)` block listing the deviations (dashboard card now served by the endpoint; `sessionSummary.ts` removed; session also filtered by game mode; no `at` date picker on the page).

- [ ] **Step 2: Add the README line**

In `tasks/README.md`, after the last « Suite Progression » bullet, add a one-line « Suite Progression — E1 (récap de session) » entry.

- [ ] **Step 3: Run every verification command**

```bash
bun run typecheck
bun test packages/shared-types
bun test apps/api
bun run --filter './apps/web' test
```

Expected: all green; daemon untouched (no pytest needed).

- [ ] **Step 4: Commit the docs**

```bash
git add tasks/progression-roadmap.md tasks/README.md
git commit -m "docs(tasks): record the E1 session-recap chantier"
```
