# Spatial Heatmap: Tower of Doom Calibration Fix + Haunted Mines Multi-Layer Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two confirmed heatmap bugs: (A) Tower of Doom's calibration tool produces a badly-scaled world-bounds rectangle because raw calibration samples include every tracked unit (structures, altars, minions), not just heroes; (B) Haunted Mines has no concept of its surface/underground split, so both zones share one calibration and one flat grid, scrambling the heatmap.

**Architecture:** (A) is a one-function daemon fix: filter `_collect_calibration_samples` to hero units only, the same filter `_normalized_position_samples_by_toon` already applies. (B) threads a `layer: string | null` dimension (the wire schema already reserves this field, always `null` today) through the whole spatial pipeline: DB tables gain a `layer` column (stored as a `NOT NULL DEFAULT ''` sentinel, since Postgres can't enforce uniqueness across a nullable composite-key column — `''` means "the map's one/default level", any other string names an additional level), the daemon tests each raw position sample against every calibrated layer's world bounds and tags it with whichever one contains it, and the API/web read paths group a hero's per-match data by layer instead of assuming one grid per hero. No static "which maps have layers" table is introduced anywhere — a map simply has as many calibrated layers as an admin has saved via the calibration tool, so the mechanism is generic (works for any future multi-level map, not hardcoded to Haunted Mines), exactly as `tasks/epic-10-analyse-spatiale.md` section 4 recommended.

**Tech Stack:** Bun/Hono/Drizzle (`apps/api`), Nuxt 3/Vue/Pinia (`apps/web`), Python/`heroprotocol`/`pytest` (`daemon-python`), Postgres.

**Spec:** `tasks/epic-10-analyse-spatiale.md` (section 4, "Cas particulier — maps multi-niveaux"), plus the existing `layer` field reservations in `packages/shared-types/src/replay-payload.ts` (`spatialPresenceEntrySchema.layer`, `matchHeroTrajectorySchema.layer`).

## Global Constraints

- Never hand-write migration SQL. Edit the Drizzle schema `.ts` files, then run `bun run --filter './packages/db' generate`, read the generated file to confirm it does what's expected, then `bun run --filter './packages/db' migrate`.
- DB layer sentinel: a `text` column named `layer`, `NOT NULL DEFAULT ''`. `''` = "the map's default/only level" (what every row already means today, so existing data needs no backfill — the column default handles it). The wire format (`ReplayPayload`, `GET /matches/:id`, etc.) always uses `string | null` with `null` for that same default level. Only `apps/api/src/lib/spatial-layer.ts` (Task 4) converts between the two; no other file compares a layer value to `""` or `null` directly except through its `toDbLayer`/`fromDbLayer` helpers.
- `daemon-python` has `pytest`; run via `cd daemon-python && pytest tests/test_parser.py -q` (or the specific test). `apps/api` has **no test runner configured today** (confirmed: no `vitest`/test script in `apps/api/package.json`) — Task 4's new pure helper gets a `bun test` file (Bun ships a built-in runner, no dependency needed, run via `bun test apps/api/src/lib/spatial-layer.test.ts`), but the DB-touching services this plan changes (`replay-upsert.service.ts`, `spatial-rollup.service.ts`, `spatial-aggregate.service.ts`) are verified manually against a local Postgres (`bun run docker:dev:up`) per their task's verification steps, not with new automated tests — do not invent a test harness that doesn't exist in this repo.
- Run `bun run typecheck` after every `apps/api`/`apps/web`/`packages/*` task; run `pytest tests/test_parser.py -q` (from `daemon-python/`) after every daemon task.
- This design assumes each layer's world bounds are **disjoint** in X/Y (mechanism 1 from the epic doc, not mechanism 2's Z/overlap case) — the daemon picks whichever calibrated layer's bounds contain a raw point. This is UNCONFIRMED against a real multi-layer replay, same caveat style as this codebase's existing `UNCONFIRMED FIELD SHAPE` comments on `_iter_unit_positions` — ship it documented, don't block on data nobody has yet.

---

## Part A — Tower of Doom calibration-sample contamination fix

### Task 1: Filter calibration samples to hero units only

**Files:**
- Modify: `daemon-python/src/parser.py:690-707` (`_collect_calibration_samples`), `daemon-python/src/parser.py:1405` (its call site inside `build_payload`)
- Modify: `daemon-python/src/constants.py:157` (`PARSER_VERSION` + changelog comment above it)
- Test: `daemon-python/tests/test_parser.py` (existing tests at lines 1236, 1240, 1252 + one new test)

**Interfaces:**
- Produces: `_collect_calibration_samples(tracker_events: list[dict], tracker_id_to_toon: dict[int, str], target_count: int = constants.CALIBRATION_SAMPLE_TARGET) -> list[dict[str, float]]` — signature gains a required `tracker_id_to_toon` param (previously just `tracker_events` + optional `target_count`).

- [ ] **Step 1: Write the failing test**

Add to `daemon-python/tests/test_parser.py`, near the existing `test_collect_calibration_samples_*` tests (around line 1252):

```python
def test_collect_calibration_samples_excludes_non_hero_units():
    tracker_id_to_toon = {1: "1-Hero-1-1001"}
    events = [
        _unit_born_event(1, "HeroLiMing", unit_tag_index=1),
        # Tag 99 never appears in a SUnitBornEvent for a hero -- stands in
        # for a structure/altar/minion position, which SUnitPositionsEvent
        # reports for every trackable unit, not just heroes.
        _unit_positions_event(100, [(1, 10.0, 10.0), (99, 500.0, 500.0)]),
    ]

    sampled = _collect_calibration_samples(events, tracker_id_to_toon)

    assert sampled == [{"x": 10.0, "y": 10.0}]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd daemon-python && pytest tests/test_parser.py::test_collect_calibration_samples_excludes_non_hero_units -v`
Expected: FAIL — either a `TypeError` (missing `tracker_id_to_toon` argument, since the function doesn't accept it yet) or, once you add the argument speculatively, an assertion failure because the unfiltered function still returns both points.

- [ ] **Step 3: Update the three existing tests to the new signature**

Replace the three tests at lines 1236-1257 (`test_collect_calibration_samples_returns_empty_without_position_events`, `test_collect_calibration_samples_subsamples_evenly_above_target`, `test_collect_calibration_samples_returns_every_point_below_target`) with:

```python
def test_collect_calibration_samples_returns_empty_without_position_events():
    assert _collect_calibration_samples(_base_tracker_events(), tracker_id_to_toon={}) == []


def test_collect_calibration_samples_subsamples_evenly_above_target():
    tracker_id_to_toon = {1: "1-Hero-1-1001"}
    points = [(float(i), float(i)) for i in range(10)]
    events = [
        _unit_born_event(1, "HeroLiMing", unit_tag_index=1),
        _unit_positions_event(100, [(1, x, y) for x, y in points]),
    ]

    sampled = _collect_calibration_samples(events, tracker_id_to_toon, target_count=5)

    assert len(sampled) == 5
    # Spread across the whole range, not front-loaded from the first 5 points.
    assert sampled[0]["x"] == 0.0
    assert sampled[-1]["x"] == 8.0


def test_collect_calibration_samples_returns_every_point_below_target():
    tracker_id_to_toon = {1: "1-Hero-1-1001", 2: "1-Hero-1-1002"}
    events = [
        _unit_born_event(1, "HeroLiMing", unit_tag_index=1),
        _unit_born_event(2, "HeroMalfurion", unit_tag_index=2),
        _unit_positions_event(100, [(1, 1.0, 1.0), (2, 2.0, 2.0)]),
    ]

    sampled = _collect_calibration_samples(events, tracker_id_to_toon, target_count=1000)

    assert sampled == [{"x": 1.0, "y": 1.0}, {"x": 2.0, "y": 2.0}]
```

- [ ] **Step 4: Also add a `build_payload`-level regression test**

Append after `test_build_payload_collects_calibration_sample_for_unmapped_map` (around line 1319):

```python
def test_build_payload_excludes_non_hero_positions_from_calibration_sample():
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroLiMing"),
        _unit_born_event(2, "HeroMalfurion"),
        _unit_positions_event(610, [(1, 10.0, 10.0), (2, 90.0, 90.0), (99, 5000.0, 5000.0)]),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
        calibrations={},  # no entry for "cursed-hollow"
    )

    pending = payload["_pendingSpatialSample"]
    assert {"x": 10.0, "y": 10.0} in pending["points"]
    assert {"x": 90.0, "y": 90.0} in pending["points"]
    assert {"x": 5000.0, "y": 5000.0} not in pending["points"]
```

- [ ] **Step 5: Run all four to confirm they fail for the right reason**

Run: `cd daemon-python && pytest tests/test_parser.py -k "collect_calibration_samples" -v`
Expected: FAIL on every test (the old 3-arg-less signature and the unfiltered behavior).

- [ ] **Step 6: Implement the fix**

In `daemon-python/src/parser.py`, replace `_collect_calibration_samples` (lines 690-707):

```python
def _collect_calibration_samples(
    tracker_events: list[dict],
    tracker_id_to_toon: dict[int, str],
    target_count: int = constants.CALIBRATION_SAMPLE_TARGET,
) -> list[dict[str, float]]:
    """Evenly-strided subsample of every raw (unnormalized) *hero* position
    observed in the replay -- spread across the whole match rather than
    front-loaded, since a calibration admin needs points from every part of
    the map, not just wherever the laning phase happened to be (see
    tasks/epic-10-analyse-spatiale.md). Returns `[]` if the replay has no
    `SUnitPositionsEvent` at all (older build -- not an error, see
    `build_payload`'s known/unknown-map branch).

    Filtered to hero units via `_hero_unit_tags_by_index`, same as
    `_normalized_position_samples_by_toon` already does for the real
    heatmap: `SUnitPositionsEvent` reports every trackable unit's position,
    not just heroes (minions, structures, mercenary camps, altars, ...).
    Before this filter existed, those non-hero points fed straight into the
    admin calibration tool's `autoFitBounds()` (apps/web/app/pages/admin/
    calibrate.vue), which does a naive min/max over the raw cloud -- one
    outlier (e.g. a structure or altar far from the actual playable
    footprint) was enough to badly stretch the saved world bounds, observed
    (2026-08) on Towers of Doom's altar/structure layout.
    """
    hero_tags = _hero_unit_tags_by_index(tracker_events, tracker_id_to_toon)
    all_points = [
        (x, y) for _, tag_index, x, y in _iter_unit_positions(tracker_events) if tag_index in hero_tags
    ]
    if not all_points:
        return []
    if len(all_points) <= target_count:
        return [{"x": x, "y": y} for x, y in all_points]
    step = len(all_points) / target_count
    return [{"x": all_points[int(i * step)][0], "y": all_points[int(i * step)][1]} for i in range(target_count)]
```

Then update the call site at line 1405 (inside `build_payload`):

```python
    pending_points = None if calibration else _collect_calibration_samples(tracker_events, tracker_id_to_toon)
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd daemon-python && pytest tests/test_parser.py -k "collect_calibration_samples" -v`
Expected: PASS, all 4.

Run: `cd daemon-python && pytest tests/test_parser.py -q`
Expected: PASS, full file (confirms nothing else broke).

- [ ] **Step 8: Bump PARSER_VERSION and document**

In `daemon-python/src/constants.py`, change line 157 from `PARSER_VERSION = "1.11"` to `PARSER_VERSION = "1.12"`, and insert a new changelog entry directly above it (after the existing `# 1.11: ...` paragraph, before the `PARSER_VERSION = "1.11"` line — renumber that line to `"1.12"`):

```python
# 1.12: `_collect_calibration_samples` (the raw points POSTed to
# `/spatial/samples` for the admin calibration tool) included every tracked
# unit's position -- minions, structures, altars, mercenary camps -- not
# just heroes, unlike the actual heatmap-building path
# (`_normalized_position_samples_by_toon`), which already filtered to heroes
# via `_hero_unit_tags_by_index`. A single outlier non-hero position was
# enough to badly stretch `autoFitBounds()`'s naive min/max in
# apps/web/app/pages/admin/calibrate.vue, producing a visibly wrong-scaled
# calibration -- confirmed (2026-08) on Towers of Doom. Now filters to hero
# units only, matching the real heatmap path. Deliberately NOT paired with a
# `MIN_PARSER_VERSION` bump: this only changes what gets POSTed to
# `/spatial/samples` for *uncalibrated* maps, never the `spatial` block of an
# already-ingested match, so there's nothing to resync.
```

- [ ] **Step 9: Typecheck-equivalent — run the full daemon suite once more**

Run: `cd daemon-python && pytest -q`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add daemon-python/src/parser.py daemon-python/src/constants.py daemon-python/tests/test_parser.py
git commit -m "fix(daemon): exclude non-hero units from spatial calibration samples"
```

**Post-deploy note (not a code step, do not skip when this ships):** the existing `raw_map_samples` row for `towers-of-doom` (and any other already-calibrated map) was collected by the *old*, unfiltered daemon build and is contaminated. It is overwritten (not accumulated) on the next daemon upload for that map, so once a daemon on `PARSER_VERSION >= "1.12"` uploads a Towers of Doom replay, the sample refreshes clean automatically — but the *saved calibration* (`map_calibrations` row) does not fix itself. An admin needs to revisit `/admin/spatial/calibrate`, select "Towers of Doom", wait for the fresh sample to load, and click "Auto-ajuster aux points" again (or hand-adjust) once at least one daemon on the new build has uploaded a Towers of Doom match.

---

## Part B — Haunted Mines multi-layer heatmap support

### Task 2: Shared-types — `layer` on deaths and calibration schemas

**Files:**
- Modify: `packages/shared-types/src/replay-payload.ts:49-58` (`matchTimelineDeathSchema`)
- Modify: `packages/shared-types/src/spatial-calibration.ts` (all of it)

**Interfaces:**
- Produces: `matchTimelineDeathSchema` gains `layer: z.string().nullable().optional()`. `postSpatialCalibrateInputSchema` gains `layer: z.string().trim().default("")`. `spatialCalibrationsResponseSchema` becomes a two-level record: `Record<mapId, Record<layerKey, MapBounds & {updatedAt}>>`.

- [ ] **Step 1: Edit `matchTimelineDeathSchema`**

In `packages/shared-types/src/replay-payload.ts`, change:

```ts
export const matchTimelineDeathSchema = z.object({
  battletag: z.string(),
  team: z.union([z.literal(0), z.literal(1)]),
  atSeconds: z.number().int().nonnegative(),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  killers: z.array(z.string()).optional(),
  killType: killTypeSchema.optional(),
});
```

to:

```ts
export const matchTimelineDeathSchema = z.object({
  battletag: z.string(),
  team: z.union([z.literal(0), z.literal(1)]),
  atSeconds: z.number().int().nonnegative(),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  // Which calibrated layer `x`/`y` are normalized against -- `null` (or
  // absent, for a daemon build older than PARSER_VERSION 1.13) is the map's
  // default/only level, same convention as `spatialPresenceEntrySchema.layer`
  // below. Only meaningful alongside `x`/`y`; a death with no position never
  // has a layer either.
  layer: z.string().nullable().optional(),
  killers: z.array(z.string()).optional(),
  killType: killTypeSchema.optional(),
});
```

- [ ] **Step 2: Rewrite `packages/shared-types/src/spatial-calibration.ts`**

Replace the whole file with:

```ts
import { z } from "zod";

export const mapBoundsSchema = z.object({
  minX: z.number(),
  maxX: z.number(),
  minY: z.number(),
  maxY: z.number(),
});
export type MapBounds = z.infer<typeof mapBoundsSchema>;

/**
 * GET /spatial/calibrations response body: mapId -> layer key -> world
 * bounds, with `updatedAt` so the Daemon can detect a layer that's new or
 * was just recalibrated since it last checked (see app.py's
 * `_sync_spatial_calibrations`). The layer key is `""` for a map's
 * default/only level (mirrored as `null` on the wire `ReplayPayload`'s
 * `spatial.presence[].layer` -- see `apps/api/src/lib/spatial-layer.ts`),
 * or any other string for a named additional level (e.g. `"bottom"` for
 * Haunted Mines' underground). A map with only its default level calibrated
 * has a single-entry inner record; nothing about this shape assumes any
 * particular map has more than one.
 */
export const spatialCalibrationsResponseSchema = z.record(
  z.string(),
  z.record(z.string(), mapBoundsSchema.extend({ updatedAt: z.string() })),
);
export type SpatialCalibrationsResponse = z.infer<typeof spatialCalibrationsResponseSchema>;

export const rawMapPointSchema = z.object({ x: z.number(), y: z.number() });
export type RawMapPoint = z.infer<typeof rawMapPointSchema>;

/**
 * POST /spatial/samples body -- the daemon's ~1000-point subsample of raw,
 * unnormalized *hero* positions (see `_collect_calibration_samples` in
 * parser.py) for a map with at least one uncalibrated layer. Deliberately
 * layer-agnostic: the raw cloud is undifferentiated, and an admin manually
 * carves out each layer's rectangle from it in the calibration tool.
 */
export const postSpatialSamplesInputSchema = z.object({
  mapId: z.string().min(1),
  points: z.array(rawMapPointSchema).min(1).max(2000),
});
export type PostSpatialSamplesInput = z.infer<typeof postSpatialSamplesInputSchema>;

/** POST /admin/spatial/calibrate body. `layer` defaults to `""` (the map's
 * default level) when omitted -- an admin adding a second level for an
 * already-calibrated map sends a non-empty `layer` alongside the same
 * `mapId`, which becomes a new row rather than overwriting the existing
 * default-level calibration (see spatial-calibration.service.ts's
 * `saveCalibration`). */
export const postSpatialCalibrateInputSchema = mapBoundsSchema.extend({
  mapId: z.string().min(1),
  layer: z.string().trim().default(""),
});
export type PostSpatialCalibrateInput = z.infer<typeof postSpatialCalibrateInputSchema>;
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: FAILS now, in `apps/api` (services/routes still use the old shapes) — that's expected; this task only lands the type contracts. Confirm the failures are exactly in `spatial-calibration.service.ts`, `admin-spatial.ts`, and `replay-upsert.service.ts`/callers of `matchTimelineDeathSchema`-typed data — nowhere else. Do not fix them yet; later tasks do.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/src/replay-payload.ts packages/shared-types/src/spatial-calibration.ts
git commit -m "feat(shared-types): add layer field to death timeline and calibration schemas"
```

---

### Task 3: DB schema — `layer` columns and composite keys

**Files:**
- Modify: `packages/db/src/schema/spatial-calibration.ts` (`mapCalibrations` only — `rawMapSamples` stays unchanged)
- Modify: `packages/db/src/schema/match-spatial-grids.ts`
- Modify: `packages/db/src/schema/match-hero-trajectories.ts`
- Modify: `packages/db/src/schema/hero-map-spatial-rollup.ts`
- Modify: `packages/db/src/schema/match-deaths.ts`
- Create: a new file under `packages/db/drizzle/` (generated, not hand-written)

**Interfaces:**
- Produces: `mapCalibrations` PK becomes `(mapId, layer)`. `matchSpatialGrids` PK becomes `(matchPlayerId, layer)`. `matchHeroTrajectories` PK becomes `(matchPlayerId, layer)`. `heroMapPlayerSpatialRollup` unique index becomes `(mapId, heroId, layer, battletag, outcome)`. `heroMapGlobalSpatialRollup` unique index becomes `(mapId, heroId, layer, outcome)`. `matchDeaths` gains a nullable `layer` column (no key change).

- [ ] **Step 1: Edit `packages/db/src/schema/spatial-calibration.ts`**

Change the imports line and `mapCalibrations` table definition:

```ts
import { jsonb, pgTable, primaryKey, real, text, timestamp } from "drizzle-orm/pg-core";
import { maps } from "./maps";

// World-bounds calibration for one map's one level, used by the Daemon to
// normalize raw SUnitPositionsEvent coordinates into [0,1] before building
// the `spatial` payload block (see tasks/epic-10-analyse-spatiale.md
// Livrable 1). Set once per (map, layer) by an admin via
// /admin/spatial/calibrate.
export const mapCalibrations = pgTable(
  "map_calibrations",
  {
    mapId: text("map_id")
      .notNull()
      .references(() => maps.id, { onDelete: "cascade" }),
    // "" = the map's single/default level -- what every row meant before
    // multi-level support existed, so existing rows keep working via this
    // column's default. A non-empty key (e.g. "bottom" for Haunted Mines'
    // underground) names an additional level. NOT NULL: Postgres can't
    // enforce uniqueness across a nullable composite-PK column, so the
    // wire/API's `string | null` becomes this sentinel string at the DB
    // boundary only -- see apps/api/src/lib/spatial-layer.ts.
    layer: text("layer").notNull().default(""),
    minX: real("min_x").notNull(),
    maxX: real("max_x").notNull(),
    minY: real("min_y").notNull(),
    maxY: real("max_y").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.mapId, table.layer] }),
  }),
);

