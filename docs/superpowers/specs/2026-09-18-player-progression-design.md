# Player Progression Suite — Design

## Context

The app already answers *"what happened in this match?"* extremely well:

- `apps/web/app/utils/coachAnalysis.ts` ships six per-match pillars (outnumbered
  fights, talent delay, staggered deaths, first death, efficiency, objective
  footprint), each one showing its own methodology string.
- `match_deaths` (with `x`/`y`, `killers`, `killType`, `layer`),
  `match_level_snapshots`, `match_structure_events` and
  `match_hero_trajectories` are already collected, validated and stored.
- `weaknesses.service.ts` already ranks maps / matchups / talents as
  "leaks" and "strengths".
- Statistical honesty is a real project value: Wilson bounds
  (`apps/api/src/lib/wilson.ts`, `apps/web/app/utils/wilson.ts`), a
  `statsReliable` flag on matches, explicit minimum-sample gates
  (`DRAFT_MIN_RANKED_GAMES_FOR_RANKING`, `TALENT_ANALYZER_MIN_GAMES_DEFAULT`).

What the app does **not** do is answer *"what is my recurring failure pattern,
and am I improving?"*. Every coach insight is match-scoped. Nothing aggregates
those signals over time, nothing normalizes raw totals by game duration, and
nothing compares the player against the community distribution the app already
computes under `scope=global`.

**Goal:** turn the existing per-match material into a progression layer — a
coach that works over a *set* of matches, honest about sample size, with a
dedicated hub and the supporting context breakdowns.

**Non-goals:**

- No rank/MMR display. The replay pipeline has no rank data; inventing one
  would violate the project's honesty rule.
- No objective-capture ("tribut pris", "autel capturé") feature in lots A–F.
  Those events are not extracted today; that is a separate daemon project
  (lot G, backlog).
- No i18n work. French UI strings, English identifiers and comments.
- No rewrite of `coachAnalysis.ts` behaviour — its per-match output stays
  byte-identical; only the *rules* move to a shared module.

## Guiding principles

1. **Never invent data.** A metric with no source column is out of scope, not
   "approximated quietly". Every derived value documents its formula.
2. **Normalize before comparing.** Any raw total (`experienceContribution`,
   `heroDamage`, …) must be exposed per minute alongside the total, because
   raw totals silently reward long games.
3. **One source of truth for a rule.** The aggregation service must consume
   the *same* pure functions as the web coach — never a re-implementation.
4. **Sample size is part of the number.** Every aggregate ships its `n`, and
   the UI must render "n" next to the verdict. Below the gate, show the raw
   count instead of a conclusion.
5. **Explicability over modelling.** Prefer conditional means + effect size to
   a fitted model that cannot be explained in a tooltip.
6. **Additive and reversible.** Migrations are additive only; every new page
   is reachable from navigation; nothing existing is deleted in the same
   chantier that replaces it.

## Data availability matrix

| Signal | Source today | Available |
|---|---|---|
| Kills / deaths / assists, damage, healing, XP | `match_players` | yes |
| Hero damage per minute etc. | `match_players` + `matches.durationSeconds` | yes (not exposed) |
| Death timestamps, per-player | `match_deaths.atSeconds` | yes |
| Who killed you | `match_deaths.killers` | yes (not exposed) |
| Death position | `match_deaths.x/y` (+ `layer`) | yes, calibrated maps only |
| Team XP/level curve | `match_level_snapshots` | yes (not exposed) |
| Fort/keep/core destruction | `match_structure_events` | yes, best-effort |
| Player path over time | `match_hero_trajectories` | yes, calibrated maps only |
| Hero roles / team composition | `heroes.heroRole` | yes |
| Played-at, patch | `matches.playedAt`, `matches.gameVersion` | yes |
| Rank / MMR | — | **no** |
| Objective captures, mercenary camps | — | **no** (lot G) |

---

## Architecture

### Shared rule module (Lot A1)

`apps/web/app/utils/coachAnalysis.ts` owns the rules but lives in the web app,
so the API cannot reuse it. Extract the **pure predicates** into a new shared
module and make both sides import them.

