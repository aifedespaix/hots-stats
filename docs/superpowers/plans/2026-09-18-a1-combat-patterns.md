# A1 — Recurring combat patterns (GET /stats/patterns) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Extract the per-match combat rules currently private to the web coach into a shared pure module, then aggregate them over a set of scoped matches behind a new session-authenticated endpoint.

**Architecture:** Pure predicates move to packages/shared-types/src/coach-rules.ts. The web coach (apps/web/app/utils/coachAnalysis.ts) delegates every numeric decision to them while keeping its French prose byte-identical. A db-free aggregator (apps/api/src/lib/pattern-aggregate.ts) sums the rules over an ordered match list. A thin DB service (apps/api/src/services/patterns.service.ts) scopes, filters and assembles the raw rows, then calls the aggregator. db-free modules keep the tests runnable with no DATABASE_URL (see packages/db/src/client.ts).

**Tech Stack:** TypeScript, bun:test (shared-types, api), vitest (web), Drizzle ORM, Hono, Zod.

**Spec:** docs/superpowers/specs/2026-09-18-player-progression-design.md (sections "Shared rule module (Lot A1)" and "A1 — Recurring combat patterns").

## Global Constraints

- French UI strings, English identifiers and comments.
- Never invent data: no MMR/rank, no objective captures, no simulated respawn timer. timeDeadShare uses the flat documented RESPAWN_ESTIMATE_SECONDS = 25 and says so.
- Personal queries always go through accountScope / scopeConditions, never eq(matchPlayers.userId, ...).
- Every aggregate ships its n (matches / evaluated counts); below PROGRESSION_MIN_MATCHES = 20 the UI shows the count, never a verdict.
- One rule lives in exactly one place; the web coach and the API import the same functions.
- Additive only: no migration, no dropped field. The web coach's exported behaviour must not change.
- Tests live next to the code. Commands: bun test packages/shared-types; bun test apps/api; bun run --filter './apps/web' test; bun run typecheck.
- Scope of this chantier: no new page, no other stats route. A1 is backend + shared rules + web refactor only.

## File Structure

- Create packages/shared-types/src/coach-rules.ts — pure rules and constants.
- Create packages/shared-types/src/coach-rules.test.ts — rule goldens.
- Modify packages/shared-types/src/stats.ts — PROGRESSION_* constants + PatternAggregate/PatternsResponse/PatternMatchPoint.
- Modify packages/shared-types/src/index.ts — export ./coach-rules.
- Create apps/api/src/lib/pattern-aggregate.ts — pure aggregation + resolveSubject.
- Create apps/api/src/lib/pattern-aggregate.test.ts — aggregator goldens + scope isolation.
- Create apps/api/src/services/patterns.service.ts — DB scoping/filtering/assembly.
- Modify apps/api/src/routes/stats.ts — GET /patterns.
- Modify apps/web/app/utils/coachAnalysis.ts — delegate rules to shared.
- Create apps/web/app/utils/coachAnalysis.test.ts — six-pillar regression goldens (captured before the refactor).

---

### Task 1: Shared contracts and constants

**Files:**
- Modify: packages/shared-types/src/stats.ts (append at end)
- Modify: packages/shared-types/src/index.ts

**Interfaces:**
- Produces: PROGRESSION_MIN_MATCHES (20), PROGRESSION_MIN_PER_SIDE (10), PatternMatchPoint, PatternAggregate, PatternsResponse.