export type MapCalibration = typeof mapCalibrations.$inferSelect;
export type NewMapCalibration = typeof mapCalibrations.$inferInsert;

// Raw, unnormalized *hero* sample points the Daemon uploads for a map with
// at least one uncalibrated layer -- overwritten (not accumulated) on every
// subsequent upload for the same map. Deliberately NOT layer-keyed: the
// cloud is undifferentiated, and an admin manually carves out each layer's
// rectangle from it in the calibration tool. Kept around even after every
// level is calibrated (see spatial-calibration.service.ts's
# saveCalibration) so the admin calibration tool always has *something* to
// render when re-opening an already-calibrated map to fix a mistake or add
// another level.
export const rawMapSamples = pgTable("raw_map_samples", {
  mapId: text("map_id")
    .primaryKey()
    .references(() => maps.id, { onDelete: "cascade" }),
  rawPoints: jsonb("raw_points").notNull().$type<{ x: number; y: number }[]>(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RawMapSample = typeof rawMapSamples.$inferSelect;
export type NewRawMapSample = typeof rawMapSamples.$inferInsert;
```

(`rawMapSamples` itself is unchanged from today — only its surrounding comment moved. Fix the stray `#` typo above to `//` if you introduce it; write it as `//` directly.)

- [ ] **Step 2: Edit `packages/db/src/schema/match-spatial-grids.ts`**

```ts
import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { matchPlayers } from "./match-players";

/**
 * One hero's derived spatial grids for one match **on one layer**, keyed by
 * `(matchPlayerId, layer)` -- a hero has exactly one presence grid per
 * layer they were tracked on in a match (one row for a single-level map,
 * up to as many rows as calibrated levels exist for a multi-level one).
 * Absent entirely for a match whose map had no calibration for a given
 * layer at ingestion time.
 *
 * Stored as `Record<cellIndex, value>` (a JSON object keyed by cell index),
 * not the wire payload's structure-of-arrays -- an object is trivial to
 * merge-add when rolling up multiple matches (see
 * `hero-map-spatial-rollup.ts` and `spatial-aggregate.service.ts`), which
 * matters far more for this table than shaving a few bytes off storage the
 * way the wire format's arrays do for network transfer.
 */
export const matchSpatialGrids = pgTable(
  "match_spatial_grids",
  {
    matchPlayerId: uuid("match_player_id")
      .notNull()
      .references(() => matchPlayers.id, { onDelete: "cascade" }),
    // See spatial-calibration.ts's mapCalibrations.layer for the "" sentinel convention.
    layer: text("layer").notNull().default(""),
    gridCols: integer("grid_cols").notNull(),
    gridRows: integer("grid_rows").notNull(),
    // cellIndex (as a string key) -> seconds present in that cell.
    presenceGrid: jsonb("presence_grid").notNull().$type<Record<string, number>>(),
    // cellIndex -> number of kills credited to this hero whose death location fell in that cell.
    killsGrid: jsonb("kills_grid").notNull().$type<Record<string, number>>(),
    // cellIndex -> number of times this hero died in that cell.
    deathsGrid: jsonb("deaths_grid").notNull().$type<Record<string, number>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.matchPlayerId, table.layer] }),
  }),
);

export type MatchSpatialGrid = typeof matchSpatialGrids.$inferSelect;
export type NewMatchSpatialGrid = typeof matchSpatialGrids.$inferInsert;
```

- [ ] **Step 3: Edit `packages/db/src/schema/match-hero-trajectories.ts`**

Same treatment — add `layer: text("layer").notNull().default("")` and switch `matchPlayerId` from `.primaryKey()` to a plain FK column plus a composite `primaryKey({ columns: [table.matchPlayerId, table.layer] })` in a third `(table) => ({...})` argument, importing `primaryKey` and `text` from `drizzle-orm/pg-core`:

```ts
import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { matchPlayers } from "./match-players";

/**
 * One hero's downsampled, *timestamped* path for one match on one layer,
 * keyed by `(matchPlayerId, layer)` -- same layer convention as
 * `match-spatial-grids.ts`. Absent entirely for a match whose map had no
 * calibration for a given layer at ingestion time, same gating as
 * `matchSpatialGrids`.
 *
 * Deliberately a separate table from `matchSpatialGrids`, not a column on
 * it: `presenceGrid` there is a match-long aggregate with no per-sample
 * timestamp left, which is exactly why the Pro Comparison View (time-sliced
 * / event-anchored heatmaps, literal rotation pathing -- see
 * apps/web/app/composables/useHeatmapSync.ts) needs this parallel,
 * timestamped path instead. Stored as parallel arrays (the wire payload's
 * own structure-of-arrays shape, see `matchHeroTrajectorySchema`) rather
 * than one row per sample -- unlike deaths/structure events, a trajectory
 * is read as a whole path for one hero at a time, never queried or
 * aggregated per-point, so there's no benefit to normalizing it into rows.
 */
export const matchHeroTrajectories = pgTable(
  "match_hero_trajectories",
  {
    matchPlayerId: uuid("match_player_id")
      .notNull()
      .references(() => matchPlayers.id, { onDelete: "cascade" }),
    layer: text("layer").notNull().default(""),
    atSeconds: jsonb("at_seconds").notNull().$type<number[]>(),
    x: jsonb("x").notNull().$type<number[]>(),
    y: jsonb("y").notNull().$type<number[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.matchPlayerId, table.layer] }),
  }),
);

export type MatchHeroTrajectory = typeof matchHeroTrajectories.$inferSelect;
export type NewMatchHeroTrajectory = typeof matchHeroTrajectories.$inferInsert;
```

- [ ] **Step 4: Edit `packages/db/src/schema/hero-map-spatial-rollup.ts`**

Add `layer: text("layer").notNull().default("")` as a column on **both** `heroMapPlayerSpatialRollup` and `heroMapGlobalSpatialRollup` (right after `heroId`, before `battletag`/`outcome`), add `text` to the `drizzle-orm/pg-core` import, and widen both `uniqueIndex(...).on(...)` calls to include `table.layer`:

```ts
import { integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
```

```ts
    uniqueRow: uniqueIndex("hero_map_player_spatial_rollup_unique").on(
      table.mapId,
      table.heroId,
      table.layer,
      table.battletag,
      table.outcome,
    ),
```

```ts
    uniqueRow: uniqueIndex("hero_map_global_spatial_rollup_unique").on(
      table.mapId,
      table.heroId,
      table.layer,
      table.outcome,
    ),
```

- [ ] **Step 5: Edit `packages/db/src/schema/match-deaths.ts`**

Add a nullable `layer` column (no sentinel needed here — `match_deaths` has its own `uuid` PK, not a composite key, so it can store the wire's `null` directly):

```ts
    x: real("x"),
    y: real("y"),
    // Which calibrated layer `x`/`y` are normalized against -- null for the
    // map's default/only level, or when the death has no position at all.
    // Same convention as match_spatial_grids.layer, but stored as the
    // real string-or-null here (no NOT NULL/DEFAULT sentinel needed --
    // this table has its own uuid PK, not a composite key on this column).
    layer: text("layer"),
```

Add `text` to this file's `drizzle-orm/pg-core` import if not already present (it imports `index, integer, jsonb, pgEnum, pgTable, real, uuid` today — add `text`).

- [ ] **Step 6: Generate the migration**

Run: `bun run --filter './packages/db' generate`

This inspects your 5 edited schema files against `packages/db/drizzle/meta/_journal.json` and writes the next-numbered file (`packages/db/drizzle/00XX_<adjective>_<noun>.sql`). If drizzle-kit prompts an interactive question (e.g. asking whether a column is a rename vs. a new column), answer "create column" / "no, it's a new column" for every prompt here — every change in this task is a genuinely new column or a new composite-PK definition, never a rename.

- [ ] **Step 7: Read the generated SQL before applying it**

Open the new file under `packages/db/drizzle/`. Confirm it:
- Adds a `layer` column (`NOT NULL DEFAULT ''` for the 4 sentinel tables, nullable for `match_deaths`) to each of the 5 tables.
- Drops each of `map_calibrations`, `match_spatial_grids`, `match_hero_trajectories`'s existing single-column primary key and adds the new composite one.
- Recreates `hero_map_player_spatial_rollup_unique`/`hero_map_global_spatial_rollup_unique` with `layer` included.
- Does **not** drop or recreate any table, and does not touch any other column.

If it does anything else (e.g. a full table rebuild), stop and fix the schema `.ts` edits rather than hand-editing the generated SQL.

- [ ] **Step 8: Apply the migration**

Run: `bun run docker:dev:up` (if the local Postgres isn't already running), then `bun run --filter './packages/db' migrate`
Expected: migration applies cleanly; existing rows in all 5 tables now have `layer = ''` (or `NULL` for `match_deaths`), which is correct — every existing match/calibration was implicitly "the default level."

- [ ] **Step 9: Typecheck**

Run: `bun run typecheck`
Expected: same set of pre-existing failures as Task 2 left (services/routes not yet updated) — no *new* failures introduced by the schema types themselves. If `packages/db`'s own typecheck fails, fix that before moving on; downstream `apps/api` failures are expected and addressed in later tasks.

- [ ] **Step 10: Commit**

```bash
git add packages/db/src/schema/spatial-calibration.ts packages/db/src/schema/match-spatial-grids.ts packages/db/src/schema/match-hero-trajectories.ts packages/db/src/schema/hero-map-spatial-rollup.ts packages/db/src/schema/match-deaths.ts packages/db/drizzle/
git commit -m "feat(db): add layer dimension to spatial calibration, grids, trajectories, rollups"
```

---

### Task 4: `spatial-layer.ts` helper

**Files:**
- Create: `apps/api/src/lib/spatial-layer.ts`
- Create: `apps/api/src/lib/spatial-layer.test.ts`

**Interfaces:**
- Produces: `DEFAULT_LAYER_KEY = ""`, `toDbLayer(layer: string | null | undefined): string`, `fromDbLayer(layer: string): string | null` — the only place in the whole codebase that converts between the wire's `string | null` and the DB's `NOT NULL DEFAULT ''` sentinel.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { DEFAULT_LAYER_KEY, fromDbLayer, toDbLayer } from "./spatial-layer";

describe("toDbLayer", () => {
  test("maps null to the default sentinel", () => {
    expect(toDbLayer(null)).toBe(DEFAULT_LAYER_KEY);
  });
  test("maps undefined to the default sentinel", () => {
    expect(toDbLayer(undefined)).toBe(DEFAULT_LAYER_KEY);
  });
  test("passes a real layer key through unchanged", () => {
    expect(toDbLayer("bottom")).toBe("bottom");
  });
});

describe("fromDbLayer", () => {
  test("maps the default sentinel back to null", () => {
    expect(fromDbLayer(DEFAULT_LAYER_KEY)).toBeNull();
  });
  test("passes a real layer key through unchanged", () => {
    expect(fromDbLayer("bottom")).toBe("bottom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/src/lib/spatial-layer.test.ts`
Expected: FAIL — module `./spatial-layer` doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
/**
 * The DB's sentinel for "a map's default/only level" -- Postgres can't
 * enforce uniqueness across a nullable composite-key column, so every
 * layer-keyed table (see packages/db/src/schema/{spatial-calibration,
 * match-spatial-grids,match-hero-trajectories,hero-map-spatial-rollup}.ts)
 * stores this instead of the wire format's `null`. Every existing row
 * predating multi-layer support has this value via each layer column's own
 * `DEFAULT ''`.
 */
export const DEFAULT_LAYER_KEY = "";

/** Wire `layer` (`string | null`, possibly `undefined` from an older
 * daemon build's payload) -> DB sentinel. */
export function toDbLayer(layer: string | null | undefined): string {
  return layer ?? DEFAULT_LAYER_KEY;
}

/** DB sentinel -> wire `layer` (`string | null`). */
export function fromDbLayer(layer: string): string | null {
  return layer === DEFAULT_LAYER_KEY ? null : layer;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/src/lib/spatial-layer.test.ts`
Expected: PASS, all 5.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/spatial-layer.ts apps/api/src/lib/spatial-layer.test.ts
git commit -m "feat(api): add wire/DB layer-sentinel conversion helper"
```

---

### Task 5: Calibration service + admin route — layer-aware CRUD

**Files:**
- Modify: `apps/api/src/services/spatial-calibration.service.ts`
- Modify: `apps/api/src/routes/admin-spatial.ts`

**Interfaces:**
- Consumes: `DEFAULT_LAYER_KEY`, `toDbLayer`, `fromDbLayer` from `../lib/spatial-layer` (Task 4).
- Produces: `getAllCalibrations(): Promise<Record<string, Record<string, MapBounds & {updatedAt: string}>>>` (nested — was flat). `saveCalibration(mapId: string, layer: string, bounds: MapBounds): Promise<void>` (gains `layer` param). `listCalibratedMaps(): Promise<{mapId: string; mapName: string; layer: string; bounds: MapBounds; updatedAt: string}[]>` (gains `layer` field per row; one row per calibrated `(mapId, layer)` pair now, not per `mapId`). `listPendingMapIds()`/`getPendingSample()`/`upsertRawSamples()`/`generateExampleSample()` unchanged.

- [ ] **Step 1: Edit `spatial-calibration.service.ts`**

Replace `toBounds`, `getAllCalibrations`, `listCalibratedMaps`, and `saveCalibration`:

```ts
import { type MapCalibration, type RawMapSample, db, mapCalibrations, maps, rawMapSamples } from "@hots-stats/db";
import type { MapBounds } from "@hots-stats/shared-types";
import { and, eq, isNull } from "drizzle-orm";
import { ensureMapExists } from "../lib/ensure-map";
import { DEFAULT_LAYER_KEY } from "../lib/spatial-layer";

function toBounds(row: MapCalibration): MapBounds {
  return { minX: row.minX, maxX: row.maxX, minY: row.minY, maxY: row.maxY };
}

/**
 * GET /spatial/calibrations -- the Daemon's full in-memory cache, refreshed
 * once per run/batch. mapId -> layer key -> bounds + `updatedAt`, so a
 * daemon can test a raw position against every calibrated layer of its
 * replay's map (see parser.py's `_normalized_position_samples_by_toon`) and
 * tell apart a layer it already knew about from one that's brand new or was
 * just recalibrated (see app.py's `_sync_spatial_calibrations`).
 */
export async function getAllCalibrations(): Promise<Record<string, Record<string, MapBounds & { updatedAt: string }>>> {
  const rows = await db.select().from(mapCalibrations);
  const result: Record<string, Record<string, MapBounds & { updatedAt: string }>> = {};
  for (const row of rows) {
    const byLayer = (result[row.mapId] ??= {});
    byLayer[row.layer] = { ...toBounds(row), updatedAt: row.updatedAt.toISOString() };
  }
  return result;
}
```

(Leave `upsertRawSamples`, the `EXAMPLE_*` constants, `randomInRange`, and `generateExampleSample` exactly as they are — the raw-sample cloud stays layer-agnostic.)

Replace `listPendingMapIds` (unchanged in behavior, but confirm the join still reads correctly against the now-composite-PK `mapCalibrations` — no code change needed, since `leftJoin` + `isNull(mapCalibrations.mapId)` already means "this mapId has zero calibration rows of any layer," which is still exactly right):

```ts
/**
 * GET /admin/spatial/pending-maps -- populates the calibration tool's "à
 * calibrer" list: maps with a raw sample but *no* calibrated layer at all
 * yet. A map that already has one calibrated layer and needs another (e.g.
 * Haunted Mines' "bottom" level) is *not* pending -- it's picked from the
 * "calibrated maps" list instead and given a new `layer` value when saving
 * (see `saveCalibration` below). A map keeps its raw sample row after being
 * calibrated (see `saveCalibration`), so "pending" is decided by the
 * calibration join, not by row presence -- otherwise every already-
 * calibrated map would still show up here forever.
 */
export async function listPendingMapIds(): Promise<{ mapId: string; mapName: string; pointCount: number }[]> {
  const rows = await db
    .select({ mapId: rawMapSamples.mapId, mapName: maps.name, rawPoints: rawMapSamples.rawPoints })
    .from(rawMapSamples)
    .innerJoin(maps, eq(maps.id, rawMapSamples.mapId))
    .leftJoin(mapCalibrations, eq(mapCalibrations.mapId, rawMapSamples.mapId))
    .where(isNull(mapCalibrations.mapId));
  return rows.map((row) => ({ mapId: row.mapId, mapName: row.mapName, pointCount: row.rawPoints.length }));
}

/**
 * GET /admin/spatial/calibrated-maps -- lets the tool offer every
 * already-calibrated `(map, layer)` pair for editing, and is also how the
 * tool discovers which maps can have a *new* layer added (any map appearing
 * here at all is a candidate -- see calibrate.vue's "Ajouter un niveau").
 */
export async function listCalibratedMaps(): Promise<
  { mapId: string; mapName: string; layer: string; bounds: MapBounds; updatedAt: string }[]
> {
  const rows = await db
    .select({ mapId: mapCalibrations.mapId, mapName: maps.name, calibration: mapCalibrations })
    .from(mapCalibrations)
    .innerJoin(maps, eq(maps.id, mapCalibrations.mapId));
  return rows.map((row) => ({
    mapId: row.mapId,
    mapName: row.mapName,
    layer: row.calibration.layer,
    bounds: toBounds(row.calibration),
    updatedAt: row.calibration.updatedAt.toISOString(),
  }));
}

/** GET /admin/spatial/samples/:mapId */
export async function getPendingSample(mapId: string): Promise<RawMapSample | null> {
  const [row] = await db.select().from(rawMapSamples).where(eq(rawMapSamples.mapId, mapId)).limit(1);
  return row ?? null;
}

/**
 * POST /admin/spatial/calibrate -- saves (or updates) one `(mapId, layer)`
 * pair's world bounds. `layer` defaults to `DEFAULT_LAYER_KEY` ("") for a
 * map's default level; a non-empty value creates or updates an *additional*
 * level for the same map (the composite PK means this never overwrites a
 * different layer's row). Its raw sample row (if any) is deliberately left
 * in place so re-opening an already-calibrated map -- to fix a mistake, or
 * to add another level -- still has points to render against.
 */
export async function saveCalibration(mapId: string, layer: string, bounds: MapBounds): Promise<void> {
  await ensureMapExists(mapId);
  await db
    .insert(mapCalibrations)
    .values({ mapId, layer, ...bounds })
    .onConflictDoUpdate({
      target: [mapCalibrations.mapId, mapCalibrations.layer],
      set: { ...bounds, updatedAt: new Date() },
    });
}
```

Note: `DEFAULT_LAYER_KEY` is imported but only actually referenced in the docstring above, not in code in this file (the default lives in the zod schema from Task 2, `layer: z.string().trim().default("")`) — remove the unused import if your editor/`tsc` flags it, or keep it only if you use it; check with `bun run --filter './apps/api' typecheck` in Step 3 below and delete the import if unused.

- [ ] **Step 2: Edit `admin-spatial.ts`**

Update the `POST /calibrate` handler's destructuring:

```ts
  .post("/calibrate", async (c) => {
    const parsed = postSpatialCalibrateInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const { mapId, layer, ...bounds } = parsed.data;
    await saveCalibration(mapId, layer, bounds);
    return c.json({ status: "ok" });
  });
```

(Everything else in this file is unchanged — `postSpatialCalibrateInputSchema` already includes `layer` from Task 2.)

- [ ] **Step 3: Typecheck**

Run: `bun run --filter './apps/api' typecheck`
Expected: PASS for these two files specifically (other files touched by later tasks may still fail — that's expected until those tasks land).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/spatial-calibration.service.ts apps/api/src/routes/admin-spatial.ts
git commit -m "feat(api): layer-aware calibration CRUD"
```

---

### Task 6: Admin calibration UI — layer input, image slug, per-layer list

**Files:**
- Modify: `apps/web/app/pages/admin/calibrate.vue`
- Modify: `apps/web/app/components/admin/CalibrationCanvas.vue`

**Interfaces:**
- Consumes: `GET /admin/spatial/calibrated-maps` rows now include `layer: string` (Task 5). `POST /admin/spatial/calibrate` body now requires `layer: string`.
- Produces: `CalibrationCanvas.vue` gains prop `layer?: string | null` (default `null`), computing its image slug as `layer ? `${mapId}-${layer}` : mapId` — this is what makes selecting `layer: "bottom"` for `haunted-mines` resolve to the pre-existing `haunted-mines-bottom.jpg` asset with no extra config.

- [ ] **Step 1: Edit `CalibrationCanvas.vue`**

Add a `layer` prop and compute the image slug from it:

```ts
const props = defineProps<{
  mapId: string;
  layer?: string | null;
  points: { x: number; y: number }[];
  bounds: MapBoundsInput;
}>();

const imageSlug = computed(() => (props.layer ? `${props.mapId}-${props.layer}` : props.mapId));
```

Change the template's `<img>` `src`:

```html
<img
  ref="imgEl"
  :src="`/images/maps/original/${imageSlug}.jpg`"
  :alt="mapId"
  class="block w-full"
  @load="syncCanvasSize"
/>
```

- [ ] **Step 2: Edit `calibrate.vue`'s script — state and map/layer selection**

Replace the `PendingMapEntry`/`CalibratedMapEntry` interfaces, `mapOptions`, and the `selectedMapId` watcher with layer-aware versions. The select's `value` becomes a composite `${mapId}::${layer}` string so distinct layers of the same map are distinguishable options; a new "add a layer to this map" affordance appears for any map that already has at least one calibrated layer.

```ts
interface PendingMapEntry {
  mapId: string;
  mapName: string;
  pointCount: number;
}
interface CalibratedMapEntry {
  mapId: string;
  mapName: string;
  layer: string;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  updatedAt: string;
}

const { data: pendingMaps, refresh: refreshPendingMaps } = await useApiFetch<{ maps: PendingMapEntry[] }>(
  "/admin/spatial/pending-maps",
  { withGameMode: false },
);
const { data: calibratedMaps, refresh: refreshCalibratedMaps } = await useApiFetch<{ maps: CalibratedMapEntry[] }>(
  "/admin/spatial/calibrated-maps",
  { withGameMode: false },
);

async function refreshMapLists() {
  await Promise.all([refreshPendingMaps(), refreshCalibratedMaps()]);
}

function layerLabel(layer: string): string {
  return layer ? layer : "(défaut)";
}
function optionKey(mapId: string, layer: string): string {
  return `${mapId}::${layer}`;
}

interface MapOption {
  label: string;
  value: string; // optionKey(mapId, layer)
  mapId: string;
  layer: string;
  status: "pending" | "calibrated" | "new-layer";
}
const mapOptions = computed<MapOption[]>(() => [
  ...(pendingMaps.value?.maps ?? []).map((m) => ({
    label: `${m.mapName} — à calibrer (${m.pointCount} points)`,
    value: optionKey(m.mapId, ""),
    mapId: m.mapId,
    layer: "",
    status: "pending" as const,
  })),
  ...(calibratedMaps.value?.maps ?? []).map((m) => ({
    label: `${m.mapName} — ${layerLabel(m.layer)} (déjà calibrée)`,
    value: optionKey(m.mapId, m.layer),
    mapId: m.mapId,
    layer: m.layer,
    status: "calibrated" as const,
  })),
]);

const selectedOptionKey = ref<string | undefined>(undefined);
const selectedOption = computed(() => mapOptions.value.find((m) => m.value === selectedOptionKey.value) ?? null);
const selectedMapId = computed(() => selectedOption.value?.mapId);
const points = ref<{ x: number; y: number }[]>([]);
const loadingSample = ref(false);

const minX = ref(0);
const maxX = ref(1);
const minY = ref(0);
const maxY = ref(1);
const layer = ref("");
const bounds = computed(() => ({ minX: minX.value, maxX: maxX.value, minY: minY.value, maxY: maxY.value }));

// Every distinct mapId already offered by either list -- lets "Ajouter un
// niveau" target any map that has at least a pending sample or one
// calibrated layer, not just already-multi-level ones.
const knownMapIds = computed<{ id: string; name: string }[]>(() => {
  const byId = new Map<string, string>();
  for (const m of pendingMaps.value?.maps ?? []) byId.set(m.mapId, m.mapName);
  for (const m of calibratedMaps.value?.maps ?? []) byId.set(m.mapId, m.mapName);
  return [...byId.entries()].map(([id, name]) => ({ id, name }));
});
const newLayerMapId = ref<string | undefined>(undefined);
const newLayerKey = ref("");

async function loadSampleFor(mapId: string) {
  loadingSample.value = true;
  try {
    const sample = await $fetch<{ mapId: string; points: { x: number; y: number }[] }>(
      `/admin/spatial/samples/${mapId}`,
      { baseURL: config.public.apiBase, credentials: "include" },
    );
    points.value = sample.points;
  } catch (err) {
    if (!(err as { statusCode?: number })?.statusCode || (err as { statusCode?: number }).statusCode !== 404) {
      toast.add({ title: "Impossible de charger l'échantillon", color: "error" });
    }
  } finally {
    loadingSample.value = false;
  }
}

watch(selectedOptionKey, async (key) => {
  points.value = [];
  minX.value = 0;
  maxX.value = 1;
  minY.value = 0;
  maxY.value = 1;
  layer.value = "";
  if (!key) return;
  const option = mapOptions.value.find((m) => m.value === key);
  if (!option) return;
  layer.value = option.layer;

  if (option.status === "calibrated") {
    const existing = calibratedMaps.value?.maps.find((m) => m.mapId === option.mapId && m.layer === option.layer);
    if (existing) {
      minX.value = existing.bounds.minX;
      maxX.value = existing.bounds.maxX;
      minY.value = existing.bounds.minY;
      maxY.value = existing.bounds.maxY;
    }
  }

  await loadSampleFor(option.mapId);
});

/** Starts calibrating a brand new layer (not yet saved) for `mapId`, reusing
 * that map's existing raw sample cloud -- the same undifferentiated points
 * shown for any other layer of this map, since an admin carves each level's
 * rectangle out by eye. */
async function addLayer() {
  if (!newLayerMapId.value || !newLayerKey.value.trim()) return;
  const mapId = newLayerMapId.value;
  const layerKey = newLayerKey.value.trim();
  selectedOptionKey.value = undefined;
  layer.value = layerKey;
  minX.value = 0;
  maxX.value = 1;
  minY.value = 0;
  maxY.value = 1;
  await loadSampleFor(mapId);
  // Not present in mapOptions (unsaved) -- track it as pseudo-selection via
  // a synthetic option key so the canvas/save button still have a mapId to
  // work against.
  pendingNewLayer.value = { mapId, layer: layerKey };
  newLayerKey.value = "";
}

const pendingNewLayer = ref<{ mapId: string; layer: string } | null>(null);
const activeMapId = computed(() => pendingNewLayer.value?.mapId ?? selectedMapId.value);
const activeLayer = computed(() => (pendingNewLayer.value ? pendingNewLayer.value.layer : layer.value));
```

- [ ] **Step 3: Update `autoFitBounds` and `save` to use `activeMapId`/`activeLayer`**

`autoFitBounds` is unchanged (still operates on `points`/`minX`.../`maxY` refs). Update `calibrationField`/`save`:

```ts
const calibrationField = useSavableField(async () => {
  await $fetch("/admin/spatial/calibrate", {
    method: "POST",
    baseURL: config.public.apiBase,
    credentials: "include",
    body: { mapId: activeMapId.value, layer: activeLayer.value, ...bounds.value },
  });
});
const saving = calibrationField.loading;
const saveError = calibrationField.error;

async function save() {
  if (!activeMapId.value) return;
  await calibrationField.submit(undefined);
  if (saveError.value) return;
  toast.add({ title: "Carte calibrée", color: "success" });
  const savedMapId = activeMapId.value;
  const savedLayer = activeLayer.value;
  pendingNewLayer.value = null;
  selectedOptionKey.value = undefined;
  points.value = [];
  await refreshMapLists();
  selectedOptionKey.value = optionKey(savedMapId, savedLayer);
}
```

- [ ] **Step 4: Update the template**

Change the map picker's `v-model` and add the "Ajouter un niveau" block, plus pass `layer` to the canvas:

```html
<USelectMenu v-model="selectedOptionKey" value-key="value" :items="mapOptions" placeholder="Choisir une carte…" />
```

After the existing "Tester l'outil" `<details>` block, add:

```html
<details class="rounded-lg border border-dashed border-border p-4 text-sm sm:p-6">
  <summary class="cursor-pointer font-heading text-sm text-muted">Ajouter un niveau à une carte existante</summary>
  <div class="mt-3 space-y-3">
    <p class="text-xs text-muted">
      Pour une carte multi-niveaux (ex. Mines Hantées : surface + sous-sol), calibre chaque niveau séparément à
      partir du même nuage de points brut. Le nom du niveau détermine l'image de fond utilisée --
      <code>haunted-mines</code> + niveau <code>bottom</code> affiche <code>haunted-mines-bottom.jpg</code>.
    </p>
    <div class="flex flex-wrap items-center gap-2">
      <USelectMenu
        v-model="newLayerMapId"
        :items="knownMapIds.map((m) => ({ label: m.name, value: m.id }))"
        value-key="value"
        size="sm"
        class="w-56"
        placeholder="Carte…"
      />
      <UInput v-model="newLayerKey" size="sm" placeholder="Nom du niveau (ex. bottom)" class="w-56" />
      <UButton size="sm" variant="soft" color="neutral" @click="addLayer">Démarrer la calibration</UButton>
    </div>
  </div>
</details>
```

Change the `v-if` guard and canvas/bounds section to use `activeMapId`/`activeLayer`:

```html
<div v-if="activeMapId" class="grid gap-6 lg:grid-cols-[3fr_2fr]">
  <div class="space-y-2">
    <AdminCalibrationCanvas :map-id="activeMapId" :layer="activeLayer || null" :points="points" :bounds="bounds" />
    <p class="text-xs text-muted">{{ points.length }} point(s) chargé(s) — niveau « {{ activeLayer || "(défaut)" }} »</p>
  </div>

  <section class="space-y-4 rounded-lg border border-border p-4 sm:p-6">
    <h2 class="font-heading text-lg">
      Bornes du monde
      <UBadge v-if="selectedOption?.status === 'calibrated'" color="neutral" variant="subtle" size="sm">
        Modification
      </UBadge>
    </h2>
    <!-- ...unchanged min/max inputs and Save button, no id changes needed... -->
  </section>
</div>
```

- [ ] **Step 5: Manual verification**

Run: `bun run dev:web` (and `bun run dev:api`), sign in as an admin, open `/admin/spatial/calibrate`.
- Generate an example sample for `haunted-mines` (the "Tester l'outil" section), select it, verify the canvas shows the surface image and points project onto it.
- Save that as the default layer (leave the layer field's implicit `""`).
- Use "Ajouter un niveau à une carte existante", pick Haunted Mines, type `bottom`, verify the canvas now shows `haunted-mines-bottom.jpg` as the background with the same raw point cloud, adjust bounds, save.
- Reload the page, confirm both "Haunted Mines — (défaut)" and "Haunted Mines — bottom" now appear in the picker under "déjà calibrée", independently editable.

- [ ] **Step 6: Typecheck**

Run: `bun run --filter './apps/web' typecheck`
Expected: PASS for these two files (unrelated pre-existing failures from earlier tasks, if any, are fine at this point).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/pages/admin/calibrate.vue apps/web/app/components/admin/CalibrationCanvas.vue
git commit -m "feat(web): layer-aware admin calibration tool"
```

---

### Task 7: Daemon — multi-layer position/spatial/trajectory/death extraction

**Files:**
- Modify: `daemon-python/src/parser.py` (`_normalized_position_samples_by_toon`, `_position_at_or_before`, `_extract_spatial`, `_extract_trajectories`, `_extract_deaths`, `build_payload`)
- Modify: `daemon-python/src/constants.py` (changelog + `PARSER_VERSION` bump to `"1.13"`)
- Test: `daemon-python/tests/test_parser.py`

**Interfaces:**
- Produces: `_normalized_position_samples_by_toon(tracker_events, tracker_id_to_toon, calibrations: dict[str, dict[str, float]]) -> dict[str, list[tuple[int, str | None, float, float]]]` — `calibrations` is now *one map's* per-layer dict (`{layerKey: bounds}`), and each returned sample tuple gains a `layer: str | None` in position 2. `_position_at_or_before(samples, gameloop) -> tuple[str | None, float, float] | None` — returns `(layer, xn, yn)` instead of `(xn, yn)`. `_extract_spatial`/`_extract_trajectories` now take `calibrations: dict[str, dict[str, float]]` (renamed from `calibration`) and can emit **multiple** presence/trajectory entries per hero, one per layer they were tracked on. `_extract_deaths` takes `calibrations: dict[str, dict[str, float]] | None` (renamed) and sets `death["layer"]` alongside `death["x"]`/`death["y"]`.
- Consumes: `build_payload`'s `calibrations` param (already `dict[str, dict] | None`, mapSlug -> per-layer dict, unchanged shape at this level — only what's *inside* each map's entry changes, from a flat bounds dict to a per-layer dict of bounds dicts).

- [ ] **Step 1: Write the failing tests**

Add near `test_build_payload_includes_spatial_block_for_calibrated_map` (around line 1260) in `daemon-python/tests/test_parser.py`:

```python
def test_extract_spatial_splits_one_hero_across_two_layers():
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroLiMing"),
        # Two samples in the default ("") layer's bounds, one in "bottom"'s.
        _unit_positions_event(610, [(1, 10.0, 10.0)]),
        _unit_positions_event(610 + 16 * 10, [(1, 20.0, 20.0)]),
        _unit_positions_event(610 + 16 * 20, [(1, 1010.0, 1010.0)]),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
        calibrations={
            "cursed-hollow": {
                "": {"minX": 0.0, "maxX": 100.0, "minY": 0.0, "maxY": 100.0},
                "bottom": {"minX": 1000.0, "maxX": 1100.0, "minY": 1000.0, "maxY": 1100.0},
            }
        },
    )

    entries = [p for p in payload["spatial"]["presence"] if p["battletag"] == "Foo#1111"]
    layers = {e["layer"] for e in entries}
    assert layers == {None, "bottom"}
    default_entry = next(e for e in entries if e["layer"] is None)
    bottom_entry = next(e for e in entries if e["layer"] == "bottom")
    assert sum(default_entry["secondsInCell"]) == pytest.approx(10.0, abs=0.1)
    assert bottom_entry["cellIndex"]


def test_extract_deaths_tags_death_layer():
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroLiMing"),
        _unit_positions_event(610, [(1, 1010.0, 1010.0)]),
        _unit_died_event(1, 0, at_gameloop=610 + 16 * 5),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
        calibrations={
            "cursed-hollow": {
                "": {"minX": 0.0, "maxX": 100.0, "minY": 0.0, "maxY": 100.0},
                "bottom": {"minX": 1000.0, "maxX": 1100.0, "minY": 1000.0, "maxY": 1100.0},
            }
        },
    )

    death = next(d for d in payload["timeline"]["deaths"] if d["battletag"] == "Foo#1111")
    assert death["layer"] == "bottom"
```

If `_unit_died_event` doesn't exist yet or has a different signature than assumed here, search the file for its actual name/signature (it's used by the existing `test_extract_deaths_omits_position_without_calibration` test around line 1432) and adjust the call to match exactly — do not guess further than checking that one existing call site.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd daemon-python && pytest tests/test_parser.py -k "splits_one_hero_across_two_layers or tags_death_layer" -v`
Expected: FAIL (old code has no multi-layer concept; `calibrations={"cursed-hollow": {"": {...}, "bottom": {...}}}` doesn't match the old flat-bounds-dict shape `_normalized_position_samples_by_toon` expects, so `calibration["minX"]` raises `KeyError`).

- [ ] **Step 3: Rewrite `_normalized_position_samples_by_toon`**

```python
def _normalized_position_samples_by_toon(
    tracker_events: list[dict],
    tracker_id_to_toon: dict[int, str],
    calibrations: dict[str, dict[str, float]],
) -> dict[str, list[tuple[int, str | None, float, float]]]:
    """Every `SUnitPositionsEvent` sample for a hero unit, normalized against
    whichever of `calibrations`' layers' world bounds contains it, into
    `[0,1]`, grouped by toon handle and sorted chronologically by gameloop.
    `calibrations` is one map's per-layer bounds dict (layer key -> `{minX,
    maxX, minY, maxY}`, `""` meaning the map's default/only level -- see
    apps/api/src/lib/spatial-layer.ts's DEFAULT_LAYER_KEY). Layers are tried
    in sorted key order and the first whose bounds contain the raw point
    wins; a point inside zero or more than one layer's bounds is dropped
    (an off-map position, or a still-imprecise calibration -- either way,
    not something that should corrupt a grid cell index). Assumes each
    layer's bounds are disjoint (see this plan's Global Constraints /
    tasks/epic-10-analyse-spatiale.md section 4's "à trancher
    empiriquement" note -- UNCONFIRMED against a real multi-layer replay).

    Shared by `_extract_spatial` (the presence grid) and `_extract_deaths`
    (each death's approximate position, looked up via
    `_position_at_or_before`) so both agree on exactly the same normalized
    positions and layer assignment. Returns `{}` if no layer's bounds are
    valid (can't happen from the calibration tool's own validation, guarded
    here since this function has no other way to signal it back).
    """
    layers = sorted(
        (key, b) for key, b in calibrations.items() if b["maxX"] > b["minX"] and b["maxY"] > b["minY"]
    )
    if not layers:
        return {}

    hero_tags = _hero_unit_tags_by_index(tracker_events, tracker_id_to_toon)
    samples: dict[str, list[tuple[int, str | None, float, float]]] = {}
    for gameloop, tag_index, x, y in _iter_unit_positions(tracker_events):
        toon_handle = hero_tags.get(tag_index)
        if toon_handle is None:
            continue
        matched: tuple[str | None, float, float] | None = None
        for layer_key, b in layers:
            xn = (x - b["minX"]) / (b["maxX"] - b["minX"])
            yn = (y - b["minY"]) / (b["maxY"] - b["minY"])
            if 0.0 <= xn <= 1.0 and 0.0 <= yn <= 1.0:
                matched = (layer_key or None, xn, yn)
                break
        if matched is None:
            continue
        samples.setdefault(toon_handle, []).append((gameloop, matched[0], matched[1], matched[2]))

    for toon_samples in samples.values():
        toon_samples.sort(key=lambda sample: sample[0])
    return samples
```

- [ ] **Step 4: Rewrite `_position_at_or_before`**

```python
def _position_at_or_before(
    samples: list[tuple[int, str | None, float, float]], gameloop: int
) -> tuple[str | None, float, float] | None:
    """Latest `(layer, x, y)` in `samples` (sorted by gameloop, see
    `_normalized_position_samples_by_toon`) at or before `gameloop`, or
    `None` if every sample is after it (e.g. the hero died before its first
    position sample)."""
    idx = bisect.bisect_right(samples, gameloop, key=lambda sample: sample[0]) - 1
    if idx < 0:
        return None
    _, layer, xn, yn = samples[idx]
    return layer, xn, yn
```

(This uses `bisect`'s `key=` parameter, available since Python 3.10 -- already relied on elsewhere in this codebase's `int | None`-style type hints, which require 3.10+.)

- [ ] **Step 5: Rewrite `_extract_spatial`**

```python
def _extract_spatial(
    tracker_events: list[dict],
    tracker_id_to_toon: dict[int, str],
    players: dict[str, Any],
    calibrations: dict[str, dict[str, float]],
) -> dict[str, Any] | None:
    """Builds the `spatial.presence[]` block: a sparse per-(hero, layer) grid
    of seconds spent in each cell, normalized against whichever of
    `calibrations`' layers contains each sample and interpolated between
    same-layer samples (see `_presence_seconds_by_cell`) --
    tasks/epic-10-analyse-spatiale.md Livrable 1. A hero present on more than
    one layer gets one `presence[]` entry per layer, matching that spec's "un
    objet par héros... par niveau si map multi-niveaux". Returns `None` if
    the replay has no `SUnitPositionsEvent` at all, or if no layer in
    `calibrations` is valid.
    """
    cols, rows = constants.SPATIAL_GRID_COLS, constants.SPATIAL_GRID_ROWS
    samples_by_toon = _normalized_position_samples_by_toon(tracker_events, tracker_id_to_toon, calibrations)
    if not samples_by_toon:
        return None

    presence = []
    for toon_handle, samples in samples_by_toon.items():
        if toon_handle not in players:
            continue
        player = players[toon_handle]
        samples_by_layer: dict[str | None, list[tuple[int, float, float]]] = {}
        for gameloop, layer, xn, yn in samples:
            samples_by_layer.setdefault(layer, []).append((gameloop, xn, yn))
        for layer, layer_samples in samples_by_layer.items():
            cells = _presence_seconds_by_cell(layer_samples, cols, rows)
            if not cells:
                continue
            cell_indices = sorted(cells)
            presence.append(
                {
                    "battletag": player["battletag"],
                    "heroId": player["heroId"],
                    "layer": layer,
                    "cellIndex": cell_indices,
                    "secondsInCell": [round(cells[idx], 2) for idx in cell_indices],
                }
            )

    if not presence:
        return None

    return {
        "schemaVersion": constants.SPATIAL_SCHEMA_VERSION,
        "grid": {"cols": cols, "rows": rows},
        "presence": presence,
    }
```

- [ ] **Step 6: Rewrite `_extract_trajectories`**

Apply the same per-layer split. Replace its body (keep the docstring's first two paragraphs, update the third to mention layers):

```python
def _extract_trajectories(
    tracker_events: list[dict],
    tracker_id_to_toon: dict[int, str],
    players: dict[str, Any],
    calibrations: dict[str, dict[str, float]],
    gates_open_loop: int,
) -> list[dict[str, Any]]:
    """... (keep existing docstring, add:) One entry per (hero, layer)
    touched, same split as `_extract_spatial`."""
    samples_by_toon = _normalized_position_samples_by_toon(tracker_events, tracker_id_to_toon, calibrations)
    if not samples_by_toon:
        return []

    interval_loops = constants.SPATIAL_TRAJECTORY_SAMPLE_INTERVAL_SECONDS * _GAMELOOPS_PER_SECOND
    trajectories: list[dict[str, Any]] = []
    for toon_handle, samples in samples_by_toon.items():
        if toon_handle not in players:
            continue
        player = players[toon_handle]
        samples_by_layer: dict[str | None, list[tuple[int, float, float]]] = {}
        for gameloop, layer, xn, yn in samples:
            samples_by_layer.setdefault(layer, []).append((gameloop, xn, yn))
        for layer, layer_samples in samples_by_layer.items():
            at_seconds: list[int] = []
            xs: list[float] = []
            ys: list[float] = []
            next_loop: float | None = None
            for loop, xn, yn in layer_samples:
                if next_loop is not None and loop < next_loop:
                    continue
                at_seconds.append(max(0, round((loop - gates_open_loop) / _GAMELOOPS_PER_SECOND)))
                xs.append(round(xn, 4))
                ys.append(round(yn, 4))
                next_loop = loop + interval_loops
            if not at_seconds:
                continue
            trajectories.append(
                {
                    "battletag": player["battletag"],
                    "heroId": player["heroId"],
                    "layer": layer,
                    "atSeconds": at_seconds,
                    "x": xs,
                    "y": ys,
                }
            )
    return trajectories
```

- [ ] **Step 7: Rewrite `_extract_deaths`**

Rename its `calibration: dict[str, float] | None` param to `calibrations: dict[str, dict[str, float]] | None`, update its call to `_normalized_position_samples_by_toon`, and set `death["layer"]` alongside `x`/`y`:

```python
def _extract_deaths(
    tracker_events: list[dict],
    hero_unit_tags: dict[tuple[int, int], str],
    tracker_id_to_toon: dict[int, str],
    players: dict[str, dict[str, Any]],
    gates_open_loop: int,
    calibrations: dict[str, dict[str, float]] | None,
) -> list[dict[str, Any]]:
    # (docstring: update the `x`/`y` bullet to also mention `layer` is set
    # alongside them, same gating.)
    samples_by_toon = (
        _normalized_position_samples_by_toon(tracker_events, tracker_id_to_toon, calibrations) if calibrations else {}
    )

    deaths: list[dict[str, Any]] = []
    for event in tracker_events:
        if event.get("_event") != _UNIT_DIED_EVENT:
            continue
        toon_handle = hero_unit_tags.get((event["m_unitTagIndex"], event["m_unitTagRecycle"]))
        player = players.get(toon_handle) if toon_handle else None
        if player is None:
            continue

        death: dict[str, Any] = {
            "battletag": player["battletag"],
            "team": player["team"],
            "atSeconds": max(0, round((event["_gameloop"] - gates_open_loop) / _GAMELOOPS_PER_SECOND)),
        }

        toon_samples = samples_by_toon.get(toon_handle) if toon_handle else None
        if toon_samples:
            position = _position_at_or_before(toon_samples, event["_gameloop"])
            if position is not None:
                death["layer"], death["x"], death["y"] = position

        killer_tracker_id = event.get("m_killerPlayerId")
        killer_toon = tracker_id_to_toon.get(killer_tracker_id) if killer_tracker_id is not None else None
        killer_player = players.get(killer_toon) if killer_toon else None
        if killer_player is not None:
            death["killers"] = [killer_player["battletag"]]
            death["killType"] = "hero"
        else:
            death["killers"] = []
            death["killType"] = "other"

        deaths.append(death)
    return deaths
```

- [ ] **Step 8: Update `build_payload`'s call sites**

Around line 1391-1405, rename the local `calibration` variable to `calibrations` throughout this section (it already held "this map's calibration value" — now that value is a per-layer dict instead of a flat bounds dict, so the variable name should reflect it, and every call site already updated above expects the new param name):

```python
    map_slug = _slugify(map_display_name)
    calibrations = calibrations_by_map.get(map_slug) if calibrations_by_map else None
```

Wait — `build_payload`'s own parameter is *also* named `calibrations` today (the full `dict[str, dict] | None` mapping every map slug to its data) and shadows what we're about to name the per-map value. Rename the outer parameter instead: in `build_payload`'s signature (around line 1164), rename `calibrations: dict[str, dict[str, float]] | None = None` to `calibrations_by_map: dict[str, dict[str, dict[str, float]]] | None = None`, and update its docstring paragraph describing that param. Then:

```python
    map_slug = _slugify(map_display_name)
    calibrations = calibrations_by_map.get(map_slug) if calibrations_by_map else None

    hero_unit_tags = _hero_unit_tags_by_toon(tracker_events, tracker_id_to_toon)
    deaths = _extract_deaths(tracker_events, hero_unit_tags, tracker_id_to_toon, players, gates_open_loop, calibrations)
    level_snapshots = _extract_level_snapshots(tracker_events, tracker_id_to_toon, players, gates_open_loop)
    structure_events = _extract_structure_events(tracker_events, tracker_id_to_toon, players, gates_open_loop)

    spatial = _extract_spatial(tracker_events, tracker_id_to_toon, players, calibrations) if calibrations else None
    trajectories = (
        _extract_trajectories(tracker_events, tracker_id_to_toon, players, calibrations, gates_open_loop)
        if calibrations
        else []
    )
    pending_points = None if calibrations else _collect_calibration_samples(tracker_events, tracker_id_to_toon)
```

Search the rest of `parser.py` for any other reference to the old `calibrations` parameter name within `build_payload`'s body (there should be none beyond what's shown above — this section is self-contained) and update `parse_replay`'s call into `build_payload` (search for `calibrations=` as a keyword argument at its call site) to pass `calibrations_by_map=calibrations` if `parse_replay` itself still has a `calibrations` local/param name — check that call site and rename the keyword only, not necessarily `parse_replay`'s own variable name.

- [ ] **Step 9: Update the two pre-existing `build_payload` tests that pass flat calibration bounds**

`test_build_payload_includes_spatial_block_for_calibrated_map` (line ~1260-1292) and `test_extract_spatial_returns_none_for_degenerate_calibration` / `test_extract_deaths_omits_position_without_calibration` (search for every `calibrations={"cursed-hollow": {"minX"` occurrence in the file) currently pass `calibrations={"cursed-hollow": {"minX": 0.0, "maxX": 100.0, "minY": 0.0, "maxY": 100.0}}`. Update every such occurrence to nest one level deeper under the default layer key:

```python
calibrations={"cursed-hollow": {"": {"minX": 0.0, "maxX": 100.0, "minY": 0.0, "maxY": 100.0}}},
```

For `test_build_payload_includes_spatial_block_for_calibrated_map` specifically, also add `assert foo["layer"] is None` is already there (line 1288) — leave it, it's still correct (the default layer normalizes to `None`).

- [ ] **Step 10: Run all daemon tests**

Run: `cd daemon-python && pytest tests/test_parser.py -v`
Expected: PASS across the board. If any test besides the ones explicitly touched above fails, it's calling one of the rewritten functions with the old shape — find it via the failure's traceback and update it the same way as Step 9.

Run: `cd daemon-python && pytest -q`
Expected: PASS, full suite.

- [ ] **Step 11: Bump PARSER_VERSION**

In `daemon-python/src/constants.py`, bump `PARSER_VERSION` to `"1.13"` and add a changelog entry above it:

```python
# 1.13: adds multi-layer support to the `spatial` block -- a map with more
# than one calibrated layer (e.g. Haunted Mines' surface + underground mine,
# see tasks/epic-10-analyse-spatiale.md section 4) now gets one
# `spatial.presence[]`/`spatial.trajectories[]` entry per (hero, layer)
# touched, and `timeline.deaths[].layer` records which layer a death's `x`/
# `y` are normalized against, instead of every position on the map being
# forced through one flat, single-rectangle calibration regardless of which
# physical area it actually came from. `layer` was already reserved (always
# `null`) in every prior version's schema -- this just starts populating it
# for maps an admin has calibrated more than one layer of. A single-layer
# map is completely unaffected (`layer` stays `null` for it). Deliberately
# NOT paired with a `MIN_PARSER_VERSION` bump, same additive-only reasoning
# as 1.8/1.11: a match ingested before this ships simply keeps its existing
# single, `layer: null` grid until it happens to resync for some other
# reason.
```

- [ ] **Step 12: Run tests once more**

Run: `cd daemon-python && pytest -q`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add daemon-python/src/parser.py daemon-python/src/constants.py daemon-python/tests/test_parser.py
git commit -m "feat(daemon): extract per-layer spatial presence, trajectories, and death positions"
```

---

### Task 8: Daemon — nested calibration-diffing in `ingestion.py`

**Files:**
- Modify: `daemon-python/src/ingestion.py` (`_previously_cached_calibrations`, `sync_spatial_calibrations`)
- Modify: `daemon-python/src/api_client.py` (`fetch_calibrations`'s docstring only — its body is a passthrough `response.json()`, no code change needed)
- Test: `daemon-python/tests/test_ingestion.py` (find and update whatever test currently exercises `sync_spatial_calibrations`'s diffing — search for `sync_spatial_calibrations` or `_previously_cached_calibrations` in that file first)

**Interfaces:**
- Produces: `sync_spatial_calibrations(config, sync_state) -> dict[str, dict[str, dict]]` — same function name/param signature, but the returned/cached dict is now two levels deep (mapSlug -> layerKey -> bounds+updatedAt) and gets passed straight into `parser.build_payload`'s new `calibrations_by_map` parameter (Task 7) unchanged.

- [ ] **Step 1: Locate and read the existing test(s)**

Run: `cd daemon-python && grep -n "sync_spatial_calibrations\|_previously_cached_calibrations" tests/test_ingestion.py`

Read every matched test fully before changing anything — they currently assert against the flat `{"map-slug": {"minX": ..., "updatedAt": ...}}` shape and need updating to the nested one, following the exact same pattern used in Task 7's daemon test updates (nest one level deeper under a layer key, e.g. `""`).

- [ ] **Step 2: Update those tests**

For each, change any calibration fixture dict from `{"some-map": {"minX": 0, ..., "updatedAt": "..."}}` to `{"some-map": {"": {"minX": 0, ..., "updatedAt": "..."}}}`, and update any assertion that reads `calibrations["some-map"]["minX"]` (or similar) to `calibrations["some-map"][""]["minX"]`. If a test exercises the "changed maps get invalidated" diffing logic by mutating `updatedAt`, mutate it at the nested layer level (`calibrations["some-map"][""]["updatedAt"] = "..."`), not the outer one.

- [ ] **Step 3: Run to verify failure**

Run: `cd daemon-python && pytest tests/test_ingestion.py -k "calibration" -v`
Expected: FAIL (the diffing code still assumes the flat shape).

- [ ] **Step 4: Rewrite the diffing logic**

In `daemon-python/src/ingestion.py`, replace the `changed_maps` computation inside `sync_spatial_calibrations` (around lines 398-403):

```python
    previous = _previously_cached_calibrations(sync_state)
    changed_maps = {
        map_slug
        for map_slug, layers in calibrations.items()
        for layer_key, bounds in layers.items()
        if map_slug not in previous
        or layer_key not in previous[map_slug]
        or previous[map_slug][layer_key].get("updatedAt") != bounds.get("updatedAt")
    }
```

(Everything else in `sync_spatial_calibrations` -- the `fetch_calibrations` call, the offline fallback, `invalidate_stale_for_maps(changed_maps)`, the logging, and caching the result via `sync_state.set_meta` -- stays exactly as-is: `changed_maps` is still a `set[str]` of map slugs, since a change to *any* layer of a map should invalidate that whole map's previously-synced replays, same reasoning as today.)

Update `_previously_cached_calibrations`'s return type annotation from `dict[str, dict]` to `dict[str, dict[str, dict]]`, and `sync_spatial_calibrations`'s return type annotation the same way (the body of both is otherwise unchanged — `_previously_cached_calibrations` just parses whatever JSON was cached, which is now nested, and `sync_spatial_calibrations` returns `calibrations` as-is).

- [ ] **Step 5: Update `api_client.fetch_calibrations`'s docstring**

In `daemon-python/src/api_client.py`, update the docstring (the function body is an unchanged passthrough — no code change):

```python
def fetch_calibrations(base_url: str, access_token: str, timeout: float = 5.0) -> dict[str, dict] | None:
    """Best-effort `GET {base_url}/spatial/calibrations` fetch: `{mapId:
    {layerKey: {minX, maxX, minY, maxY, updatedAt}}}` for every calibrated
    map, one inner entry per calibrated layer (`""` = a map's default/only
    level). `updatedAt` is used (not by `parser.build_payload`'s
    normalization math, which only reads the 4 bound keys per layer) to
    detect a layer that's new or was just recalibrated since the last run --
    see `ingestion.sync_spatial_calibrations`, which diffs against the
    previous run's cached dict and invalidates that map's already-synced
    replays so they get reparsed. Cached in `SyncState`'s `meta` table so a
    temporarily-unreachable API falls back to the last known calibrations
    instead of treating every map as uncalibrated. Returns None on any
    failure -- callers must treat that as "unknown", not "nothing is
    calibrated"."""
```

- [ ] **Step 6: Verify `build_payload`'s call site receives the right shape**

Find where `parser.build_payload(..., calibrations=calibrations, ...)` (or `calibrations_by_map=` after Task 7's rename) is called from `ingestion.ingest_file`/`resync` — confirm it passes `sync_spatial_calibrations`'s return value straight through with no reshaping. Since Task 7 renamed `build_payload`'s parameter to `calibrations_by_map`, update this call site's keyword argument name to match.

- [ ] **Step 7: Run tests**

Run: `cd daemon-python && pytest tests/test_ingestion.py -v`
Expected: PASS.

Run: `cd daemon-python && pytest -q`
Expected: PASS, full suite.

- [ ] **Step 8: Commit**

```bash
git add daemon-python/src/ingestion.py daemon-python/src/api_client.py daemon-python/tests/test_ingestion.py
git commit -m "feat(daemon): diff spatial calibrations per layer, not per map"
```

---

### Task 9: API — layer-aware replay ingest write path

**Files:**
- Modify: `apps/api/src/services/replay-upsert.service.ts`
- Modify: `apps/api/src/services/spatial-rollup.service.ts`

**Interfaces:**
- Consumes: `toDbLayer`, `fromDbLayer` from `../lib/spatial-layer` (Task 4). `payload.spatial.presence[].layer`, `payload.spatial.trajectories[].layer`, `payload.timeline.deaths[].layer` now populated by the daemon (Task 7).
- Produces: `SpatialGridContribution` (spatial-rollup.service.ts) gains `layer: string` (DB-sentinel form, always run through `toDbLayer` before construction). `PlayerSpatialContribution` (replay-upsert.service.ts, internal) gains `layer: string`. `buildSpatialContributions` keys its map by `` `${battletag}::${layer}` `` instead of `battletag` alone.

- [ ] **Step 1: Edit `spatial-rollup.service.ts`**

Add `layer: string` to `SpatialGridContribution` and thread it through both WHERE clauses and both insert branches:

```ts
export interface SpatialGridContribution {
  mapId: string;
  heroId: string;
  layer: string;
  battletag: string;
  outcome: "win" | "loss";
  gridCols: number;
  gridRows: number;
  presenceGrid: Grid;
  killsGrid: Grid;
  deathsGrid: Grid;
}
```

In `applyPlayerRollupDelta`, add `eq(heroMapPlayerSpatialRollup.layer, c.layer)` to the `and(...)` in the `SELECT`, and `layer: c.layer` to the `INSERT` values:

```ts
  const [existing] = await tx
    .select()
    .from(heroMapPlayerSpatialRollup)
    .where(
      and(
        eq(heroMapPlayerSpatialRollup.mapId, c.mapId),
        eq(heroMapPlayerSpatialRollup.heroId, c.heroId),
        eq(heroMapPlayerSpatialRollup.layer, c.layer),
        eq(heroMapPlayerSpatialRollup.battletag, c.battletag),
        eq(heroMapPlayerSpatialRollup.outcome, c.outcome),
      ),
    )
    .limit(1);

  if (!existing) {
    if (sign < 0) return;
    await tx.insert(heroMapPlayerSpatialRollup).values({
      mapId: c.mapId,
      heroId: c.heroId,
      layer: c.layer,
      battletag: c.battletag,
      outcome: c.outcome,
      matchCount: 1,
      gridCols: c.gridCols,
      gridRows: c.gridRows,
      presenceGrid: c.presenceGrid,
      killsGrid: c.killsGrid,
      deathsGrid: c.deathsGrid,
    });
    return;
  }
```

Apply the exact same two edits (WHERE clause `eq(...layer, c.layer)`, insert values `layer: c.layer`) to `applyGlobalRollupDelta`.

- [ ] **Step 2: Edit `replay-upsert.service.ts` — imports and `PlayerSpatialContribution`**

```ts
import { displayNameFromSlug, ensureMapExists } from "../lib/ensure-map";
import { computeGameFingerprint } from "../lib/game-fingerprint";
import { isVersionGreater } from "../lib/parser-version";
import { toDbLayer } from "../lib/spatial-layer";
import { type SpatialGridContribution, applySpatialRollupDelta } from "./spatial-rollup.service";
```

(Only `toDbLayer` is needed in this file — every layer value this file writes originates from the wire payload or from a DB row already in DB-sentinel form; nothing here needs to convert a DB sentinel back to wire `null`, so `fromDbLayer` is deliberately not imported. `match_deaths.layer` stores the wire's real `string | null` directly, per Task 3 Step 5 — see Step 5 below.)

```ts
interface PlayerSpatialContribution {
  battletag: string;
  heroId: string;
  layer: string;
  gridCols: number;
  gridRows: number;
  presenceGrid: Grid;
  killsGrid: Grid;
  deathsGrid: Grid;
}
```

- [ ] **Step 3: Rewrite `buildSpatialContributions`**

Key the map by `battletag::layer` instead of `battletag` alone, and tag each death's kill/death cell increment onto the contribution matching *that death's own* layer (falling back to the default layer if the death predates this feature and carries no `layer`):

```ts
function buildSpatialContributions(payload: ReplayPayload): PlayerSpatialContribution[] | null {
  if (!payload.spatial) return null;
  const { cols, rows } = payload.spatial.grid;

  const contributions = new Map<string, PlayerSpatialContribution>();
  const key = (battletag: string, layer: string) => `${battletag}::${layer}`;
  for (const entry of payload.spatial.presence) {
    const layer = toDbLayer(entry.layer);
    contributions.set(key(entry.battletag, layer), {
      battletag: entry.battletag,
      heroId: entry.heroId,
      layer,
      gridCols: cols,
      gridRows: rows,
      presenceGrid: gridFromWireArrays(entry.cellIndex, entry.secondsInCell),
      killsGrid: {},
      deathsGrid: {},
    });
  }

  for (const death of payload.timeline?.deaths ?? []) {
    if (death.x === undefined || death.y === undefined) continue;
    const layer = toDbLayer(death.layer);
    const cellIndex = cellIndexForPosition(death.x, death.y, cols, rows);

    const victim = contributions.get(key(death.battletag, layer));
    if (victim) incrementCell(victim.deathsGrid, cellIndex);

    for (const killerBattletag of death.killers ?? []) {
      const killer = contributions.get(key(killerBattletag, layer));
      if (killer) incrementCell(killer.killsGrid, cellIndex);
    }
  }

  return [...contributions.values()];
}
```

- [ ] **Step 4: Update `upsertReplay`'s use of `buildSpatialContributions`, the re-ingest old-contribution read, and the DB writes**

Change the contribution map keying (was `battletag` alone) and its consumers. First, where contributions are indexed for lookup per-player:

```ts
  const spatialContributionsByBattletag = new Map<string, PlayerSpatialContribution[]>();
  for (const c of buildSpatialContributions(payload) ?? []) {
    const list = spatialContributionsByBattletag.get(c.battletag) ?? [];
    list.push(c);
    spatialContributionsByBattletag.set(c.battletag, list);
  }
  const trajectoriesByBattletag = new Map<string, MatchHeroTrajectory[]>();
  for (const t of payload.spatial?.trajectories ?? []) {
    const list = trajectoriesByBattletag.get(t.battletag) ?? [];
    list.push(t);
    trajectoriesByBattletag.set(t.battletag, list);
  }
```

(This replaces the old single-entry `Map<string, PlayerSpatialContribution>` / `Map<string, MatchHeroTrajectory>` — a battletag can now have multiple contributions/trajectories, one per layer.)

Next, the re-ingest old-contribution read (inside the `if (existing) { ... }` branch) needs to select `layer` too and iterate per-row (it already does — `oldContributions` is already a row-per-`matchSpatialGrids`-row query; it just needs the new column selected and passed through):

```ts
      const oldContributions = await tx
        .select({
          battletag: matchPlayers.battletag,
          heroId: matchPlayers.heroId,
          winner: matchPlayers.winner,
          layer: matchSpatialGrids.layer,
          gridCols: matchSpatialGrids.gridCols,
          gridRows: matchSpatialGrids.gridRows,
          presenceGrid: matchSpatialGrids.presenceGrid,
          killsGrid: matchSpatialGrids.killsGrid,
          deathsGrid: matchSpatialGrids.deathsGrid,
        })
        .from(matchPlayers)
        .leftJoin(matchSpatialGrids, eq(matchSpatialGrids.matchPlayerId, matchPlayers.id))
        .where(eq(matchPlayers.matchId, matchId));

      for (const old of oldContributions) {
        if (old.gridCols === null || old.gridRows === null || old.presenceGrid === null || old.layer === null) continue;
        await applySpatialRollupDelta(
          tx,
          {
            mapId: existing.mapId,
            heroId: old.heroId,
            layer: old.layer,
            battletag: old.battletag,
            outcome: old.winner ? "win" : "loss",
            gridCols: old.gridCols,
            gridRows: old.gridRows,
            presenceGrid: old.presenceGrid,
            killsGrid: old.killsGrid ?? {},
            deathsGrid: old.deathsGrid ?? {},
          },
          -1,
        );
      }
```

(A `leftJoin` against a table now keyed by `(matchPlayerId, layer)` naturally returns one row per existing `matchSpatialGrids` row for that player — i.e. already one row per layer the hero had data on previously, or a single all-`null` row if they had none. No further change needed here beyond selecting `layer` and guarding `old.layer === null` the same way the other nullable columns already are.)

Then the per-player write loop — replace the single `spatial`/`trajectory` block with iteration over each player's list:

```ts
      const spatials = spatialContributionsByBattletag.get(player.battletag) ?? [];
      for (const spatial of spatials) {
        await tx.insert(matchSpatialGrids).values({
          matchPlayerId: createdPlayer.id,
          layer: spatial.layer,
          gridCols: spatial.gridCols,
          gridRows: spatial.gridRows,
          presenceGrid: spatial.presenceGrid,
          killsGrid: spatial.killsGrid,
          deathsGrid: spatial.deathsGrid,
        });

        const contribution: SpatialGridContribution = {
          mapId: payload.map,
          heroId: player.heroId,
          layer: spatial.layer,
          battletag: player.battletag,
          outcome: player.winner ? "win" : "loss",
          gridCols: spatial.gridCols,
          gridRows: spatial.gridRows,
          presenceGrid: spatial.presenceGrid,
          killsGrid: spatial.killsGrid,
          deathsGrid: spatial.deathsGrid,
        };
        await applySpatialRollupDelta(tx, contribution, 1);
      }

      const trajectories = trajectoriesByBattletag.get(player.battletag) ?? [];
      for (const trajectory of trajectories) {
        await tx.insert(matchHeroTrajectories).values({
          matchPlayerId: createdPlayer.id,
          layer: toDbLayer(trajectory.layer),
          atSeconds: trajectory.atSeconds,
          x: trajectory.x,
          y: trajectory.y,
        });
      }
```

- [ ] **Step 5: Write death rows with their layer**

In the same per-player loop, the existing death-insert block reads `death.x ?? null, death.y ?? null, ...` — add `layer`:

```ts
      const deaths = deathsByBattletag.get(player.battletag) ?? [];
      if (deaths.length > 0) {
        await tx.insert(matchDeaths).values(
          deaths.map((death) => ({
            matchPlayerId: createdPlayer.id,
            atSeconds: death.atSeconds,
            x: death.x ?? null,
            y: death.y ?? null,
            layer: death.layer ?? null,
            killers: death.killers ?? null,
            killType: death.killType ?? null,
          })),
        );
      }
```

(`match_deaths.layer` is stored as real `string | null` directly per Task 3 Step 5 — `death.layer` from the wire payload passes straight through, no sentinel conversion needed.)

- [ ] **Step 6: Typecheck**

Run: `bun run --filter './apps/api' typecheck`
Expected: PASS for `replay-upsert.service.ts` and `spatial-rollup.service.ts`.

- [ ] **Step 7: Manual verification against local Postgres**

With `bun run docker:dev:up` and `bun run dev:api` running, POST a synthetic `ReplayPayload` (matching `replayPayloadSchema`) to `/ingest` with a `spatial.presence[]` containing two entries for the same `battletag`/`heroId` but different `layer` values (one `null`, one `"bottom"`), and a matching `map_calibrations` setup (or skip calibration and just verify the write path directly via a script) — confirm via `bun run db:studio` that `match_spatial_grids` now has two rows for that `matchPlayerId` (one per layer) and `hero_map_player_spatial_rollup`/`hero_map_global_spatial_rollup` each have two rows too (one per layer) after ingest.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/replay-upsert.service.ts apps/api/src/services/spatial-rollup.service.ts
git commit -m "feat(api): write per-layer spatial grids, rollups, and death positions on ingest"
```

---

### Task 10: API — layer param on `/spatial/aggregate`

**Files:**
- Modify: `apps/api/src/services/spatial-aggregate.service.ts`
- Modify: `apps/api/src/routes/spatial-aggregate.ts`

**Interfaces:**
- Produces: `SpatialAggregateParams` gains `layer: string | null` (wire form). `getSpatialAggregate` converts it to DB form via `toDbLayer` before querying. `GET /spatial/aggregate` query gains an optional `layer` string param (empty/absent = default layer).

- [ ] **Step 1: Edit `spatial-aggregate.service.ts`**

```ts
import {
  type Hero,
  db,
  heroMapGlobalSpatialRollup,
  heroMapPlayerSpatialRollup,
  heroes,
} from "@hots-stats/db";
import { type Grid, gridToWireArrays, sumGrids } from "@hots-stats/shared-types";
import { and, eq, inArray } from "drizzle-orm";
import { toDbLayer } from "../lib/spatial-layer";

export type SpatialOutcomeFilter = "win" | "loss" | "all";
export type HeroRole = NonNullable<Hero["role"]>;

export interface SpatialAggregateParams {
  mapId: string;
  // null/omitted = the map's default/only level, same convention as
  // everywhere else -- see apps/api/src/lib/spatial-layer.ts.
  layer?: string | null;
  heroId?: string;
  role?: HeroRole;
  battletag?: string;
  global?: boolean;
  outcome: SpatialOutcomeFilter;
}
```

Add the layer filter to both branches of the rollup query in `getSpatialAggregate`:

```ts
export async function getSpatialAggregate(params: SpatialAggregateParams): Promise<SpatialAggregateResponse> {
  const heroIds = await resolveHeroIds(params);
  if (heroIds.length === 0) return EMPTY_RESPONSE;

  const outcomes = params.outcome === "all" ? (["win", "loss"] as const) : ([params.outcome] as const);
  const layer = toDbLayer(params.layer);

  const rows = params.global
    ? await db
        .select()
        .from(heroMapGlobalSpatialRollup)
        .where(
          and(
            eq(heroMapGlobalSpatialRollup.mapId, params.mapId),
            eq(heroMapGlobalSpatialRollup.layer, layer),
            inArray(heroMapGlobalSpatialRollup.heroId, heroIds),
            inArray(heroMapGlobalSpatialRollup.outcome, outcomes),
          ),
        )
    : params.battletag
      ? await db
          .select()
          .from(heroMapPlayerSpatialRollup)
          .where(
            and(
              eq(heroMapPlayerSpatialRollup.mapId, params.mapId),
              eq(heroMapPlayerSpatialRollup.layer, layer),
              inArray(heroMapPlayerSpatialRollup.heroId, heroIds),
              eq(heroMapPlayerSpatialRollup.battletag, params.battletag),
              inArray(heroMapPlayerSpatialRollup.outcome, outcomes),
            ),
          )
      : [];

  // ...rest unchanged
```

- [ ] **Step 2: Edit `spatial-aggregate.ts` route**

Add `layer` to the query schema and pass it through:

```ts
const aggregateQuerySchema = z
  .object({
    mapId: z.string().min(1),
    layer: z.string().optional(),
    heroId: z.string().optional(),
    role: heroRoleSchema.optional(),
    battletag: z.string().optional(),
    global: z
      .string()
      .optional()
      .transform((v) => v === "true"),
    outcome: z.enum(["win", "loss", "all"]).default("all"),
  })
  .refine((v) => Boolean(v.heroId) !== Boolean(v.role), {
    message: "Exactly one of heroId or role is required",
  })
  .refine((v) => Boolean(v.battletag) !== v.global, {
    message: "Exactly one of battletag or global=true is required",
  });
```

```ts
  .get("/aggregate", async (c) => {
    const parsed = aggregateQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const { mapId, layer, heroId, role, battletag, global, outcome } = parsed.data;
    const result = await getSpatialAggregate({ mapId, layer: layer ?? null, heroId, role, battletag, global, outcome });
    return c.json(result);
  });
```

- [ ] **Step 3: Typecheck**

Run: `bun run --filter './apps/api' typecheck`
Expected: PASS for these two files.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/spatial-aggregate.service.ts apps/api/src/routes/spatial-aggregate.ts
git commit -m "feat(api): add layer filter to spatial aggregate endpoint"
```

---

### Task 11: API — `GET /matches/:id` returns per-layer grids/trajectories/deaths

**Files:**
- Modify: `apps/api/src/routes/matches.ts` (the spatial block, lines ~585-737)

**Interfaces:**
- Produces: `spatial.heroes[]` entries change shape from `{matchPlayerId, battletag, heroId, team, presence, kills, deaths}` to `{matchPlayerId, battletag, heroId, team, layers: [{layer, presence, kills, deaths}]}` — one row per hero (grouped), each carrying an array of that hero's per-layer grids instead of one flat grid. `spatial.trajectories[]` entries gain `layer: string | null` (stays one entry per hero×layer, not grouped — a trajectory's timestamped path can't be merged across layers). `timeline.deaths[]` entries gain `layer` when `x`/`y` are present.

- [ ] **Step 1: Add the `layer` column to the three existing row queries**

In the `Promise.all([...])` block (lines 585-650), add `layer:` to the three `.select({...})` calls that need it:

```ts
      playerIds.length > 0
        ? db
            .select({
              matchPlayerId: matchDeaths.matchPlayerId,
              atSeconds: matchDeaths.atSeconds,
              x: matchDeaths.x,
              y: matchDeaths.y,
              layer: matchDeaths.layer,
              killers: matchDeaths.killers,
              killType: matchDeaths.killType,
            })
            .from(matchDeaths)
            .where(inArray(matchDeaths.matchPlayerId, playerIds))
        : Promise.resolve([]),
```

```ts
      playerIds.length > 0
        ? db
            .select({
              matchPlayerId: matchSpatialGrids.matchPlayerId,
              layer: matchSpatialGrids.layer,
              gridCols: matchSpatialGrids.gridCols,
              gridRows: matchSpatialGrids.gridRows,
              presenceGrid: matchSpatialGrids.presenceGrid,
              killsGrid: matchSpatialGrids.killsGrid,
              deathsGrid: matchSpatialGrids.deathsGrid,
            })
            .from(matchSpatialGrids)
            .where(inArray(matchSpatialGrids.matchPlayerId, playerIds))
        : Promise.resolve([]),
```

```ts
      playerIds.length > 0
        ? db
            .select({
              matchPlayerId: matchHeroTrajectories.matchPlayerId,
              layer: matchHeroTrajectories.layer,
              atSeconds: matchHeroTrajectories.atSeconds,
              x: matchHeroTrajectories.x,
              y: matchHeroTrajectories.y,
            })
            .from(matchHeroTrajectories)
            .where(inArray(matchHeroTrajectories.matchPlayerId, playerIds))
        : Promise.resolve([]),
```

- [ ] **Step 2: Add the `fromDbLayer` import**

```ts
import { fromDbLayer } from "../lib/spatial-layer";
```

- [ ] **Step 3: Include `layer` on each death**

In the `timeline.deaths` mapping (lines ~656-668), add `layer` alongside `x`/`y`:

```ts
            deaths: deathRows.flatMap((d) => {
              const player = playerById.get(d.matchPlayerId);
              if (!player) return [];
              return [
                {
                  battletag: player.battletag,
                  team: player.team,
                  atSeconds: d.atSeconds,
                  ...(d.x !== null && d.y !== null ? { x: d.x, y: d.y, layer: d.layer } : {}),
                  ...(d.killType ? { killers: d.killers ?? [], killType: d.killType } : {}),
                },
              ];
            }),
```

- [ ] **Step 4: Group `spatialGridRows` by `matchPlayerId` before building `spatial.heroes[]`**

Replace the `spatial` construction (lines 686-725):

```ts
    const gridRowsByPlayer = new Map<string, typeof spatialGridRows>();
    for (const row of spatialGridRows) {
      const list = gridRowsByPlayer.get(row.matchPlayerId) ?? [];
      list.push(row);
      gridRowsByPlayer.set(row.matchPlayerId, list);
    }

    const spatial =
      spatialGridRows.length > 0
        ? {
            grid: { cols: spatialGridRows[0]!.gridCols, rows: spatialGridRows[0]!.gridRows },
            heroes: [...gridRowsByPlayer.entries()].map(([matchPlayerId, rows]) => {
              const player = playerById.get(matchPlayerId);
              return {
                matchPlayerId,
                battletag: player?.battletag ?? null,
                heroId: player?.heroId ?? null,
                team: player?.team ?? null,
                layers: rows.map((row) => ({
                  layer: fromDbLayer(row.layer),
                  presence: gridToWireArrays(row.presenceGrid as Grid),
                  kills: gridToWireArrays(row.killsGrid as Grid),
                  deaths: gridToWireArrays(row.deathsGrid as Grid),
                })),
              };
            }),
            ...(trajectoryRows.length > 0
              ? {
                  trajectories: trajectoryRows.map((row) => {
                    const player = playerById.get(row.matchPlayerId);
                    return {
                      matchPlayerId: row.matchPlayerId,
                      battletag: player?.battletag ?? null,
                      heroId: player?.heroId ?? null,
                      team: player?.team ?? null,
                      layer: fromDbLayer(row.layer),
                      atSeconds: row.atSeconds,
                      x: row.x,
                      y: row.y,
                    };
                  }),
                }
              : {}),
          }
        : undefined;
```

(The response's outer shape, `spatialCalibrated`, and everything below is unchanged.)

- [ ] **Step 5: Typecheck**

Run: `bun run --filter './apps/api' typecheck`
Expected: FAILS at this point — nothing yet reads `spatial.heroes[]`'s new `layers` shape on the web side. That's expected; Task 12 fixes the consuming types.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/matches.ts
git commit -m "feat(api): group match spatial grids by layer in GET /matches/:id"
```

---

### Task 12: Web — types and `useSpatialHistorySlot.ts` layer param

**Files:**
- Modify: `apps/web/app/types/spatial.ts`
- Modify: `apps/web/app/composables/useSpatialHistorySlot.ts`
- Modify: `apps/web/app/types/coach.ts` (only if `MatchTimelineDeath` is defined there — confirm by opening the file; add `layer: string | null` to it the same way `x`/`y`/`killers`/`killType` are already optional there)
- Modify: `apps/web/app/utils/deathClustering.ts`

**Interfaces:**
- Produces: `MatchSpatialLayerGrids { layer: string | null; presence: WireGrid; kills: WireGrid; deaths: WireGrid }` (new). `MatchSpatialHero`/`MatchSlotHero` drop their flat `presence`/`kills`/`deaths` fields in favor of `layers: MatchSpatialLayerGrids[]`. `MatchHeroTrajectory` gains `layer: string | null` (stays flat — one entry per hero×layer). `SpatialAggregateResponse` unchanged shape (a "Historique" Slot always represents exactly one layer per request, selected via the new query param). `useSpatialHistorySlot(mapId, defaultHeroId, myBattletag, activeLayer: Ref<string | null>, enabled?)` gains a required `activeLayer` param threaded into its `/spatial/aggregate` query. `SpatialEventPoint` (deathClustering.ts) gains `layer: string | null`.

- [ ] **Step 1: Edit `types/spatial.ts`**

```ts
export interface WireGrid {
  cellIndex: number[];
  values: number[];
}

/** One hero's grids for one layer of a specific match. */
export interface MatchSpatialLayerGrids {
  layer: string | null;
  presence: WireGrid;
  kills: WireGrid;
  deaths: WireGrid;
}

/** One hero's per-layer grids for a specific match -- `GET /matches/:id`'s
 * `spatial.heroes[]`. A single-level map's heroes each have exactly one
 * entry in `layers`, with `layer: null`. */
export interface MatchSpatialHero {
  matchPlayerId: string;
  battletag: string | null;
  heroId: string | null;
  team: number | null;
  layers: MatchSpatialLayerGrids[];
}

/** One hero's downsampled, *timestamped* path for a match, for one layer --
 * `GET /matches/:id`'s `spatial.trajectories[]`. Unlike `MatchSpatialHero`'s
 * `layers[].presence` (a match-long aggregate with no timestamp left to
 * slice by), this keeps each sample's own `atSeconds`, which is what the
 * Pro Comparison View needs for time-sliced/event-anchored heatmaps and
 * literal rotation pathing (see `useHeatmapSync.ts`). Present only for a
 * match ingested with PARSER_VERSION >= 1.11 -- absent (not an empty array)
 * for an older, calibrated match that only ever got a presence grid. Kept
 * flat (one entry per hero *and* layer, not grouped like `MatchSpatialHero`)
 * since a timestamped path can't be merged across layers. */
export interface MatchHeroTrajectory {
  matchPlayerId: string;
  battletag: string | null;
  heroId: string | null;
  team: number | null;
  layer: string | null;
  atSeconds: number[];
  x: number[];
  y: number[];
}

/** `GET /matches/:id`'s `spatial` field -- absent entirely when no hero in the match has spatial data. */
export interface MatchSpatialData {
  grid: { cols: number; rows: number };
  heroes: MatchSpatialHero[];
  trajectories?: MatchHeroTrajectory[];
}

/** One hero's per-layer grids for a "Cette partie" Slot (`useMatchSpatialSlot.ts`), cross-referencing `MatchSpatialHero` with scoreboard display info (name, ally/enemy). */
export interface MatchSlotHero {
  matchPlayerId: string;
  battletag: string;
  heroId: string;
  heroName: string;
  team: number;
  isAlly: boolean;
  layers: MatchSpatialLayerGrids[];
}

export type SpatialOutcomeFilter = "win" | "loss" | "all";

/** `GET /spatial/aggregate` response -- one combined grid, for one layer, for a "Historique" Slot (see tasks/epic-10-analyse-spatiale.md). */
export interface SpatialAggregateResponse {
  matchCount: number;
  grid: { cols: number; rows: number } | null;
  presence: WireGrid;
  kills: WireGrid;
  deaths: WireGrid;
}
```

- [ ] **Step 2: Add `layer` to `MatchTimelineDeath`**

Open `apps/web/app/types/coach.ts`, find `MatchTimelineDeath`, and add `layer: string | null` alongside its existing optional `x`/`y`/`killers`/`killType` fields (match whatever optionality convention that file already uses for those — likely `layer?: string | null` if it mirrors the zod schema's `.optional()`).

- [ ] **Step 3: Edit `useSpatialHistorySlot.ts`**

Add an `activeLayer` param and include it in the fetch query:

```ts
export function useSpatialHistorySlot(
  mapId: string,
  defaultHeroId: string | undefined,
  myBattletag: Ref<string | null>,
  activeLayer: Ref<string | null>,
  enabled: Ref<boolean> = ref(true),
) {
  // ...unchanged state refs...

  async function load() {
    if (!enabled.value) return;
    const heroParam = heroSelector.value === "hero" ? selectedHeroId.value : undefined;
    const roleParam = heroSelector.value === "role" ? selectedRole.value : undefined;
    if (!heroParam && !roleParam) return;
    if (!isGlobal.value && !battletag.value) return;

    loading.value = true;
    loadError.value = null;
    try {
      data.value = await $fetch<SpatialAggregateResponse>("/spatial/aggregate", {
        baseURL: config.public.apiBase,
        credentials: "include",
        query: {
          mapId,
          ...(activeLayer.value ? { layer: activeLayer.value } : {}),
          ...(heroParam ? { heroId: heroParam } : { role: roleParam }),
          ...(isGlobal.value ? { global: "true" } : { battletag: battletag.value }),
          outcome: outcome.value,
        },
      });
    } catch (err) {
      loadError.value = (err as { data?: { error?: unknown } })?.data?.error ? "Requête invalide" : "Impossible de charger l'agrégat";
      data.value = null;
    } finally {
      loading.value = false;
    }
  }

  watch([playerMode, otherBattletag, heroSelector, selectedHeroId, selectedRole, outcome, enabled, activeLayer], load, { immediate: true });

  // ...unchanged rest...
}
```

- [ ] **Step 4: Edit `deathClustering.ts`**

Add `layer` to `SpatialEventPoint` and populate it in `buildSpatialEventPoints`:

```ts
export interface SpatialEventPoint {
  kind: "kill" | "death";
  battletag: string;
  atSeconds: number;
  x: number;
  y: number;
  layer: string | null;
}
```

```ts
export function buildSpatialEventPoints(deaths: MatchTimelineDeath[]): SpatialEventPoint[] {
  const points: SpatialEventPoint[] = [];
  for (const death of deaths) {
    if (death.x === undefined || death.y === undefined) continue;
    const layer = death.layer ?? null;
    points.push({ kind: "death", battletag: death.battletag, atSeconds: death.atSeconds, x: death.x, y: death.y, layer });
    for (const killer of death.killers ?? []) {
      points.push({ kind: "kill", battletag: killer, atSeconds: death.atSeconds, x: death.x, y: death.y, layer });
    }
  }
  return points;
}
```

- [ ] **Step 5: Update `deathClustering.test.ts` if it constructs `SpatialEventPoint`/`MatchTimelineDeath` fixtures directly**

Open the test file; if any fixture object literal matches `SpatialEventPoint` or `MatchTimelineDeath`'s shape, add `layer: null` to it so the file still typechecks.

- [ ] **Step 6: Typecheck**

Run: `bun run --filter './apps/web' typecheck`
Expected: FAILS — `useMatchSpatialSlot.ts` and `SpatialSlotGroup.vue` still read the old flat `presence`/`kills`/`deaths` fields and don't pass `activeLayer` to `useSpatialHistorySlot`. That's expected; Task 13 fixes both.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/types/spatial.ts apps/web/app/types/coach.ts apps/web/app/composables/useSpatialHistorySlot.ts apps/web/app/utils/deathClustering.ts apps/web/app/utils/deathClustering.test.ts
git commit -m "feat(web): thread layer through spatial types, history-slot fetch, and death clustering"
```

---

### Task 13: Web — layer tabs on `SpatialSlotGroup.vue` / `SpatialHeatmapView.vue`

**Files:**
- Modify: `apps/web/app/composables/useMatchSpatialSlot.ts`
- Modify: `apps/web/app/components/spatial/SpatialHeatmapView.vue`
- Modify: `apps/web/app/components/spatial/SpatialSlotGroup.vue`
- Modify: `apps/web/app/composables/useHeatmapSync.ts` (minimal defensive fix only — see Step 6)

**Interfaces:**
- Consumes: `MatchSlotHero.layers[]`, `useSpatialHistorySlot`'s new `activeLayer` param (Task 12).
- Produces: `useMatchSpatialSlot(heroes, deaths, activeLayer: Ref<string | null>, colorOverride?)` gains a required `activeLayer` param. `SpatialHeatmapView.vue` gains an optional `layer?: string | null` prop controlling which background image it loads. `SpatialSlotGroup.vue` renders a layer-tab switcher (only when the match's heroes span more than one layer) and threads the active layer into every child.

- [ ] **Step 1: Edit `useMatchSpatialSlot.ts`**

Add the `activeLayer` param, fix `heroColorIndex` to be layer-agnostic (identity-based), and filter grid lookups by the active layer:

```ts
export function useMatchSpatialSlot(
  heroes: MatchSlotHero[],
  deaths: MatchTimelineDeath[],
  activeLayer: Ref<string | null>,
  colorOverride?: Ref<[number, number, number] | undefined>,
) {
  const selected = ref(new Set(heroes.map((h) => h.matchPlayerId)));

  function toggle(matchPlayerId: string) {
    const next = new Set(selected.value);
    if (next.has(matchPlayerId)) next.delete(matchPlayerId);
    else next.add(matchPlayerId);
    selected.value = next;
  }

  function selectAllies() {
    selected.value = new Set(heroes.filter((h) => h.isAlly).map((h) => h.matchPlayerId));
  }
  function selectEnemies() {
    selected.value = new Set(heroes.filter((h) => !h.isAlly).map((h) => h.matchPlayerId));
  }
  function selectAll() {
    selected.value = new Set(heroes.map((h) => h.matchPlayerId));
  }

  const activeHeroes = computed(() => heroes.filter((h) => selected.value.has(h.matchPlayerId)));
  const heroColorIndex = new Map(heroes.map((h, i) => [h.matchPlayerId, i]));

  const viewMode = ref<MatchSlotViewMode>("hero");

  function gridsFor(hero: MatchSlotHero) {
    return hero.layers.find((l) => l.layer === activeLayer.value);
  }

  const presenceLayers = computed<SpatialPresenceLayer[]>(() => {
    const override = colorOverride?.value;
    if (override) {
      return [
        {
          grid: sumGrids(activeHeroes.value.map((h) => gridFromWireArrays(gridsFor(h)?.presence.cellIndex ?? [], gridsFor(h)?.presence.values ?? []))),
          colorRgb: override,
        },
      ];
    }
    if (viewMode.value === "team") {
      const layers: SpatialPresenceLayer[] = [];
      const allies = activeHeroes.value.filter((h) => h.isAlly);
      const enemies = activeHeroes.value.filter((h) => !h.isAlly);
      if (allies.length > 0)
        layers.push({
          grid: sumGrids(allies.map((h) => gridFromWireArrays(gridsFor(h)?.presence.cellIndex ?? [], gridsFor(h)?.presence.values ?? []))),
          colorRgb: ALLY_TEAM_RGB,
          label: "Mon équipe",
        });
      if (enemies.length > 0)
        layers.push({
          grid: sumGrids(enemies.map((h) => gridFromWireArrays(gridsFor(h)?.presence.cellIndex ?? [], gridsFor(h)?.presence.values ?? []))),
          colorRgb: ENEMY_TEAM_RGB,
          label: "Adversaires",
        });
      return layers;
    }
    return activeHeroes.value
      .filter((hero) => gridsFor(hero) !== undefined)
      .map((hero) => ({
        grid: gridFromWireArrays(gridsFor(hero)!.presence.cellIndex, gridsFor(hero)!.presence.values),
        colorRgb: colorForHeroIndex(heroColorIndex.get(hero.matchPlayerId) ?? 0),
        label: hero.heroName,
      }));
  });

  const activeBattletags = computed(() => new Set(activeHeroes.value.map((h) => h.battletag)));
  const markerClusters = computed(() =>
    clusterSpatialEvents(buildSpatialEventPoints(deaths).filter((p) => activeBattletags.value.has(p.battletag) && p.layer === activeLayer.value)),
  );

  return { selected, toggle, selectAllies, selectEnemies, selectAll, activeHeroes, viewMode, presenceLayers, markerClusters };
}
```

(A hero simply has no visible presence layer on a tab for a layer they never visited — `gridsFor` returns `undefined` and they're filtered out of the "hero" view mode's list, or contribute an empty grid harmlessly in "team"/override mode via the `?? []` fallbacks.)

- [ ] **Step 2: Edit `SpatialHeatmapView.vue`**

Add the `layer` prop and compute the image slug:

```ts
const props = withDefaults(
  defineProps<{
    mapId: string;
    layer?: string | null;
    gridCols: number;
    gridRows: number;
    layers: SpatialPresenceLayer[];
    killsGrid?: Grid;
    deathsGrid?: Grid;
    markerClusters?: SpatialEventCluster[];
    showPresence?: boolean;
    showKills?: boolean;
    showDeaths?: boolean;
    presenceOpacity?: number;
  }>(),
  {
    layer: null,
    killsGrid: undefined,
    deathsGrid: undefined,
    markerClusters: undefined,
    showPresence: true,
    showKills: true,
    showDeaths: true,
    presenceOpacity: 0.75,
  },
);

const imageSlug = computed(() => (props.layer ? `${props.mapId}-${props.layer}` : props.mapId));
```

Update the template's `<img>` `:src` (find the existing `` `/images/maps/original/${mapId}.jpg` `` and change `mapId` to `imageSlug`):

```html
<img ref="imgEl" :src="`/images/maps/original/${imageSlug}.jpg`" :alt="mapId" @load="onImageLoad" />
```

(Keep whatever other attributes that `<img>` tag already has — only the `:src` binding changes.)

- [ ] **Step 3: Edit `SpatialSlotGroup.vue` — derive `availableLayers`/`activeLayer`**

Add near the top of the `<script setup>`, right after `allowMatchScope`/`myBattletagRef`:

```ts
// Every distinct layer this match's heroes have data on -- empty when no
// match is in context (e.g. /maps/:mapId), single-entry [null] for a
// single-level map. Only meaningful when `allowMatchScope` is true; the
// "Historique"-only case (no active match) always uses the default layer
// for now (deriving available layers for a map with no match in context
// would need a dedicated endpoint, out of scope here).
const availableLayers = computed<(string | null)[]>(() => {
  if (!allowMatchScope.value) return [null];
  const seen = new Set<string | null>();
  for (const hero of props.matchHeroes) for (const l of hero.layers) seen.add(l.layer);
  const layers = [...seen];
  return layers.length > 0 ? layers.sort((a, b) => (a ?? "").localeCompare(b ?? "")) : [null];
});
const activeLayer = ref<string | null>(availableLayers.value[0] ?? null);
function layerTabLabel(layer: string | null): string {
  return layer ?? "Surface";
}
```

- [ ] **Step 4: Thread `activeLayer` into both Slot composables**

Update the composable creation lines:

```ts
const matchSlotA = allowMatchScope.value ? useMatchSpatialSlot(props.matchHeroes, props.matchDeaths, activeLayer, colorA) : null;
const historySlotA = !allowMatchScope.value
  ? useSpatialHistorySlot(props.mapId, props.heroOptions[0]?.id, myBattletagRef, activeLayer)
  : null;

const matchSlotB = allowMatchScope.value ? useMatchSpatialSlot(props.matchHeroes, props.matchDeaths, activeLayer, colorB) : null;
const historySlotBEnabled = computed(() => comparisonEnabled.value && slotBScope.value === "history");
const historySlotB = useSpatialHistorySlot(props.mapId, props.heroOptions[0]?.id, myBattletagRef, activeLayer, historySlotBEnabled);
```

- [ ] **Step 5: Pass `activeLayer` to every `<SpatialHeatmapView>` and render the tab switcher**

Add `:layer="activeLayer"` to each of the 4 `<SpatialHeatmapView>` call sites (single-Slot view, overlay compare view, side-by-side A, side-by-side B). For the single-Slot one:

```html
<SpatialHeatmapView
  v-if="matchSlotA || (historySlotA && historySlotA.data.value && historySlotA.data.value.matchCount > 0)"
  ref="heatmapRef"
  class="mt-3"
  :map-id="mapId"
  :layer="activeLayer"
  :grid-cols="effectiveGridCols"
  :grid-rows="effectiveGridRows"
  :layers="slotALayers"
  :marker-clusters="slotAMarkers"
  :kills-grid="matchSlotA ? undefined : historySlotA?.killsGrid.value"
  :deaths-grid="matchSlotA ? undefined : historySlotA?.deathsGrid.value"
  :show-kills="showKills"
  :show-deaths="showDeaths"
  :presence-opacity="presenceOpacity"
/>
```

Apply the same `:layer="activeLayer"` addition to the other 3 `<SpatialHeatmapView>` blocks (overlay-compare, side-by-side A, side-by-side B) — one new attribute each, nothing else in those blocks changes.

Add the tab switcher just above the top-level `<div class="space-y-4">`'s first child (right before the `<div v-if="!comparisonEnabled">` line), so it's visible regardless of comparison mode:

```html
<div v-if="availableLayers.length > 1" class="flex items-center gap-1.5 text-xs">
  <span class="text-muted">Niveau :</span>
  <UButton
    v-for="l in availableLayers"
    :key="l ?? '__default__'"
    size="xs"
    :variant="activeLayer === l ? 'solid' : 'soft'"
    color="neutral"
    @click="activeLayer = l"
  >
    {{ layerTabLabel(l) }}
  </UButton>
</div>
```

- [ ] **Step 6: Minimal defensive fix in `useHeatmapSync.ts`**

Open `apps/web/app/composables/useHeatmapSync.ts`. Find `selectTrajectory` (picks a trajectory by `battletag`). Since `MatchHeroTrajectory[]` can now contain more than one entry per battletag (one per layer), and this composable has no layer-switching UI yet (out of scope for this pass — Pro Comparison View's own layer picker is a follow-up), make it deterministically pick the *default* layer's trajectory rather than whichever happens to come first in the array:

Find the line(s) doing something like `trajectories.find((t) => t.battletag === battletag)` and change to:

```ts
trajectories.find((t) => t.battletag === battletag && t.layer === null) ??
  trajectories.find((t) => t.battletag === battletag)
```

(Falls back to whatever's there if the hero somehow has no default-layer entry, rather than showing nothing.) If the actual code shape differs from this guess, apply the same principle: prefer `layer === null`, fall back to the first match. Leave a one-line comment noting full per-layer trajectory selection for the Pro Comparison View is out of scope for this change.

- [ ] **Step 7: Typecheck**

Run: `bun run --filter './apps/web' typecheck`
Expected: PASS.

- [ ] **Step 8: Manual verification**

Run `bun run dev` (both api and web). With Haunted Mines' two layers calibrated (Task 6) and at least one real or synthetic Haunted Mines match ingested with multi-layer `spatial` data (Task 7-9's write path), open that match's page:
- Confirm a "Niveau : Surface / bottom" tab switcher appears above the heatmap.
- Confirm switching tabs swaps the background image between `haunted-mines.jpg` and `haunted-mines-bottom.jpg`.
- Confirm each tab's presence heatmap only shows that layer's data (a hero who never went underground shows no presence on the "bottom" tab).
- Confirm a single-layer map (e.g. Cursed Hollow) shows **no** tab switcher and behaves exactly as before.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/composables/useMatchSpatialSlot.ts apps/web/app/components/spatial/SpatialHeatmapView.vue apps/web/app/components/spatial/SpatialSlotGroup.vue apps/web/app/composables/useHeatmapSync.ts
git commit -m "feat(web): layer tab switcher for multi-layer map heatmaps"
```

---

### Task 14: Operational — calibrate Haunted Mines' two layers for real

**Not a code task.** Everything up to here makes multi-layer support *possible*; Haunted Mines' actual heatmap stays broken until an admin calibrates both of its layers against real replay data, since `map_calibrations` starts empty for it (no seed data is introduced by this plan — deliberately, since nobody yet knows the two layers' real world-bounds numbers).

- [ ] Wait for (or trigger, if any team member has local Haunted Mines `.StormReplay` files) at least one daemon on `PARSER_VERSION >= "1.13"` to upload a Haunted Mines match, so `raw_map_samples` has a real (not synthetic) point cloud for it.
- [ ] Open `/admin/spatial/calibrate`, select Haunted Mines, and **visually inspect the raw point cloud** before doing anything else: per this plan's Global Constraints, the "two layers have disjoint X/Y bounds" assumption is unconfirmed. If the cloud shows two visually separate clusters, mechanism 1 (this plan's design) holds — proceed. If it shows one blob with no visible split, the two levels overlap in X/Y (mechanism 2 from the epic doc) and this plan's approach does not work as built; stop and raise that finding for a follow-up design (a real per-sample region signal would be needed, which `SUnitPositionsEvent` may not carry).
- [ ] If disjoint: calibrate the default (surface) layer's rectangle around one cluster, save; use "Ajouter un niveau" to calibrate `bottom` around the other cluster, save.
- [ ] Re-open a previously-ingested Haunted Mines match's page (or wait for one to resync now that its map has calibration data — see `sync_spatial_calibrations`'s retroactive-invalidation behavior) and confirm the layer tab switcher and both heatmaps look correct per Task 13 Step 8's checklist.