**Create:** `packages/shared-types/src/coach-rules.ts`

```ts
/** Minimal shapes: no UI formatting, no web-only types. */
export interface RuleDeath {
  battletag: string;
  team: 0 | 1;
  atSeconds: number;
}
export interface RuleLevelSnapshot {
  battletag: string;
  atSeconds: number;
  level: number;
}
export interface RuleSubject {
  battletag: string;
  team: 0 | 1;
  kills: number;
  deaths: number;
  assists: number;
}

export const TALENT_TIER_LEVELS = [1, 4, 7, 10, 13, 16, 20] as const;
export const FIGHT_CLUSTER_GAP_SECONDS = 15;
export const RESPAWN_PRESENCE_WINDOW_SECONDS = 25;
export const STAGGER_THRESHOLD_SECONDS = 8;

export function talentTierForLevel(level: number): number;
export function buildFightClusters<T extends { atSeconds: number }>(deaths: T[]): T[][];
export function levelAt(snapshots: RuleLevelSnapshot[], battletag: string, atSeconds: number): number | null;

/** Per-match, subject-relative flags. Each returns the count and the evaluated
 * denominator so an aggregate can sum both. */
export interface RuleCount {
  occurrences: number;
  evaluated: number;
}
export function firstDeathCount(deaths: RuleDeath[], subject: RuleSubject): { isFirst: boolean; atSeconds: number | null };
export function earlyDeathsCount(deaths: RuleDeath[], subject: RuleSubject, beforeSeconds: number, matchDuration: number): RuleCount;
export function outnumberedDeathsCount(deaths: RuleDeath[], subject: RuleSubject): RuleCount;
export function staggeredDeathsCount(deaths: RuleDeath[], subject: RuleSubject): RuleCount;
export function talentDelayFightsCount(
  deaths: RuleDeath[],
  snapshots: RuleLevelSnapshot[],
  subject: RuleSubject,
  enemyBattletags: string[],
): RuleCount;
```

`apps/web/app/utils/coachAnalysis.ts` keeps its French prose and its
`CoachInsightResult` shape, but every numeric decision delegates to these
functions. Its exported behaviour must not change — see the regression test
in A1.

### Aggregation services (Lot A)

New service files under `apps/api/src/services/`, all following the existing
pattern: `scopeConditions([], scope, matchPlayers.battletag)` for the personal
filter, optional `inArray(matches.gameMode, mode)`, optional date range and
`gameVersion` range.

```
apps/api/src/services/
  patterns.service.ts     # A1  recurring combat patterns over a match set
  metrics.service.ts      # A2  duration-normalized metric definitions (shared helpers)
  trend.service.ts        # A3  rolling time series + period comparison
  drivers.service.ts      # A4  metric-vs-outcome effect sizes
  killers.service.ts      # C3  who kills you
  context.service.ts      # C4  winrate by hour/day/session/patch/composition
```

New routes:

```
apps/api/src/routes/stats.ts        # extended: /patterns /trend /drivers /killers /context
apps/api/src/routes/spatial.ts      # extended: /death-map   (C1)
```

All new stats routes are session-authenticated and use the existing
`authSession, requireUser, accountScope` middleware chain plus
`withStatsScope(...)`.

### Web

New page `apps/web/app/pages/progress.vue` plus chart components under
`apps/web/app/components/progress/`. Existing pages consume the same
endpoints in their own sections (no duplicated fetching logic — one composable
per endpoint family under `apps/web/app/composables/`).

---

## Chantiers

### A1 — Recurring combat patterns  `GET /stats/patterns`

**Purpose:** "over my last N games, here is my pattern" — the core of the whole
suite.