- [ ] **Step 1: Append the contracts to packages/shared-types/src/stats.ts**

    // --- Player progression suite (Lot A) ---
    // Design: docs/superpowers/specs/2026-09-18-player-progression-design.md

    /** Minimum matches before a progression aggregate may state a conclusion
     * instead of only its raw count. Shared so API and web cannot disagree. */
    export const PROGRESSION_MIN_MATCHES = 20;

    /** Minimum matches per side before a period-A-vs-period-B comparison may
     * state a conclusion. Shared for the same reason. */
    export const PROGRESSION_MIN_PER_SIDE = 10;

    /** One match's contribution to the recurring combat-pattern aggregate.
     * perMatch is chronological and lets the client recompute a window
     * without a second round-trip. */
    export interface PatternMatchPoint {
      matchId: string;
      playedAt: string;
      winner: boolean;
      durationSeconds: number;
      deaths: number;
      isFirstDeath: boolean;
      earlyDeaths: number;
      outnumberedDeaths: number;
      staggeredDeaths: number;
      talentDelayFights: number;
    }

    /** Aggregated recurring combat patterns over a set of matches (A1). Every
     * rate exposes its evaluated denominator through the accompanying counts,
     * and coverage records what the underlying replays could not provide. */
    export interface PatternAggregate {
      /** Matches that contributed (all patterns share this denominator unless noted). */
      matches: number;
      /** True when matches < PROGRESSION_MIN_MATCHES: the UI must show the
       * count instead of a verdict. */
      insufficientSample: boolean;
      firstDeathRate: number;
      earlyDeathRate: number;
      outnumberedDeathRate: number;
      outnumberedDeaths: number;
      staggeredDeathRate: number;
      staggeredDeaths: number;
      talentDelayRate: number;
      talentDelayFights: number;
      timeDeadShare: number;
      deathsPer10Min: number;
      perMatch: PatternMatchPoint[];
      coverage: { withTimeline: number; withLevelSnapshots: number; withPositions: number };
    }

    export interface PatternsResponse {
      scope: "personal" | "global";
      aggregate: PatternAggregate;
      /** Set when the user filtered by hero/map/date. */
      filter: { heroId?: string; mapId?: string; from?: string; to?: string };
    }

- [ ] **Step 2: Export the module from packages/shared-types/src/index.ts**

Add a line: export * from "./coach-rules";

- [ ] **Step 3: Typecheck**

Run: bun run --filter './packages/shared-types' typecheck
Expected: PASS (coach-rules.ts does not exist yet only if Step 2 is deferred; add Steps 1-2 together with Task 2 or create the file first — the executor must not add the index export before the file exists).

---

### Task 2: Shared combat rules (TDD)

**Files:**
- Create: packages/shared-types/src/coach-rules.ts
- Test: packages/shared-types/src/coach-rules.test.ts

**Interfaces:**
- Produces: RuleDeath, RuleLevelSnapshot, RuleSubject, RuleCount, OutnumberedDeath, StaggeredDeath, StaggeredDeathsResult, TalentDelayFight, TalentDelayFightsResult; TALENT_TIER_LEVELS, FIGHT_CLUSTER_GAP_SECONDS, RESPAWN_PRESENCE_WINDOW_SECONDS, STAGGER_THRESHOLD_SECONDS, RESPAWN_ESTIMATE_SECONDS, EARLY_DEATH_BEFORE_SECONDS; talentTierForLevel, buildFightClusters, levelAt, firstDeathCount, earlyDeathsCount, outnumberedDeaths, outnumberedDeathsCount, staggeredDeathEvents, staggeredDeathsCount, talentDelayFightEvents, talentDelayFightsCount.

The detailed event functions exist so the web coach can render its occurrences without re-implementing the predicate: the Count wrapper is the numeric contract, the Events function is the single implementation.

- [ ] **Step 1: Write the failing tests (packages/shared-types/src/coach-rules.test.ts)**

Test cases (all use bun:test):
1. talentTierForLevel: 0→0, 1→1, 3→1, 4→4, 6→4, 7→7, 20→20, 25→20.
2. buildFightClusters golden: input atSeconds [0, 10, 25, 60, 61] (unsorted copy) → clusters [[0,10,25],[60,61]]; gap exactly 15 stays in cluster; 16 starts a new one.
3. levelAt: latest snapshot at or before; null when none/other battletag.
4. firstDeathCount: empty → {isFirst:false, atSeconds:null}; subject earliest → true with its atSeconds; subject not earliest → false.
5. earlyDeathsCount: deaths=[subject@100, subject@350, other@200], duration 1200, before 300 → {occurrences:1, evaluated:1}; duration 200 → {occurrences:0, evaluated:0}; deaths=[] → {occurrences:0, evaluated:0}.
6. outnumberedDeathsCount on the rich fixture (deaths: A@100 team0, B@300 team0, E@305 team1, A@315 team0, C@585 team0, D@590 team0, A@600 team0; subject A/team0) → {occurrences:1, evaluated:3}; the flagged death is at 600 with myTeamPresent 3 / enemyPresent 5.
7. staggeredDeathsCount on the same fixture → {occurrences:2, evaluated:2} (A@315 15s after B@300; A@600 15s after C@585).
8. talentDelayFightsCount on the same fixture with snapshots A=4 and every enemy=7 → {occurrences:1, evaluated:1}; with A=7 and enemies=4 → {occurrences:0, evaluated:1}.

- [ ] **Step 2: Run the tests to verify they fail**

Run: bun test packages/shared-types
Expected: FAIL — Cannot find module "./coach-rules".

- [ ] **Step 3: Implement packages/shared-types/src/coach-rules.ts**

Implement exactly the interfaces/functions named in Task 2 Interfaces. Key logic (must match the pre-existing web code):
- talentTierForLevel iterates TALENT_TIER_LEVELS ascending, keeps the last t with level >= t, returns 0 otherwise.
- buildFightClusters: copy, sort by atSeconds ascending (stable), append to the current cluster when death.atSeconds - previous.atSeconds <= FIGHT_CLUSTER_GAP_SECONDS, else start a new one.
- levelAt: latest snapshot with matching battletag and atSeconds <= target, else null.
- firstDeathCount: earliest death overall, isFirst = its battletag === subject.battletag.
- earlyDeathsCount: evaluated = deaths.length > 0 && matchDuration >= beforeSeconds ? 1 : 0; occurrences = subject deaths with atSeconds < beforeSeconds (0 when not evaluated).
- outnumberedDeaths: for each subject death, teammatesDown = distinct teammates that died within RESPAWN_PRESENCE_WINDOW_SECONDS before (excluding self), enemiesDown = same on the other team; myTeamPresent = 5 - teammatesDown, enemyPresent = 5 - enemiesDown; keep the death when myTeamPresent < enemyPresent.
- outnumberedDeathsCount: { occurrences: outnumberedDeaths(...).length, evaluated: subject deaths count }.
- staggeredDeathEvents: build the fight clusters; for each subject death, take its cluster, keep team deaths sorted ascending; skip when fewer than 2 teammate deaths; evaluated++ ; skip when the subject is the first teammate death; flag when the delay is greater than STAGGER_THRESHOLD_SECONDS.
- talentDelayFightEvents: clusters that contain both teams; for each, start = cluster[0].atSeconds; myLevel = levelAt(subject), enemyLevels = enemyBattletags.map(levelAt) filtered non-null; skip when either is missing; evaluated++; flag when talentTierForLevel(myLevel) < talentTierForLevel(enemy average).
- The Count wrappers delegate to the Events functions (single implementation).
- Constants: RESPAWN_ESTIMATE_SECONDS = RESPAWN_PRESENCE_WINDOW_SECONDS; EARLY_DEATH_BEFORE_SECONDS = 300.

- [ ] **Step 4: Run the tests to verify they pass**

Run: bun test packages/shared-types
Expected: PASS.

- [ ] **Step 5: Export the module**

Add export * from "./coach-rules"; to packages/shared-types/src/index.ts.

- [ ] **Step 6: Commit**

    git add packages/shared-types/src/coach-rules.ts packages/shared-types/src/coach-rules.test.ts packages/shared-types/src/index.ts packages/shared-types/src/stats.ts
    git commit -m "feat(shared-types): extract shared combat rules for progression"

---

### Task 3: Pure pattern aggregator (TDD)