**Computation.** For each match in scope, resolve the *subject row* (the first
match_players row whose battletag is in the scope's set), then apply the shared
rules:

| Pattern | Rule (imported, not re-implemented) |
|---|---|
| `firstDeathRate` | share of matches where the subject died first of all 10 |
| `earlyDeathRate` | share of matches with >= 1 death before 300s since gates open |
| `outnumberedDeathRate` | `outnumberedDeathsCount.occurrences / evaluated` |
| `staggeredDeathRate` | `staggeredDeathsCount.occurrences / evaluated` |
| `talentDelayRate` | `talentDelayFightsCount.occurrences / evaluated` |
| `timeDeadShare` | `sum(deaths * respawnEstimate) / sum(duration)` — see note |
| `deathsPer10Min` | `sum(deaths) / (sum(duration) / 600)` |

**Respawn estimate.** The web coach deliberately refuses to simulate respawn
timers. Keep that honesty: `timeDeadShare` uses a flat, documented constant
`RESPAWN_ESTIMATE_SECONDS = 25` (same value as
`RESPAWN_PRESENCE_WINDOW_SECONDS`) and its tooltip says so. It is a trend
indicator, not a stopwatch.

**Response contract** (add to `packages/shared-types/src/stats.ts`):

```ts
export interface PatternAggregate {
  /** Matches that contributed (all patterns share this denominator unless noted). */
  matches: number;
  /** True when matches < PROGRESSION_MIN_MATCHES (20): the UI must show the
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

  /** Per-match contribution, chronological — powers the trend line and lets
   * the client recompute a window without a second round-trip. */
  perMatch: Array<{
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
  }>;

  /** Honest "what we could not evaluate and why". */
  coverage: { withTimeline: number; withLevelSnapshots: number; withPositions: number };
}

export interface PatternsResponse {
  scope: "personal" | "global";
  aggregate: PatternAggregate;
  /** Set when the user filtered by hero/map. */
  filter: { heroId?: string; mapId?: string; from?: string; to?: string };
}
```

**Files**

- Create: `packages/shared-types/src/coach-rules.ts`, `apps/api/src/services/patterns.service.ts`
- Modify: `packages/shared-types/src/index.ts` (export), `packages/shared-types/src/stats.ts`, `apps/api/src/routes/stats.ts`, `apps/web/app/utils/coachAnalysis.ts`
- Test: `packages/shared-types/src/coach-rules.test.ts`, `apps/web/app/utils/coachAnalysis.test.ts` (new regression goldens)

**Acceptance criteria**

1. `buildFightClusters` groups deaths exactly as the current web implementation
   does (same gap constant, same ordering) — golden test on a fixed death list.
2. For a fixture match whose coach output is captured before the refactor, all
   six web pillars produce identical `verdict`/`summary`/`metricValue`.
3. `GET /stats/patterns` on a 3-match fixture returns `matches: 3`,
   `insufficientSample: true`, and `coverage.withTimeline` equal to the number
   of those matches that have timeline rows.
4. A match with no timeline rows contributes to `matches` and to nothing else
   (never counted as "no first death").
5. Query with `heroId` restricts every pattern's denominator consistently.
6. Player scope is respected: a second user's matches never appear.

**Definition of done:** `bun run typecheck`, `bun test packages/shared-types`,
`bun test apps/api`, `bun run --filter './apps/web' test` all green.

---

### A2 — Duration-normalized metrics

**Purpose:** stop presenting raw totals as if they were comparable.

Add to the shared stats contracts and to the existing endpoints:

```ts
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

Attach where a per-player-per-match aggregate already exists:
`StatsSummary` (`/stats/summary`), `HeroStats` (`/heroes`, `/heroes/:heroId`),
`DashboardOverviewStats` (`/matches/dashboard`), and the player profile's
`ownStats.summary`.

**Computation:** `sum(stat) / (sum(durationSeconds) / 60)` — a weighted rate,
never an average of ratios (a 5-minute game and a 30-minute game must not
weigh the same).

**Files**

- Modify: `packages/shared-types/src/stats.ts`, `apps/api/src/services/stats.service.ts`, `talents.service.ts`, `apps/api/src/routes/heroes.ts`, `apps/api/src/routes/matches.ts`, `apps/web/app/types/analytics.ts`, `apps/web/app/types/matches.ts`
- Test: `apps/api/src/services/metrics.service.test.ts`

**Acceptance criteria**

1. Weighted rate test: matches of 600s (10 XP) and 1800s (30 XP) yield
   `xpPerMinute === 1`, not `(1 + 1)/2`.
2. Zero-duration guard: no division by zero, returns `0`.
3. Existing fields keep their exact previous values (no silent behaviour change).

---

### A3 — Rolling trend + period comparison  `GET /stats/trend`

**Purpose:** "am I improving?" answered with a line, not a feeling.

```ts
export interface TrendPoint {
  matchId: string;
  playedAt: string;
  winner: boolean;
  /** 1-based index within the returned series. */
  index: number;
  /** Rolling winrate over the last WINDOW games ending here (null before the window fills). */
  rollingWinrate: number | null;
  rollingKda: number | null;
  rollingDeathsPer10Min: number | null;
  gameVersion: string | null;
}

export interface PeriodStats {
  gamesPlayed: number;
  winrate: number;
  kda: number | null;
  deathsPer10Min: number;
  xpPerMinute: number;
}

export interface TrendResponse {
  window: number;               // default 20
  points: TrendPoint[];
  /** Optional second series for an explicit A/B (e.g. this month vs last month). */
  comparison?: { label: string; from: string; to: string; stats: PeriodStats }[];
  /** Patch boundaries inside the series — rendered as vertical markers. */
  versionChanges: Array<{ atIndex: number; gameVersion: string; playedAt: string }>;
}
```

**Files**

- Create: `apps/api/src/services/trend.service.ts`
- Modify: `apps/api/src/routes/stats.ts`, `packages/shared-types/src/stats.ts`
- Create: `apps/web/app/composables/useProgressionTrend.ts`, `apps/web/app/components/progress/TrendChart.vue`
- Test: `apps/api/src/services/trend.service.test.ts`

**Acceptance criteria**

1. `rollingWinrate` is `null` for the first `window - 1` points and equals the
   exact winrate of the trailing window afterwards (fixture: 25 games with a
   known win pattern).
2. Points are chronological ascending and `index` is contiguous.
3. `versionChanges` contains exactly one entry per distinct `gameVersion`
   change, positioned at the first match of the new version.
4. `comparison` present only when `compareTo` is passed; each period's stats
   are computed over that period alone.
5. Existing `GET /matches/trend` keeps working unchanged (it has other
   consumers) — this is a new route, not a replacement.

---

### A4 — Outcome drivers  `GET /stats/drivers`

**Purpose:** "which of my stats actually correlate with my wins?" — the most
motivating view in the suite, and the easiest to lie with. Keep it strict.

**Method (deliberately simple and explainable).** For each candidate metric,
split the matches into wins and losses and report conditional means plus a
standardized effect size (Cohen's d) and both sample sizes. No fitted model.

```ts
export interface DriverMetric {
  key: string;                  // "earlyDeaths" | "xpPerMinute" | "deathsPer10Min" | ...
  label: string;                // French display label
  /** Direction in which the metric is "good" — used for the colour, not the maths. */
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

export interface DriversResponse {
  scope: "personal" | "global";
  matches: number;
  /** Sorted by |effectSize| descending, reliable entries first. */
  drivers: DriverMetric[];
  methodology: string;
}
```

**Candidate metrics:** `earlyDeaths`, `deathsPer10Min`, `firstDeath`,
`outnumberedDeaths`, `xpPerMinute`, `heroDamagePerMinute`,
`killParticipation`, `timeDeadShare`, `teamCompHasHealer` (C4 data),
`avgHeroLevelAt10Min` (from `match_level_snapshots`).

**Files**

- Create: `apps/api/src/services/drivers.service.ts`
- Modify: `apps/api/src/routes/stats.ts`, `packages/shared-types/src/stats.ts`
- Create: `apps/web/app/components/progress/DriverList.vue`
- Test: `apps/api/src/services/drivers.service.test.ts`

**Acceptance criteria**

1. Fixture where every win has `earlyDeaths = 0` and every loss has 2 yields a
   negative `effectSize` for `earlyDeaths` with `betterWhen: "lower"`.
2. `reliable: false` when either side has < 10 matches, and the entry still
   appears (with its counts) rather than being hidden.
3. Zero variance on both sides (all values identical) produces
   `effectSize: 0`, never `NaN` or `Infinity`.
4. `methodology` is non-empty and names Cohen's d and the minimum sample.
5. The endpoint never returns a metric whose source data is entirely absent for
   the scope (e.g. no level snapshots at all ⇒ no `avgHeroLevelAt10Min` entry).

---

### B1 — `/progress` hub page

**Purpose:** one page that answers "where am I and what do I work on".

**Sections, top to bottom**

1. **En-tête** — période sélectionnée + bascule de portée (réutilise
   `UiStatsScopeToggle`).
2. **Tendance** — `TrendChart` (A3): rolling winrate, patch markers,
   comparaison de périodes.
3. **Tes 3 axes de travail** — the 3 largest `|effectSize|` reliable drivers
   (A4), each rendered as an actionable card ("morts avant 5 min : 1,8 vs 0,4
   en victoire — 12 matchs concernés") with a drill instruction and a link to
   the filtered match list.
4. **Tes patterns récurrents** — `patterns` (A1) as a compact table with `n`.
5. **Ton contexte** — `context` (C4) charts (heure, jour, taille de session).
6. **Liens** — vers `/carte-morts`, `/objectifs`, `/analysis`.

**Files**

- Create: `apps/web/app/pages/progress.vue`, `apps/web/app/components/progress/WorkAxesCard.vue`, `PatternTable.vue`, `apps/web/app/composables/useProgression.ts`
- Modify: `apps/web/app/layouts/default.vue` (nav entry — inserted after
  "Diagnostic", before "Amis"), `apps/web/app/pages/index.vue` (dashboard card)

**Acceptance criteria**

1. Page renders with zero data without throwing (empty states via `UiStateCard`).
2. With `insufficientSample: true`, section 3 shows the raw counts and no
   verdict wording.
3. The nav entry appears in the sidebar and is highlighted on `/progress`.
4. Mobile layout has no horizontal scroll at 375px width.
5. `useSeoMeta` set with `robots: "noindex, follow"` like the other authed
   pages.

---

### B2 — Dashboard cleanup

**Remove**
- the "Durée moyenne" tile from `StatsAccountSummaryStats`
- the two `UiTeaserLink` point-fort / point-faible blocks from
  `pages/index.vue` (superseded by the work-axes card)
- the "Navigation" card grid on `lg` and up (the sidebar already provides it);
  keep it on `< lg` where the sidebar is a bottom bar

**Add**
- a rolling-winrate sparkline tile (A3, window 20)
- a "Ton chantier n°1" card linking to `/progress`
- a "Dernière session" line: games, record, and a one-line insight

**Files**

- Modify: `apps/web/app/pages/index.vue`, `apps/web/app/components/stats/AccountSummaryStats.vue`
- Create: `apps/web/app/components/progress/SparklineTile.vue`, `SessionSummaryCard.vue`

**Acceptance criteria**

1. No layout shift in the 4-tile grid when replacing the duration tile (still 4 tiles).
2. Dashboard still loads with a single `/stats/summary` + `/matches?pageSize=8`
   round-trip; the sparkline reuses `/stats/trend` and is not fetched twice.
3. Nothing removed is still referenced anywhere (grep for the removed component
   props).

---

### B3 — Diagnostic page extension

Fold A1 + A4 into `/analysis` above the existing leaks/strengths so the
Diagnostic page becomes the full picture, and delete the now-pointless
"Winrate par carte déplacé vers le Hub des cartes" stub card.

**Acceptance criteria**

1. The stub card is gone and `/maps` is reachable from the nav card grid.
2. `/analysis` shows the patterns table and the drivers list, both honouring
   the ranked-only filter it already applies.

---

### C1 — Aggregated death map

**Purpose:** "where do I die?" across a hero/map, not one match.

`GET /spatial/death-map?mapId=&heroId=&scope=&layer=`

```ts
export interface DeathMapCell { cellIndex: number; deaths: number; }
export interface DeathMapResponse {
  mapId: string;
  layer: string | null;
  grid: { cols: number; rows: number };
  totalDeaths: number;
  matches: number;
  /** Deaths with a usable x/y only — the honest denominator. */
  positionedDeaths: number;
  cells: DeathMapCell[];
  /** Cluster centroids, from the existing death-clustering util. */
  clusters: Array<{ cellIndex: number; deaths: number; share: number }>;
  killTypeSplit: { hero: number; other: number };
  calibrated: boolean;
}
```

Reuse `apps/web/app/utils/deathClustering.ts` for the client-side clustering
story, but compute the server-side counts in SQL over `match_deaths` joined to
`matches`/`match_players`.

**Files**

- Create: `apps/api/src/services/death-map.service.ts`
- Modify: `apps/api/src/routes/spatial.ts`, `packages/shared-types/src/spatial-grid.ts`
- Create: `apps/web/app/pages/maps/[mapId].vue` section + `apps/web/app/components/spatial/SpatialDeathAggregateView.vue`
- Test: `apps/api/src/services/death-map.service.test.ts`

**Acceptance criteria**

1. `positionedDeaths <= totalDeaths` always, and `cells` sums to
   `positionedDeaths`.
2. For an uncalibrated map the endpoint returns `calibrated: false` with an
   empty `cells` array and a 200 (never a 500).
3. Deaths with a `layer` different from the requested layer are excluded.
4. Cross-player scope isolation test.

---

### C2 — Match chronology tab

Add a third tab to `pages/matches/[id].vue`: **Chronologie**.

Content:
- team-XP/level lead curve, built from `match_level_snapshots` (the two teams'
  mean level sampled over time), with a zero line = even
- death markers per team (using `atSeconds`, dot size = deaths in the cluster)
- structure-event markers (`match_structure_events`), best-effort and labelled
  as such
- a scrubber that highlights the same timestamps in the existing heatmap tab

**Files**

- Create: `apps/web/app/components/charts/MatchTimelineChart.vue`, `apps/web/app/composables/useMatchTimelineSeries.ts`
- Modify: `apps/web/app/pages/matches/[id].vue`, `apps/web/app/types/coach.ts`

**Acceptance criteria**

1. A match with no `levelSnapshots` renders the tab with an explicit
   "données de niveau absentes" state, not an empty chart.
2. Curve is derived from the two teams' snapshots, not from a fabricated
   timeline.
3. Tab is keyboard reachable; the chart has a text alternative summarising the
   final lead.

---

### C3 — "Ton bourreau" (who kills you)

`GET /stats/killers` — aggregates `match_deaths.killers` for the subject.

```ts
export interface KillerEntry {
  killerBattletag: string | null;
  killerHeroId: string | null;
  killerHeroName: string | null;
  deaths: number;
  /** Deaths caused by this killer as a share of all your deaths. */
  share: number;
  /** Your winrate in the matches where this killer killed you. */
  winrateWhenKilledBy: number;
}
export interface KillersResponse {
  totalDeaths: number;
  deathsWithKiller: number;
  topKillers: KillerEntry[];
  topKillerHeroes: KillerEntry[];
}
```

**Acceptance criteria**

1. `deathsWithKiller <= totalDeaths`; deaths without a resolved killer are
   reported in the gap, never silently attributed.
2. A kill with a `killType: "other"` is excluded from `topKillerHeroes` but
   counted in `totalDeaths`.
3. Entries sort by `deaths` descending, ties broken by battletag for stability.

---

### C4 — Context breakdown  `GET /stats/context`

Winrate broken down by, with `n` on every bucket:

| Dimension | Source |
|---|---|
| Heure de la journée | `matches.playedAt` (24 buckets, local hour) |
| Jour de la semaine | `matches.playedAt` |
| Rang dans la session | derived: order within a cluster of matches < 90 min apart |
| Taille de session | derived: number of matches in that cluster |
| Patch | `matches.gameVersion` |
| Composition d'équipe | counts of `heroes.heroRole` on the subject's team |

**Files**

- Create: `apps/api/src/services/context.service.ts`, `apps/web/app/components/progress/ContextBreakdown.vue`
- Modify: `apps/api/src/routes/stats.ts`, `packages/shared-types/src/stats.ts`
- Test: `apps/api/src/services/context.service.test.ts`

**Acceptance criteria**

1. Session clustering is server-side and deterministic: two matches 89 minutes
   apart are one session, 91 minutes apart are two.
2. Every bucket carries `gamesPlayed`; buckets below `PROGRESSION_MIN_MATCHES`
   are flagged, not hidden.
3. Team-composition buckets use the subject's own team only.
4. Timezone: the API receives an explicit `tzOffsetMinutes` parameter; no
   server-local-time assumption.

---

### D1 — Draft assistance

Extend `pages/draft/index.vue` and `components/draft/`:

- **Composition alert:** count roles across the viewer's own team from the
  resolved heroes; warn on "aucun soigneur", "3 assassins", etc.
- **Pick suggestion:** rank the viewer's heroes for the current map by
  personal winrate + Wilson lower bound, down-weighted by how contested the
  role already is. Reuses `/heroes?scope=personal&mapId=` (already supported).
- **Ban suggestion:** highest `worstMatchups` winrate delta against the
  viewer's likely heroes, from `/heroes/:heroId/matchups`.

**Constraint:** the draft snapshot carries pseudo names, not always hero ids.
When heroes are unresolved, the panel states what it is waiting for instead of
suggesting blind. No suggestion is ever shown without its `n`.

**Acceptance criteria**

1. With no resolved heroes, the panel shows a waiting state and no pick list.
2. Composition warning triggers exactly on the documented rules.
3. Every suggested hero displays its games count.
4. No new polling loop: reuse `useDraftStream`.

---

### E1 — Session recap

`GET /stats/session?at=<iso>` (default: the current/last session) returning the
session's matches, record, per-game summary and the deltas versus the player's
baseline. Rendered as `/session` and as the Dashboard "Dernière session" card
(B2).

**Acceptance criteria**

1. The session boundary uses the same 90-minute clustering as C4 (shared
   helper, single implementation).
2. With one match in the session, the recap still renders (no division by zero,
   no "amélioration" claim).
3. The endpoint never claims a trend from fewer than `PROGRESSION_MIN_MATCHES`.

---

### E2 — Goals  `/objectifs`

New additive table `player_goals`:

```ts
export const playerGoals = pgTable("player_goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  metricKey: text("metric_key").notNull(),      // must be a known driver metric key
  targetValue: real("target_value").notNull(),
  direction: text("direction").notNull(),        // "atLeast" | "atMost"
  scopeHeroId: text("scope_hero_id"),
  scopeMapId: text("scope_map_id"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  achievedAt: timestamp("achieved_at", { withTimezone: true }),
});
```

CRUD routes under `/stats/goals` (or a dedicated `/goals`) plus progress
computed from the same metric definitions as A4 — no separate metric maths.

**Acceptance criteria**

1. Only known `metricKey` values are accepted (400 otherwise).
2. Progress is computed over matches played **after** `createdAt`.
3. Deleting a goal does not touch matches (FK direction verified).
4. Migration is additive and contains no `DROP`.

---

### F1 — Command palette (Ctrl+K)

Client-side only. Sources: static routes, the viewer's heroes (`/heroes`),
maps (`/maps`), friends (`/friends`), and the current page's rows where the
page registers them. No new API.

**Acceptance criteria**

1. Opens with Ctrl+K / Cmd+K, closes with Escape, arrow keys move the
   selection, Enter navigates.
2. Fully keyboard reachable and screen-reader labelled (`role="dialog"`,
   `aria-modal`).
3. Results are grouped and ranked; a query with no match shows a clear empty
   state.

---

### F2 — URL-synced filters

Make the persisted filters (game mode, scope, hero, map, search, sort,
page) round-trip through the query string, so a URL reproduces a view.

**Constraint:** the existing Pinia stores are the source of truth for
persistence; the URL is a *projection*. On load, URL wins over storage; on
change, both are written. Do not introduce a second state system.

**Acceptance criteria**

1. Copying the URL of a filtered `/matches` view into a fresh session
   reproduces the same result set.
2. A malformed query param is ignored with no crash and no infinite redirect.
3. Pages that already read a param (`/talents?heroId=`) keep working.

---

### F3 — Accessibility pass

- **Colour-blind safety:** every winrate / win-loss indicator gets a redundant
  glyph (▲/▼ or a shape), not colour alone. Entry points:
  `WinrateBar.vue`, `DataTable.vue` result cells, `MapWinrateList.vue`.
- **Live regions:** the live-draft status and the "captured Xs ago" counter use
  `aria-live="polite"` (and the counter is throttled to once every 10s of
  announced text, not per second).
- **Focus visibility:** one consistent `:focus-visible` ring across
  interactive components.
- **Reduced motion:** honour `prefers-reduced-motion` for the animated
  transitions.

**Acceptance criteria**

1. Axe-core (or equivalent manual checklist) reports no critical violations on
   the dashboard, progress, matches list and match detail pages.
2. Win/loss remains distinguishable in a greyscale screenshot.
3. No colour-only meaning remains in the touched components.

---

### F4 — Export and sharing

- `GET /matches/export.csv` streaming the filtered list (same filter schema as
  `GET /matches`, capped at a documented row limit).
- A "Copier le lien" action on a filtered view (depends on F2).

**Acceptance criteria**

1. CSV is RFC-4180 quoted; a hero or map name containing a comma or quote does
   not break the file.
2. The cap is enforced server-side and reported in a response header.
3. Export respects the exact same scope and filters as the on-screen list.

---

### G1 — Objective events (backlog, separate spec)

Extract objective captures / mercenary camps from the replay
(`heroprotocol` `STrackerEvent`-family events), add a schema block to
`ReplayPayload`, a DB table, an upsert path, and only then a UI. This requires
a daemon `PARSER_VERSION` bump and a `MIN_PARSER_VERSION` decision.

**Not part of lots A–F.** It must get its own design doc because it touches the
ingestion pipeline and the quarantine/adapters story.

---

## Cross-cutting rules

- **Scope:** every new personal endpoint goes through `accountScope` +
  `scopeConditions`; never a raw `eq(matchPlayers.userId, ...)`.
- **Constants:** `PROGRESSION_MIN_MATCHES = 20` and
  `PROGRESSION_MIN_PER_SIDE = 10` live in `packages/shared-types` so API and
  web cannot disagree.
- **Migrations:** additive only. `apps/api/docker-entrypoint.sh` applies
  pending Drizzle migrations on deploy, so a pushed migration ships
  automatically — which is exactly why it must be backward compatible with the
  currently deployed web build.
- **No new npm/python dependency** without saying so explicitly in the chantier.
- **French UI strings, English identifiers and comments.**
- **Every new chart ships a text summary** (accessibility + server-rendered
  fallback).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| The aggregation rules drift from the web coach's rules | The rules move to `packages/shared-types` and the web coach imports them; a golden regression test locks the web output. |
| Cohen's d presented as a causal claim | `methodology` string shown next to the list; wording is "observé sur tes parties", never "cause". |
| Aggregating over deaths is expensive on large accounts | `perMatch` is one row per match; counts are computed in a single query with `GROUP BY match`. Add an index on `match_deaths(match_id)` if the plan shows a scan. |
| `timeDeadShare` looks precise but is a flat estimate | Constant is documented, shown in the tooltip, and the metric is never used alone for a verdict. |
| Two parallel state systems for filters (Pinia + URL) | URL is a projection of the store; a single composable owns the sync. |
| Scope leak in a new endpoint | Every new service test includes an isolation case with a second user's data. |

## Rollout order

```
A1 ─┬─> B3 ─> B1 ─> B2
A2 ─┤
A3 ─┤
A4 ─┘
C4 ─┬─> E1
C1 ─┤
C3 ─┘
C2   (independent)
D1   (independent)
E2   (independent, needs a migration)
F1   (independent)
F2 ─> F4
F3   (independent)
G1   (separate spec)
```

Lot A is the hard dependency for the progression hub. Everything else can land
in any order.