**Files:**
- Create: apps/api/src/lib/pattern-aggregate.ts
- Test: apps/api/src/lib/pattern-aggregate.test.ts

**Interfaces:**
- Consumes: everything from Task 2 plus PROGRESSION_MIN_MATCHES / PatternAggregate / PatternMatchPoint from shared-types.
- Produces:
    export interface RosterPlayer { battletag: string; team: 0 | 1; kills: number; deaths: number; assists: number; winner: boolean; }
    export interface PatternMatchInput { matchId: string; playedAt: string; durationSeconds: number; winner: boolean; subject: RuleSubject; deaths: RuleDeath[]; levelSnapshots: RuleLevelSnapshot[]; enemyBattletags: string[]; hasTimeline: boolean; hasPositions: boolean; }
    export function resolveSubject(roster: RosterPlayer[], battletags: string[]): RosterPlayer | null;
    export function aggregatePatterns(matches: PatternMatchInput[]): PatternAggregate;

- [ ] **Step 1: Write the failing tests (apps/api/src/lib/pattern-aggregate.test.ts)**

Test cases (bun:test):
1. resolveSubject: two battletags in scope, roster contains both → returns the scope's first; case-insensitive match; returns null when no scope battletag is in the roster (a second user's match is simply not selectable).
2. aggregatePatterns on the 3-match fixture (m1 duration 1200 winner true, deaths [A@100 team0, B@300 team1], subject A deaths 1, timeline true; m2 duration 900 winner false, deaths [], levelSnapshots [], timeline false; m3 duration 1800 winner true, deaths [], levelSnapshots [A@0 level 4, B@0 level 7], timeline true):
   - matches 3, insufficientSample true;
   - firstDeathRate 1 (m1 only; the no-timeline m2 must NOT count as "not first death");
   - earlyDeathRate 1;
   - outnumberedDeathRate 0, outnumberedDeaths 0;
   - staggeredDeathRate 0, talentDelayRate 0 (evaluated 0);
   - timeDeadShare = 50 / 3900;
   - deathsPer10Min = 2 / (3900 / 600);
   - coverage { withTimeline: 2, withLevelSnapshots: 1, withPositions: 0 };
   - perMatch has 3 entries in input order with deaths/isFirstDeath/earlyDeaths/outnumberedDeaths/staggeredDeaths/talentDelayFights as described.
3. Empty input → matches 0, insufficientSample true, every rate 0, coverage zeros.
4. insufficientSample flips to false at exactly PROGRESSION_MIN_MATCHES inputs.

- [ ] **Step 2: Run the tests to verify they fail**

Run: bun test apps/api
Expected: FAIL — Cannot find module "./pattern-aggregate".

- [ ] **Step 3: Implement apps/api/src/lib/pattern-aggregate.ts**

No @hots-stats/db import (packages/db/src/client.ts throws without DATABASE_URL). Accumulate per match: totalDeaths (subject.deaths), totalDurationSeconds, coverage counters; firstDeath occurrences/evaluated (evaluated only when deaths.length > 0); earlyDeath flag/evaluated; outnumbered + evaluated (subject death count); staggered events + evaluated; talentDelay events + evaluated; build the perMatch point. Rate helper returns 0 when the denominator is 0. timeDeadShare = subject-death-total * RESPAWN_ESTIMATE_SECONDS / total duration (0 guard); deathsPer10Min = subject-death-total / (total duration / 600) (0 guard).

- [ ] **Step 4: Run the tests to verify they pass**

Run: bun test apps/api
Expected: PASS (existing 24 tests plus the new ones).

- [ ] **Step 5: Commit**

    git add apps/api/src/lib/pattern-aggregate.ts apps/api/src/lib/pattern-aggregate.test.ts
    git commit -m "feat(api): add pure combat-pattern aggregator"

---

### Task 4: Patterns service and route

**Files:**
- Create: apps/api/src/services/patterns.service.ts
- Modify: apps/api/src/routes/stats.ts

**Interfaces:**
- Consumes: aggregatePatterns, resolveSubject, PatternMatchInput from Task 3; Scope/scopeConditions from ../lib/account-selection; PatternsResponse from shared-types.
- Produces:
    export interface PatternsFilters { mode?: GameMode[]; heroId?: string; mapId?: string; from?: string; to?: string; }
    export const EMPTY_PATTERN_AGGREGATE: PatternAggregate;
    export async function getPatterns(scope: Scope, filters: PatternsFilters): Promise<PatternsResponse>;

- [ ] **Step 1: Implement apps/api/src/services/patterns.service.ts**

Flow:
1. conditions = scopeConditions([], scope, matchPlayers.battletag); push mode (inArray matches.gameMode), heroId (eq matchPlayers.heroId), mapId (eq matches.mapId), from (gte matches.playedAt new Date), to (lte).
2. Query the scoped subject candidates: select matchId, playedAt, durationSeconds, battletag, team, kills, deaths, assists, winner from matchPlayers innerJoin matches, WHERE and(...conditions), ORDER BY matches.playedAt ASC, matchPlayers.matchId ASC.
3. Empty → return { scope: scope.mode, aggregate: EMPTY_PATTERN_AGGREGATE, filter }.
4. Group candidates by matchId; per match call resolveSubject(candidates mapped to RosterPlayer, scope.mode === "personal" ? scope.battletags : []) and keep the matching original row. This is the ONLY subject-selection rule and it relies on the SQL scopeCondition for isolation.
5. matchIds = selected subjects' keys.
6. Roster query (NOT scope filtered): select matchId, battletag, team from matchPlayers WHERE matchId IN matchIds; build enemyBattletags per match (team !== subject.team).
7. Deaths query: select matchId, battletag, team, atSeconds, x, y from matchDeaths innerJoin matchPlayers on matchPlayers.id = matchDeaths.matchPlayerId WHERE matchId IN matchIds; build RuleDeath lists and a positionsByMatch set (x !== null && y !== null).
8. Level query: select matchId, battletag, atSeconds, level from matchLevelSnapshots innerJoin matchPlayers WHERE matchId IN matchIds; build RuleLevelSnapshot lists.
9. Sort subject rows chronological (playedAt then matchId), assemble PatternMatchInput (hasTimeline = deaths.length > 0 || levelSnapshots.length > 0) and return aggregatePatterns(inputs).
10. EMPTY_PATTERN_AGGREGATE is the zeroed PatternAggregate with perMatch: [] and coverage zeros.

- [ ] **Step 2: Add GET /patterns to apps/api/src/routes/stats.ts**

Add patternsQuerySchema = z.object({ scope: heroStatsScopeSchema.optional(), accounts: accountsQuerySchema, mode: gameModeListSchema.optional(), heroId: z.string().optional(), mapId: z.string().optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional() }). Handler: safeParse → 400 on failure; scope = withStatsScope(c.get("scope"), parsed.data.scope ?? "personal"); if scope.mode === "global" return 400 with the French message "Les patterns de combat ne sont disponibles que pour ton profil (scope=personal)."; else return c.json(await getPatterns(scope, { mode, heroId, mapId, from, to })). Patterns are inherently personal: there is no coherent subject row for the whole community, so global is refused rather than silently faked.

- [ ] **Step 3: Typecheck the API**

Run: bun run --filter './apps/api' typecheck
Expected: PASS.

- [ ] **Step 4: Commit**

    git add apps/api/src/services/patterns.service.ts apps/api/src/routes/stats.ts
    git commit -m "feat(api): add GET /stats/patterns over scoped matches"

---

### Task 5: Web coach delegates to the shared rules

**Files:**
- Modify: apps/web/app/utils/coachAnalysis.ts
- Create: apps/web/app/utils/coachAnalysis.test.ts

**Interfaces:**
- Consumes: TALENT_TIER_LEVELS, RESPAWN_PRESENCE_WINDOW_SECONDS, STAGGER_THRESHOLD_SECONDS, firstDeathCount, outnumberedDeaths, staggeredDeathEvents, talentDelayFightEvents, RuleSubject from shared-types.

- [ ] **Step 1: Write the regression golden test FIRST, using the captured pre-refactor output (apps/web/app/utils/coachAnalysis.test.ts)**

Build the four fixtures used for capture (rich, noTimeline, positiveTalent, noDeaths; see the git history of this plan's authoring capture). Assert for each fixture the six pillars' projection { pillar, status, verdict, summary, metricLabel, metricValue, occurrences }. Captured expectations:
- rich: outnumberedFights ready/negative "1 mort(s) sur 3 avec ton équipe en infériorité numérique estimée." "Morts en sous-nombre" "1/3" occurrences [{10:00, "Mort en infériorité estimée (~3 vs 5)."}]; talentDelay ready/negative "1 combat(s) sur 1 engagé(s) avec un palier de talent en retard." "Combats en retard de palier" "1/1" [{5:00, "Palier 4 (niveau 4) engagé contre palier 7 (niveau adverse moyen 7.0)."}]; staggeredDeaths ready/negative "2 mort(s) en groupe sur 2 en décalé, isolées après le reste de l'équipe." "Morts en décalé" "2/2" [{5:15, "Mort 15s après le premier coéquipier tombé dans ce fight."},{10:00, same detail}]; efficiency ready/positive "KDA de 5.00, au-dessus de la moyenne de ton équipe (2.23), avec 65% de participation aux kills." "KDA" "5.00"; firstDeath ready/negative "Tu es le premier tombé de la partie, à 1:40." "Premier mort à" "1:40"; objectiveFootprint ready/neutral "28% des dégâts de siège de l'équipe, contre 32% des dégâts héros." "Part des dégâts de siège" "28%".
- noTimeline: outnumberedFights/talentDelay/staggeredDeaths/firstDeath all unavailable with the exact captured reasons; efficiency and objectiveFootprint as in rich.
- positiveTalent: outnumberedFights ready/positive "Aucune mort ce match : impossible d'avoir combattu en sous-nombre en mourant."; talentDelay ready/positive "Palier de talent toujours au moins égal à l'adversaire sur 1 combat(s) analysé(s)."; staggeredDeaths ready/positive "Aucune mort ce match : rien à décaler."; efficiency positive; firstDeath positive "Tu n'es pas le premier tombé de la partie (à 1:40)."; objectiveFootprint neutral.
- noDeaths: outnumberedFights positive (same as positiveTalent); talentDelay unavailable "Aucun combat exploitable (niveau inconnu au moment des morts recensées)."; staggeredDeaths positive "Aucune mort ce match : rien à décaler."; efficiency positive; firstDeath positive "Tu n'es pas le premier tombé de la partie (à 1:40)."; objectiveFootprint neutral.

Run: bun run --filter './apps/web' test
Expected: PASS against the CURRENT implementation (this locks the behaviour before the refactor).

- [ ] **Step 2: Refactor apps/web/app/utils/coachAnalysis.ts**

- Replace the local TALENT_TIER_LEVELS / FIGHT_CLUSTER_GAP_SECONDS / RESPAWN_PRESENCE_WINDOW_SECONDS / STAGGER_THRESHOLD_SECONDS / talentTierForLevel / buildFightClusters / levelAt with imports from @hots-stats/shared-types. Keep exporting TALENT_TIER_LEVELS (PlayerTalents.vue gets it from the Nuxt utils auto-import) via export { TALENT_TIER_LEVELS } from "@hots-stats/shared-types";
- Add subjectOf(me: ScoreboardRow): RuleSubject = { battletag: me.battletag, team: me.team === 1 ? 1 : 0, kills: me.kills, deaths: me.deaths, assists: me.assists }.
- computeOutnumberedFightsInsight: keep the meta, the !timeline branch and the zero-death branch verbatim; map outnumberedDeaths(timeline.deaths, subjectOf(me)) to CoachOccurrence using the event's atSeconds/myTeamPresent/enemyPresent; the summary/metricValue use occurrences.length and myDeaths.length exactly as before.
- computeTalentDelayInsight: keep meta and the !timeline || levelSnapshots.length === 0 branch; call talentDelayFightEvents(timeline.deaths, timeline.levelSnapshots, subjectOf(me), enemyTeam.map(p => p.battletag)); keep the evaluated === 0 branch; map events to occurrences with the same French detail string built from myTier/myLevel/enemyTier/enemyAvgLevel.
- computeStaggeredDeathsInsight: keep meta, !timeline branch and zero-death branch; call staggeredDeathEvents(timeline.deaths, subjectOf(me)); map events to the same detail string from delaySeconds.
- computeFirstDeathInsight: keep meta and the !timeline || deaths.length === 0 branch; call firstDeathCount(timeline.deaths, subjectOf(me)); keep the two branches and their exact strings.

- [ ] **Step 3: Run the web tests**

Run: bun run --filter './apps/web' test
Expected: PASS — the golden test from Step 1 still green, proving the six pillars are unchanged.

- [ ] **Step 4: Commit**

    git add apps/web/app/utils/coachAnalysis.ts apps/web/app/utils/coachAnalysis.test.ts
    git commit -m "refactor(web): delegate coach rules to shared combat-rules module"

---

### Task 6: Full verification and documentation

**Files:**
- Modify: tasks/progression-roadmap.md
- Modify: tasks/README.md

- [ ] **Step 1: Delete the temporary capture test**

Remove apps/web/app/utils/coach-golden-capture.test.ts (it was only the golden-capture scratch file).

- [ ] **Step 2: Run the whole verification**

Run, in order:
    bun run typecheck
    bun test packages/shared-types
    bun test apps/api
    bun run --filter './apps/web' test
Expected: all green. The daemon is untouched, so pytest is not run.

- [ ] **Step 3: Update tasks/progression-roadmap.md**

Tick A1 and record the deviations: (a) global scope is refused with a 400 because a combat-pattern aggregate has no coherent community-wide subject; (b) patterns.service.ts is split into a db-free apps/api/src/lib/pattern-aggregate.ts (pure, tested) plus the db service; (c) EARLY_DEATH_BEFORE_SECONDS = 300 and RESPAWN_ESTIMATE_SECONDS = 25 are named constants in coach-rules.ts; (d) PROGRESSION_MIN_PER_SIDE is declared in shared-types per the cross-cutting rule but not consumed yet (A1 uses only PROGRESSION_MIN_MATCHES).

- [ ] **Step 4: Add one line to the "Déjà fait" section of tasks/README.md**

- [ ] **Step 5: Final commit**

    git add tasks/progression-roadmap.md tasks/README.md
    git commit -m "docs(tasks): mark A1 combat patterns done"

- [ ] **Step 6: Push only if the gate is fully green**

Push only if Step 2 is entirely green, no new dependency was added and nothing doubts. Otherwise leave the commits local and report the blocker.

## Self-Review

- Spec coverage: shared rule module → Task 2; constants → Tasks 1-2; aggregation service → Tasks 3-4; route → Task 4; web delegation + regression test → Task 5; acceptance criteria 1 (buildFightClusters golden) → Task 2.1; criterion 2 (six pillars identical) → Task 5; criteria 3-4 (matches/insufficientSample/coverage, no-timeline contributes nothing) → Task 3.2; criterion 5 (heroId denominator) → Task 4 (single subject-row query feeds every rule); criterion 6 (scope isolation) → Task 3.1 + scopeConditions in Task 4.
- Placeholders: none; each step names the exact file, function and expected result.
- Type consistency: PatternAggregate/PatternMatchPoint/PatternsResponse are defined once (Task 1) and reused; RuleCount is produced by Task 2 and consumed by Task 3; resolveSubject is produced by Task 3 and consumed by Task 4.
