# Objective Events (G1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( `- [ ]` ) syntax for tracking.

**Goal:** Make mercenary-camp captures and map-objective captures first-class, timestamped match data from the replay to the UI.

**Architecture:** The daemon extracts an allowlist of tracker `SStatGameEvent` names into an optional `timeline.objectives[]` block; the API stores them in a new additive `match_objective_events` table and returns them on `GET /matches/:id`; the Chronologie tab renders markers plus a French text summary.

**Tech Stack:** Python 3 + pytest (daemon), TypeScript + Drizzle + Hono + Zod with `bun test` (API, shared-types, packages/db), Nuxt 3 + Vue + vitest (web).

**Spec:** `docs/superpowers/specs/2026-09-20-g1-objective-events-design.md`

## Global Constraints

- French UI strings; English identifiers and comments.
- No new npm/python dependency.
- Migrations are additive only (CREATE TABLE/INDEX/FK; never DROP/RENAME).
- No invented data: a declared team that cannot be resolved to 0/1 drops the event.
- This chantier adds no personal endpoint, so multi-account scope rules are untouched.
- `PARSER_VERSION` goes 1.14 -> 1.15; `MIN_PARSER_VERSION` stays `1.10`.
- Leave the pre-existing uncommitted files ( `apps/web/app/pages/objectifs.vue`, `apps/web/app/utils/driverDisplay.ts`, `apps/web/app/utils/driverDisplay.test.ts` ) and the untracked `apps/web/scripts/timeline-preview*` / `docs/preview/` untouched. Never `git add -A`.
- Verification commands, run from the repo root: `bun run typecheck`, `bun test packages/shared-types`, `bun test apps/api`, `bun run --filter './apps/web' test`, `cd daemon-python && pytest -q`.

---

### Task 1: Shared contract -- objective event schema

**Files:**
- Modify: `packages/shared-types/src/replay-payload.ts`
- Create: `packages/shared-types/src/replay-payload.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `objectiveEventKindSchema`, `ObjectiveEventKind`, `matchObjectiveEventSchema`, `MatchObjectiveEvent = { kind: ObjectiveEventKind; team: 0 | 1 | null; atSeconds: number; detail?: string | null }`; `matchTimelineSchema` gains optional `objectives: MatchObjectiveEvent[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared-types/src/replay-payload.test.ts`:

~~~ts
import { describe, expect, test } from "bun:test";
import { matchObjectiveEventSchema, matchTimelineSchema } from "./replay-payload";

describe("matchObjectiveEventSchema", () => {
  test("accepts a camp capture with a team and a detail", () => {
    const parsed = matchObjectiveEventSchema.parse({
      kind: "mercenaryCamp",
      team: 1,
      atSeconds: 159,
      detail: "Siege Camp",
    });
    expect(parsed).toEqual({ kind: "mercenaryCamp", team: 1, atSeconds: 159, detail: "Siege Camp" });
  });

  test("accepts a team-less kind", () => {
    const parsed = matchObjectiveEventSchema.parse({ kind: "templeActivated", team: null, atSeconds: 12 });
    expect(parsed.team).toBeNull();
  });

  test("rejects an unknown kind", () => {
    expect(matchObjectiveEventSchema.safeParse({ kind: "victory", team: 0, atSeconds: 1 }).success).toBe(false);
  });

  test("rejects an out-of-range team and a negative timestamp", () => {
    expect(matchObjectiveEventSchema.safeParse({ kind: "tribute", team: 2, atSeconds: 1 }).success).toBe(false);
    expect(matchObjectiveEventSchema.safeParse({ kind: "tribute", team: 0, atSeconds: -1 }).success).toBe(false);
  });
});

describe("matchTimelineSchema objectives", () => {
  test("still validates without objectives (backward compatible)", () => {
    expect(matchTimelineSchema.safeParse({ deaths: [], levelSnapshots: [] }).success).toBe(true);
  });

  test("accepts objectives", () => {
    const parsed = matchTimelineSchema.safeParse({
      deaths: [],
      levelSnapshots: [],
      objectives: [{ kind: "curse", team: 0, atSeconds: 5 }],
    });
    expect(parsed.success).toBe(true);
  });
});
~~~

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test packages/shared-types`
Expected: FAIL -- `matchObjectiveEventSchema` is not exported.

- [ ] **Step 3: Add the schema**

In `packages/shared-types/src/replay-payload.ts`, immediately before `matchTimelineSchema`, insert:

~~~ts
/** One objective/camp capture the daemon extracted from a tracker
 * SStatGameEvent (see daemon-python/src/parser.py's
 * _extract_objective_events, PARSER_VERSION 1.15). team is null when the
 * event carries no unambiguous side (see the G1 design spec's table); detail
 * is a free-text camp/punisher type. */
export const objectiveEventKindSchema = z.enum([
  "mercenaryCamp",
  "dragonKnight",
  "tribute",
  "curse",
  "templeCaptured",
  "templeActivated",
  "altarCaptured",
  "townCaptured",
  "ghostShipCaptured",
  "nukeCollected",
  "nukeFired",
  "nukeDropped",
  "golemsSpawned",
  "capturePoint",
  "shrineCaptured",
  "punisherKilled",
  "soulEatersSpawned",
  "immortalDefeated",
  "sixTownStart",
]);
export type ObjectiveEventKind = z.infer<typeof objectiveEventKindSchema>;

export const matchObjectiveEventSchema = z.object({
  kind: objectiveEventKindSchema,
  team: z.union([z.literal(0), z.literal(1)]).nullable(),
  atSeconds: z.number().int().nonnegative(),
  detail: z.string().nullable().optional(),
});
export type MatchObjectiveEvent = z.infer<typeof matchObjectiveEventSchema>;
~~~

Then change `matchTimelineSchema` so it reads:

~~~ts
export const matchTimelineSchema = z.object({
  deaths: z.array(matchTimelineDeathSchema),
  levelSnapshots: z.array(matchTimelineLevelSnapshotSchema),
  structureEvents: z.array(matchStructureEventSchema).optional(),
  // Optional so a daemon older than PARSER_VERSION 1.15 (which doesn't send
  // this yet) still validates -- see replay-upsert.service.ts, which simply
  // skips writing objective rows when it's absent.
  objectives: z.array(matchObjectiveEventSchema).optional(),
});
~~~

- [ ] **Step 4: Run the test**

Run: `bun test packages/shared-types`
Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/shared-types/src/replay-payload.ts packages/shared-types/src/replay-payload.test.ts
git commit -m "feat(shared-types): add the objective-event replay contract"
~~~

---

### Task 2: Daemon allowlist and extractor

**Files:**
- Modify: `daemon-python/src/constants.py`
- Modify: `daemon-python/src/parser.py`
- Modify: `daemon-python/tests/test_parser.py`

**Interfaces:**
- Consumes: `constants.OBJECTIVE_EVENT_SPECS`.
- Produces: `_extract_objective_events(tracker_events: list[dict], gates_open_loop: int) -> list[dict]` returning `{"kind": str, "team": 0 | 1 | None, "atSeconds": int, "detail": str | None}` entries.

- [ ] **Step 1: Write the failing test**

In `daemon-python/tests/test_parser.py`, add `_extract_objective_events` to the `from src.parser import (...)` block (keep it alphabetical, right after `_extract_level_snapshots`).

Add this helper next to `_level_up_event`:

~~~python
def _stat_game_event(
    name: str,
    *,
    int_data: list[tuple[str, int]] | None = None,
    string_data: list[tuple[str, str]] | None = None,
    fixed_data: list[tuple[str, int]] | None = None,
    gameloop: int,
) -> dict:
    event: dict = {
        "_event": "NNet.Replay.Tracker.SStatGameEvent",
        "m_eventName": name.encode(),
        "_gameloop": gameloop,
    }
    if int_data:
        event["m_intData"] = [{"m_key": k.encode(), "m_value": v} for k, v in int_data]
    if string_data:
        event["m_stringData"] = [{"m_key": k.encode(), "m_value": v.encode()} for k, v in string_data]
    if fixed_data:
        event["m_fixedData"] = [{"m_key": k.encode(), "m_value": v} for k, v in fixed_data]
    return event
~~~

Add the tests next to the structure-event tests:

~~~python
def test_extract_objective_events_reads_a_camp_with_a_fixed_team():
    events = [
        _stat_game_event(
            "JungleCampCapture",
            int_data=[("CampID", 3)],
            string_data=[("CampType", "Siege Camp")],
            fixed_data=[("TeamID", 8192)],
            gameloop=610 + 16 * 159,
        )
    ]

    assert _extract_objective_events(events, gates_open_loop=610) == [
        {"kind": "mercenaryCamp", "team": 1, "atSeconds": 159, "detail": "Siege Camp"}
    ]


def test_extract_objective_events_reads_a_plain_int_team():
    events = [
        _stat_game_event(
            "Immortal Defeated",
            int_data=[("Winning Team", 1)],
            fixed_data=[("GameTime", 1026560)],
            gameloop=610 + 16 * 642,
        )
    ]

    assert _extract_objective_events(events, gates_open_loop=610) == [
        {"kind": "immortalDefeated", "team": 0, "atSeconds": 642, "detail": None}
    ]


def test_extract_objective_events_keeps_a_teamless_kind_with_null_team():
    events = [_stat_game_event("SkyTempleActivated", int_data=[("TempleID", 1)], gameloop=610 + 16 * 300)]

    assert _extract_objective_events(events, gates_open_loop=610) == [
        {"kind": "templeActivated", "team": None, "atSeconds": 300, "detail": None}
    ]


def test_extract_objective_events_ignores_a_name_outside_the_allowlist():
    events = [_stat_game_event("SomeUnmappedEvent", int_data=[("TeamID", 1)], gameloop=700)]

    assert _extract_objective_events(events, gates_open_loop=610) == []


def test_extract_objective_events_drops_an_out_of_range_team():
    # 12288 // 4096 = 3 -> side 2, outside {0, 1}: skip rather than guess.
    events = [_stat_game_event("TributeCollected", fixed_data=[("TeamID", 12288)], gameloop=700)]

    assert _extract_objective_events(events, gates_open_loop=610) == []


def test_extract_objective_events_drops_a_missing_team_key():
    events = [_stat_game_event("TributeCollected", fixed_data=[("SomethingElse", 4096)], gameloop=700)]

    assert _extract_objective_events(events, gates_open_loop=610) == []


def test_extract_objective_events_clamps_before_gates_open_to_zero():
    events = [_stat_game_event("TributeCollected", fixed_data=[("TeamID", 4096)], gameloop=100)]

    assert _extract_objective_events(events, gates_open_loop=610) == [
        {"kind": "tribute", "team": 0, "atSeconds": 0, "detail": None}
    ]


def test_objective_event_specs_cover_every_declared_kind():
    # Pins the allowlist table: every entry must decode to its own kind, with
    # its declared team source resolving to side 0.
    for offset, (name, spec) in enumerate(constants.OBJECTIVE_EVENT_SPECS.items()):
        int_data: list[tuple[str, int]] = [("CampID", 1)]
        fixed_data: list[tuple[str, int]] = []
        source = spec.get("team")
        if source is not None:
            encoding, key = source
            bucket = fixed_data if encoding == "fixed" else int_data
            bucket.append((key, 4096 if encoding == "fixed" else 1))
        event = _stat_game_event(name, int_data=int_data, fixed_data=fixed_data or None, gameloop=1000 + offset)

        result = _extract_objective_events([event], gates_open_loop=1000)

        assert len(result) == 1
        assert result[0]["kind"] == spec["kind"]
        assert result[0]["team"] == (None if source is None else 0)
~~~

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd daemon-python && pytest tests/test_parser.py -q -k objective`
Expected: FAIL -- `_extract_objective_events` is not defined.

- [ ] **Step 3: Add the allowlist**

In `daemon-python/src/constants.py`, after `REQUIRED_SCORE_FIELDS`:

~~~python
# replay.tracker.events' SStatGameEvent.m_eventName values we turn into an
# objective event (see _extract_objective_events in parser.py and
# PARSER_VERSION 1.15). Each entry declares its API kind, where its team
# lives -- ("fixed", key) for a Q12 fixed-point m_fixedData value (divide by
# 4096), ("int", key) for a plain 1-based m_intData value, None when the event
# carries no side -- and an optional m_stringData detail key.
#
# Deliberately an allowlist: an m_eventName that isn't here is ignored, never
# guessed. The names and shapes were confirmed by decoding 120 real replays
# across 19 battlegrounds (see the G1 design spec); a new battleground adds a
# row here plus a web label, nothing else.
OBJECTIVE_EVENT_SPECS: dict[str, dict[str, object]] = {
    "JungleCampCapture": {"kind": "mercenaryCamp", "team": ("fixed", "TeamID"), "detail": "CampType"},
    "DragonKnightActivated": {"kind": "dragonKnight", "team": ("fixed", "TeamID")},
    "TributeCollected": {"kind": "tribute", "team": ("fixed", "TeamID")},
    "RavenCurseActivated": {"kind": "curse", "team": ("fixed", "TeamID")},
    "GhostShipCaptured": {"kind": "ghostShipCaptured", "team": ("fixed", "TeamID")},
    "HauntedMinesGolemsSpawned": {"kind": "golemsSpawned", "team": ("fixed", "TeamID")},
    "SoulEatersSpawned": {"kind": "soulEatersSpawned", "team": ("fixed", "TeamID")},
    "SkyTempleCaptured": {"kind": "templeCaptured", "team": ("int", "TeamID")},
    "Altar Captured": {"kind": "altarCaptured", "team": ("int", "Firing Team")},
    "WarheadJunctionNukeCollected": {"kind": "nukeCollected", "team": ("int", "OwningTeam")},
    "WarheadJunctionNukeFired": {"kind": "nukeFired", "team": ("int", "OwningTeam")},
    "WarheadJunctionNukeDropped": {"kind": "nukeDropped", "team": ("int", "OwningTeam")},
    "VolskayaCapturePointComplete": {"kind": "capturePoint", "team": ("int", "WinningTeam")},
    "Infernal Shrine Captured": {"kind": "shrineCaptured", "team": ("int", "Winning Team")},
    "Punisher Killed": {
        "kind": "punisherKilled",
        "team": ("int", "Owning Team of Punisher"),
        "detail": "Punisher Type",
    },
    "Immortal Defeated": {"kind": "immortalDefeated", "team": ("int", "Winning Team")},
    "Six Town Event Start": {"kind": "sixTownStart", "team": ("int", "Owning Team")},
    "SkyTempleActivated": {"kind": "templeActivated", "team": None},
    "Town Captured": {"kind": "townCaptured", "team": None},
}
~~~

- [ ] **Step 4: Add the extractor**

In `daemon-python/src/parser.py`, right after `_extract_level_snapshots`:

~~~python
_STAT_GAME_EVENT = "NNet.Replay.Tracker.SStatGameEvent"


def _objective_data_value(event: dict[str, Any], field: str, key: str) -> Any | None:
    """One m_intData/m_fixedData/m_stringData entry's value by key, or None
    when the event doesn't carry it."""
    for entry in event.get(field) or []:
        if _s(entry.get("m_key")) == key:
            return entry.get("m_value")
    return None


def _objective_team(spec: dict[str, Any], event: dict[str, Any]) -> tuple[bool, int | None]:
    """(keep, team) for one objective event's declared team source.

    A spec with no team source is always kept with team=None. A spec with one
    is dropped (keep=False) when the key is missing or the decoded value isn't
    a real side -- skip rather than guess, the same posture _extract_deaths
    takes for non-hero deaths.
    """
    source = spec.get("team")
    if source is None:
        return True, None
    encoding, key = source
    raw = _objective_data_value(event, "m_fixedData" if encoding == "fixed" else "m_intData", key)
    if raw is None:
        return False, None
    side = (raw // 4096 if encoding == "fixed" else raw) - 1
    if side not in (0, 1):
        return False, None
    return True, side


def _extract_objective_events(tracker_events: list[dict], gates_open_loop: int) -> list[dict[str, Any]]:
    """Allowlisted SStatGameEvents -- mercenary camps and map objectives -- as
    {kind, team, atSeconds, detail} (see constants.OBJECTIVE_EVENT_SPECS and
    PARSER_VERSION 1.15).

    atSeconds uses the same gates-open reference as _extract_deaths. An
    m_eventName outside the allowlist, or a declared team that can't be
    resolved to 0/1, produces nothing.
    """
    events: list[dict[str, Any]] = []
    for event in tracker_events:
        if event.get("_event") != _STAT_GAME_EVENT:
            continue
        spec = constants.OBJECTIVE_EVENT_SPECS.get(_s(event.get("m_eventName")))
        if spec is None:
            continue
        keep, team = _objective_team(spec, event)
        if not keep:
            continue
        detail_key = spec.get("detail")
        detail = _objective_data_value(event, "m_stringData", detail_key) if detail_key else None
        events.append(
            {
                "kind": spec["kind"],
                "team": team,
                "atSeconds": max(0, round((event["_gameloop"] - gates_open_loop) / _GAMELOOPS_PER_SECOND)),
                "detail": _s(detail) if isinstance(detail, bytes) else detail,
            }
        )
    return events
~~~

- [ ] **Step 5: Run the tests**

Run: `cd daemon-python && pytest tests/test_parser.py -q -k objective`
Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add daemon-python/src/constants.py daemon-python/src/parser.py daemon-python/tests/test_parser.py
git commit -m "feat(daemon): extract objective and camp events from tracker events"
~~~

---

### Task 3: Daemon payload wiring and PARSER_VERSION 1.15

**Files:**
- Modify: `daemon-python/src/parser.py` (`build_payload`)
- Modify: `daemon-python/src/constants.py` (`PARSER_VERSION` + changelog)
- Modify: `daemon-python/tests/test_parser.py`

**Interfaces:**
- Consumes: `_extract_objective_events` (Task 2).
- Produces: `build_payload`'s `timeline` gains `objectives` only when non-empty.

- [ ] **Step 1: Write the failing test**

~~~python
def test_build_payload_includes_objective_events():
    events = [
        *_base_tracker_events(),
        _stat_game_event(
            "JungleCampCapture",
            int_data=[("CampID", 3)],
            string_data=[("CampType", "Siege Camp")],
            fixed_data=[("TeamID", 8192)],
            gameloop=610 + 16 * 159,
        ),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    assert payload["timeline"]["objectives"] == [
        {"kind": "mercenaryCamp", "team": 1, "atSeconds": 159, "detail": "Siege Camp"}
    ]
~~~

The existing `test_build_payload_timeline_defaults_to_empty_lists` must keep passing unchanged: an empty `objectives` array is omitted.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd daemon-python && pytest tests/test_parser.py -q -k objective_events`
Expected: FAIL -- `KeyError: 'objectives'`.

- [ ] **Step 3: Wire it into build_payload**

Next to the other timeline extractors, after `structure_events = _extract_structure_events(...)`:

~~~python
    objective_events = _extract_objective_events(tracker_events, gates_open_loop)
~~~

Just before the `payload = { ... }` literal, build the timeline dict:

~~~python
    timeline: dict[str, Any] = {
        "deaths": deaths,
        "levelSnapshots": level_snapshots,
        "structureEvents": structure_events,
    }
    # Additive and optional: an older daemon omits it, and a match with no
    # objective event omits it too, so the existing timeline contract is
    # unchanged (same rollout as the 1.8/1.11/1.13 blocks).
    if objective_events:
        timeline["objectives"] = objective_events
~~~

Then replace the inline `"timeline": {"deaths": deaths, "levelSnapshots": level_snapshots, "structureEvents": structure_events},` entry in the `payload` literal with `"timeline": timeline,`.

- [ ] **Step 4: Bump PARSER_VERSION**

In `daemon-python/src/constants.py`, add the changelog entry above the constant and change the value to `"1.15"`:

~~~python
# 1.15: adds an optional timeline.objectives[] block -- mercenary camp
# captures (JungleCampCapture) and map objectives (DragonKnightActivated,
# TributeCollected, RavenCurseActivated, SkyTempleCaptured/Activated,
# Altar/Town Captured, GhostShipCaptured, Warhead nuke events,
# HauntedMinesGolemsSpawned, VolskayaCapturePointComplete,
# Infernal Shrine Captured, Punisher Killed, SoulEatersSpawned,
# Immortal Defeated, Six Town Event Start), each as {kind, team, atSeconds,
# detail}, from an explicit allowlist of SStatGameEvent names (see
# OBJECTIVE_EVENT_SPECS). Additive/optional, so deliberately NOT paired with
# a MIN_PARSER_VERSION bump, same reasoning as 1.8/1.11/1.13: an older daemon
# would only waste bandwidth re-uploading replays it can't enrich, while a
# daemon that updates to this build resyncs its own replays by itself.
PARSER_VERSION = "1.15"
~~~

- [ ] **Step 5: Run the whole daemon suite**

Run: `cd daemon-python && pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add daemon-python/src/parser.py daemon-python/src/constants.py daemon-python/tests/test_parser.py
git commit -m "feat(daemon): send the objective-event timeline block (PARSER_VERSION 1.15)"
~~~

---

### Task 4: Database table and additive migration

**Files:**
- Create: `packages/db/src/schema/match-objective-events.ts`
- Create: `packages/db/src/schema/match-objective-events.test.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create (generated): `packages/db/drizzle/0022_*.sql` and its `meta/` snapshot

**Interfaces:**
- Consumes: `matches` from `./matches`.
- Produces: `matchObjectiveEvents` Drizzle table, `MatchObjectiveEventRow`, `NewMatchObjectiveEvent`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/schema/match-objective-events.test.ts`:

~~~ts
import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { matchObjectiveEvents } from "./match-objective-events";
import { matchPlayers } from "./match-players";
import { matches } from "./matches";

describe("match_objective_events schema", () => {
  test("the only foreign key points at matches with ON DELETE cascade", () => {
    const config = getTableConfig(matchObjectiveEvents);
    expect(config.name).toBe("match_objective_events");
    expect(config.foreignKeys).toHaveLength(1);
    expect(config.foreignKeys[0]!.reference().foreignTable).toBe(matches);
    expect(config.foreignKeys[0]!.onDelete).toBe("cascade");
  });

  test("is keyed by match, never by match_player", () => {
    const config = getTableConfig(matchObjectiveEvents);
    const referenced = config.foreignKeys.map((fk) => fk.reference().foreignTable);
    expect(referenced).not.toContain(matchPlayers);
  });
});
~~~

Run: `bun test packages/db`
Expected: FAIL -- module not found.

- [ ] **Step 2: Add the schema**

Create `packages/db/src/schema/match-objective-events.ts`:

~~~ts
import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { matches } from "./matches";

/**
 * One mercenary-camp or map-objective capture for a match -- keyed by
 * matchId (not matchPlayerId like match-deaths.ts: an objective belongs to a
 * team, not to one hero). See
 * packages/shared-types/src/replay-payload.ts's matchObjectiveEventSchema and
 * daemon-python/src/parser.py's _extract_objective_events (PARSER_VERSION
 * 1.15).
 *
 * kind is text, not a pgEnum: unlike structure_type's closed set of four, the
 * objective vocabulary grows with each battleground, and the boundary that
 * matters is the ingest-time zod enum. team is null when the event carries no
 * unambiguous side.
 */
export const matchObjectiveEvents = pgTable(
  "match_objective_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    team: integer("team"),
    atSeconds: integer("at_seconds").notNull(),
    kind: text("kind").notNull(),
    detail: text("detail"),
  },
  (table) => ({
    matchIdIdx: index("match_objective_events_match_id_idx").on(table.matchId),
  }),
);

export type MatchObjectiveEventRow = typeof matchObjectiveEvents.$inferSelect;
export type NewMatchObjectiveEvent = typeof matchObjectiveEvents.$inferInsert;
~~~

Append to `packages/db/src/schema/index.ts`:

~~~ts
export * from "./match-objective-events";
~~~

- [ ] **Step 3: Run the test**

Run: `bun test packages/db`
Expected: PASS.

- [ ] **Step 4: Generate the migration and verify it is additive**

Run: `bun run --filter './packages/db' generate`
Open the generated `packages/db/drizzle/0022_*.sql` and confirm it only contains `CREATE TABLE`, `CREATE INDEX` and `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY`. If any `DROP` or `RENAME` appears, stop and fix the schema instead of committing.

- [ ] **Step 5: Commit**

~~~bash
git add packages/db/src/schema/match-objective-events.ts packages/db/src/schema/match-objective-events.test.ts packages/db/src/schema/index.ts packages/db/drizzle
git commit -m "chore(db): add the match_objective_events table"
~~~

---

### Task 5: Ingest objective events

**Files:**
- Modify: `apps/api/src/services/replay-upsert.service.ts`

**Interfaces:**
- Consumes: `matchObjectiveEvents` (Task 4), `MatchObjectiveEvent` (Task 1).
- Produces: rows in `match_objective_events` for every ingested match.

- [ ] **Step 1: Import the table and the type**

Add `matchObjectiveEvents,` to the `@hots-stats/db` import block and `type MatchObjectiveEvent,` to the `@hots-stats/shared-types` import block.

- [ ] **Step 2: Delete objective rows on re-ingest**

Right after the existing `await tx.delete(matchStructureEvents).where(eq(matchStructureEvents.matchId, matchId));`:

~~~ts
      await tx.delete(matchObjectiveEvents).where(eq(matchObjectiveEvents.matchId, matchId));
~~~

Extend the comment above those two deletes to say `match_objective_events` is also FK'd on `matchId` directly and needs the same explicit cleanup.

- [ ] **Step 3: Read the block from the payload**

Next to `const structureEvents: MatchStructureEvent[] = payload.timeline?.structureEvents ?? [];`:

~~~ts
  // Optional: absent for a daemon older than PARSER_VERSION 1.15 (which
  // doesn't send it yet) and for a match with no objective event.
  const objectiveEvents: MatchObjectiveEvent[] = payload.timeline?.objectives ?? [];
~~~

- [ ] **Step 4: Insert the rows**

After the `if (structureEvents.length > 0) { ... }` block:

~~~ts
    if (objectiveEvents.length > 0) {
      await tx.insert(matchObjectiveEvents).values(
        objectiveEvents.map((event) => ({
          matchId,
          team: event.team,
          atSeconds: event.atSeconds,
          kind: event.kind,
          detail: event.detail ?? null,
        })),
      );
    }
~~~

- [ ] **Step 5: Verify**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add apps/api/src/services/replay-upsert.service.ts
git commit -m "feat(api): store objective events on ingest"
~~~

---
### Task 6: Return objective events on the match detail

**Files:**
- Modify: `apps/api/src/routes/matches.ts`

**Interfaces:**
- Consumes: `matchObjectiveEvents` (Task 4).
- Produces: `GET /matches/:id`'s `timeline.objectives`, absent when the match has none (same as `structureEvents`).

- [ ] **Step 1: Import the table**

Add `matchObjectiveEvents,` to the `@hots-stats/db` import block.

- [ ] **Step 2: Query the rows**

In the `Promise.all` that loads `deathRows ... structureEventRows ... calibrationRows`, insert a query between the `matchStructureEvents` promise and the `mapCalibrations` one, and add `objectiveEventRows` to the destructured tuple so the two orders stay identical:

~~~ts
const [
  deathRows,
  levelSnapshotRows,
  spatialGridRows,
  trajectoryRows,
  structureEventRows,
  objectiveEventRows,
  calibrationRows,
] = await Promise.all([
  // ...the five existing matchPlayerIds-gated queries unchanged...
  // Match-wide, not gated on playerIds -- same reasoning as
  // match_structure_events above.
  db
    .select({
      team: matchObjectiveEvents.team,
      atSeconds: matchObjectiveEvents.atSeconds,
      kind: matchObjectiveEvents.kind,
      detail: matchObjectiveEvents.detail,
    })
    .from(matchObjectiveEvents)
    .where(eq(matchObjectiveEvents.matchId, match.id)),
  // ...the existing mapCalibrations query unchanged...
]);
~~~

- [ ] **Step 3: Include them in the response**

Extend the timeline guard so it also fires when objectives exist:

~~~ts
      deathRows.length > 0 ||
      levelSnapshotRows.length > 0 ||
      structureEventRows.length > 0 ||
      objectiveEventRows.length > 0
~~~

and add the field inside the `timeline` object, right after `structureEvents`:

~~~ts
            objectives: objectiveEventRows.map((e) => ({
              kind: e.kind,
              team: e.team,
              atSeconds: e.atSeconds,
              detail: e.detail,
            })),
~~~

- [ ] **Step 4: Verify**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/api/src/routes/matches.ts
git commit -m "feat(api): expose objective events on the match detail"
~~~

---

### Task 7: Web wire type and series derivation

**Files:**
- Modify: `apps/web/app/types/coach.ts`
- Modify: `apps/web/app/composables/useMatchTimelineSeries.ts`
- Create: `apps/web/app/composables/useMatchTimelineSeries.objectives.test.ts`

**Interfaces:**
- Consumes: `MatchObjectiveEvent` (shared-types).
- Produces: `MatchTimelineData.objectives?: MatchObjectiveEvent[]` and `MatchTimelineSeries.objectives: MatchObjectiveEvent[]` (time-ordered).

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/composables/useMatchTimelineSeries.objectives.test.ts`:

~~~ts
import { describe, expect, test } from "vitest";
import { buildMatchTimelineSeries, type MatchTimelineInput } from "./useMatchTimelineSeries";

function input(timeline: MatchTimelineInput["timeline"]): MatchTimelineInput {
  return { timeline, players: [], durationSeconds: 600 };
}

describe("buildMatchTimelineSeries objectives", () => {
  test("carries objective events through, time-ordered", () => {
    const series = buildMatchTimelineSeries(
      input({
        deaths: [],
        levelSnapshots: [],
        objectives: [
          { kind: "tribute", team: 0, atSeconds: 120, detail: null },
          { kind: "mercenaryCamp", team: 1, atSeconds: 60, detail: "Siege Camp" },
        ],
      }),
    );

    expect(series.objectives.map((objective) => objective.atSeconds)).toEqual([60, 120]);
    expect(series.objectives[0]).toEqual({
      kind: "mercenaryCamp",
      team: 1,
      atSeconds: 60,
      detail: "Siege Camp",
    });
  });

  test("defaults objectives to an empty array without a timeline", () => {
    expect(buildMatchTimelineSeries(input(null)).objectives).toEqual([]);
  });

  test("keeps an empty array when the timeline carries no objectives", () => {
    expect(buildMatchTimelineSeries(input({ deaths: [], levelSnapshots: [] })).objectives).toEqual([]);
  });
});
~~~

Run: `bun run --filter './apps/web' test useMatchTimelineSeries.objectives`
Expected: FAIL -- `objectives` does not exist on the series type.

- [ ] **Step 2: Extend the wire type**

In `apps/web/app/types/coach.ts`, add at the top:

~~~ts
import type { MatchObjectiveEvent } from "@hots-stats/shared-types";
~~~

add to `MatchTimelineData`:

~~~ts
  /** Optional: absent for a match ingested before PARSER_VERSION 1.15. */
  objectives?: MatchObjectiveEvent[];
~~~

and add to `MatchTimelineSeries`:

~~~ts
  /** Camps/objectives captured this match, time-ordered. */
  objectives: MatchObjectiveEvent[];
~~~

- [ ] **Step 3: Derive it in the composable**

In `apps/web/app/composables/useMatchTimelineSeries.ts`, add `objectives: [],` to the early-return object (the `if (!timeline)` branch, next to `structures: [],`). Then, before the main `return`, derive the sorted list:

~~~ts
  const objectives = [...(timeline.objectives ?? [])].sort((a, b) => a.atSeconds - b.atSeconds);
~~~

and add `objectives,` to the returned object.

- [ ] **Step 4: Run the test**

Run: `bun run --filter './apps/web' test useMatchTimelineSeries.objectives`
Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/web/app/types/coach.ts apps/web/app/composables/useMatchTimelineSeries.ts apps/web/app/composables/useMatchTimelineSeries.objectives.test.ts
git commit -m "feat(web): carry objective events in the match timeline series"
~~~

---

### Task 8: French labels for objective kinds

**Files:**
- Create: `apps/web/app/utils/objectiveEvents.ts`
- Create: `apps/web/app/utils/objectiveEvents.test.ts`

**Interfaces:**
- Consumes: `ObjectiveEventKind` / `MatchObjectiveEvent` (shared-types), `MatchTimelineTeamLabels`.
- Produces: `OBJECTIVE_KIND_LABELS`, `objectiveKindLabel(kind)`, `objectiveEventLabel(event)`, `objectiveSideLabel(team, labels)`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/utils/objectiveEvents.test.ts`:

~~~ts
import { describe, expect, test } from "vitest";
import { timelineTeamLabels } from "~/composables/useMatchTimelineSeries";
import {
  OBJECTIVE_KIND_LABELS,
  objectiveEventLabel,
  objectiveKindLabel,
  objectiveSideLabel,
} from "./objectiveEvents";

describe("objectiveKindLabel", () => {
  test("labels every supported kind in French", () => {
    expect(objectiveKindLabel("mercenaryCamp")).toBe("Camp mercenaire");
    expect(objectiveKindLabel("immortalDefeated")).toBe("Immortel vaincu");
  });

  test("falls back to the raw slug rather than crashing on an unknown kind", () => {
    expect(objectiveKindLabel("someFutureKind")).toBe("someFutureKind");
  });
});

describe("objectiveEventLabel", () => {
  test("appends the detail when there is one", () => {
    expect(objectiveEventLabel({ kind: "mercenaryCamp", team: 1, atSeconds: 60, detail: "Siege Camp" })).toBe(
      "Camp mercenaire · Siege Camp",
    );
  });

  test("omits the detail when there is none", () => {
    expect(objectiveEventLabel({ kind: "tribute", team: 0, atSeconds: 60 })).toBe("Tribut");
  });
});

describe("objectiveSideLabel", () => {
  test("names the side from the shared team labels", () => {
    expect(objectiveSideLabel(0, timelineTeamLabels(0))).toBe("mon équipe");
    expect(objectiveSideLabel(1, timelineTeamLabels(0))).toBe("les adversaires");
    expect(objectiveSideLabel(null, timelineTeamLabels(null))).toBe("équipe inconnue");
  });
});

describe("OBJECTIVE_KIND_LABELS", () => {
  test("covers all 19 kinds", () => {
    expect(Object.keys(OBJECTIVE_KIND_LABELS)).toHaveLength(19);
  });
});
~~~

Run: `bun run --filter './apps/web' test objectiveEvents`
Expected: FAIL -- module not found.

- [ ] **Step 2: Implement it**

Create `apps/web/app/utils/objectiveEvents.ts`:

~~~ts
import type { MatchObjectiveEvent, ObjectiveEventKind } from "@hots-stats/shared-types";
import type { MatchTimelineTeamLabels } from "~/types/coach";

/**
 * French label for every objective kind the daemon can emit. Typed as a
 * Record<ObjectiveEventKind, string> so adding a kind to the shared enum
 * without a label is a compile error, not a silent raw slug on screen.
 */
export const OBJECTIVE_KIND_LABELS: Record<ObjectiveEventKind, string> = {
  mercenaryCamp: "Camp mercenaire",
  dragonKnight: "Chevalier dragon",
  tribute: "Tribut",
  curse: "Malédiction",
  templeCaptured: "Temple capturé",
  templeActivated: "Temple activé",
  altarCaptured: "Autel capturé",
  townCaptured: "Ville capturée",
  ghostShipCaptured: "Navire fantôme capturé",
  nukeCollected: "Nuke récupérée",
  nukeFired: "Nuke tirée",
  nukeDropped: "Nuke lâchée",
  golemsSpawned: "Golems de la mine",
  capturePoint: "Point de capture",
  shrineCaptured: "Sanctuaire capturé",
  punisherKilled: "Punisseur tué",
  soulEatersSpawned: "Dévoreurs d'âmes",
  immortalDefeated: "Immortel vaincu",
  sixTownStart: "Événement des six villes",
};

/** Falls back to the raw slug for a kind this build predates, so an unknown
 * objective never blanks the list. */
export function objectiveKindLabel(kind: string): string {
  return (OBJECTIVE_KIND_LABELS as Record<string, string>)[kind] ?? kind;
}

/** "Camp mercenaire · Siege Camp", or just the label when there is no detail. */
export function objectiveEventLabel(event: MatchObjectiveEvent): string {
  const label = objectiveKindLabel(event.kind);
  return event.detail ? label + " · " + event.detail : label;
}

/** Which side captured it, in the same words the chronology uses. */
export function objectiveSideLabel(team: 0 | 1 | null, labels: MatchTimelineTeamLabels): string {
  if (team === 0) return labels.team0;
  if (team === 1) return labels.team1;
  return "équipe inconnue";
}
~~~

- [ ] **Step 3: Run the test**

Run: `bun run --filter './apps/web' test objectiveEvents`
Expected: PASS.

- [ ] **Step 4: Commit**

~~~bash
git add apps/web/app/utils/objectiveEvents.ts apps/web/app/utils/objectiveEvents.test.ts
git commit -m "feat(web): label objective events in French"
~~~

---

### Task 9: Chronologie markers and text summary

**Files:**
- Create: `apps/web/app/components/charts/MatchObjectives.vue`
- Modify: `apps/web/app/pages/matches/[id].vue`

**Interfaces:**
- Consumes: `MatchTimelineSeries.objectives` (Task 7), the labels (Task 8), `formatClock` (`~/utils/heatmapCellDetails`), `ALLY_TEAM_RGB`/`ENEMY_TEAM_RGB` (`~/utils/spatialColors`), `UiStateCard`.
- Produces: a `<ChartsMatchObjectives>` block in the Chronologie tab.

- [ ] **Step 1: Create the component**

Create `apps/web/app/components/charts/MatchObjectives.vue`:

~~~vue
<script setup lang="ts">
import type { MatchObjectiveEvent } from "@hots-stats/shared-types";
import { timelineTeamLabels } from "~/composables/useMatchTimelineSeries";
import { formatClock } from "~/utils/heatmapCellDetails";
import { objectiveEventLabel, objectiveSideLabel } from "~/utils/objectiveEvents";
import { ALLY_TEAM_RGB, ENEMY_TEAM_RGB } from "~/utils/spatialColors";

const props = withDefaults(
  defineProps<{
    objectives: MatchObjectiveEvent[];
    durationSeconds: number;
    allyTeam?: 0 | 1 | null;
  }>(),
  { allyTeam: null },
);

/** Matches the chart's own 800-unit viewBox so markers line up vertically. */
const WIDTH = 800;
const HEIGHT = 36;

const labels = computed(() => timelineTeamLabels(props.allyTeam));

const teamColors = computed<[string, string]>(() => {
  const ally = "rgb(" + ALLY_TEAM_RGB.join(", ") + ")";
  const enemy = "rgb(" + ENEMY_TEAM_RGB.join(", ") + ")";
  return props.allyTeam === 1 ? [enemy, ally] : [ally, enemy];
});

/** Marker x from the real elapsed time -- never an invented position. */
function markerX(atSeconds: number): number {
  const ratio = props.durationSeconds > 0 ? Math.min(1, Math.max(0, atSeconds / props.durationSeconds)) : 0;
  return ratio * WIDTH;
}

function markerColor(team: 0 | 1 | null): string {
  if (team === null) return "rgb(148, 163, 184)";
  return teamColors.value[team]!;
}
</script>

<template>
  <section class="rounded-lg border border-border bg-surface p-4">
    <h3 class="text-sm font-semibold text-foreground">Objectifs et camps</h3>

    <UiStateCard
      v-if="objectives.length === 0"
      state="empty"
      size="sm"
      message="Aucun objectif ni camp enregistré pour cette partie."
    />

    <template v-else>
      <svg
        class="mt-3 w-full"
        :viewBox="'0 0 ' + WIDTH + ' ' + HEIGHT"
        role="img"
        aria-label="Chronologie des objectifs et camps de la partie"
      >
        <line :x1="0" :y1="HEIGHT / 2" :x2="WIDTH" :y2="HEIGHT / 2" stroke="rgb(148, 163, 184)" stroke-width="2" />
        <circle
          v-for="(objective, index) in objectives"
          :key="index"
          :cx="markerX(objective.atSeconds)"
          :cy="HEIGHT / 2"
          r="6"
          :fill="markerColor(objective.team)"
        />
      </svg>

      <ul class="mt-3 flex flex-col gap-1 text-sm">
        <li v-for="(objective, index) in objectives" :key="index" class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-muted">{{ formatClock(objective.atSeconds) }}</span>
          <span
            class="inline-block h-2 w-2 rounded-full"
            :style="{ backgroundColor: markerColor(objective.team) }"
            aria-hidden="true"
          />
          <span class="text-foreground">{{ objectiveEventLabel(objective) }}</span>
          <span class="text-muted">— {{ objectiveSideLabel(objective.team, labels) }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>
~~~

- [ ] **Step 2: Mount it in the Chronologie tab**

In `apps/web/app/pages/matches/[id].vue`, inside the `#chronology` template, after the `</div>` closing the `grid ... lg:grid-cols-[minmax(0,1fr)_21rem]` block and before the `</div>` that closes `chronologyShell`:

~~~vue
          <ChartsMatchObjectives
            :objectives="timelineSeries.objectives"
            :duration-seconds="timelineDuration"
            :ally-team="viewerTeam"
          />
~~~

- [ ] **Step 3: Verify**

Run: `bun run --filter './apps/web' test`
Expected: PASS.
Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

~~~bash
git add apps/web/app/components/charts/MatchObjectives.vue apps/web/app/pages/matches/[id].vue
git commit -m "feat(web): show objective and camp markers on the match chronology"
~~~

---

### Task 10: Roadmap, docs and the full verification gate

**Files:**
- Modify: `tasks/progression-roadmap.md`
- Modify: `tasks/README.md`

- [ ] **Step 1: Run the whole gate**

~~~bash
bun run typecheck
bun test packages/shared-types
bun test apps/api
bun test packages/db
bun run --filter './apps/web' test
cd daemon-python && pytest -q
~~~

Expected: all green. Investigate any failure before going further.

- [ ] **Step 2: Tick the roadmap entry**

In `tasks/progression-roadmap.md`, change `- [ ] **G1 —` to `- [x] **G1 —` and append a `**Fait** (2026-09-20). Écarts / précisions vs spec :` block recording: the allowlist and its exclusions; the `PARSER_VERSION` bump with `MIN_PARSER_VERSION` left at `1.10`; the `kind` `text` column (no `pgEnum`); and that the markers live in a sibling `MatchObjectives.vue` component mounted in the Chronologie tab rather than inside the 851-line chart (same tab, no reflow of the C2 layout).

- [ ] **Step 3: One line in tasks/README.md**

Add to the "Déjà fait" section, after the F4 entry:

~~~markdown
- **Suite Progression — G1 (événements d'objectifs)** : extraction daemon
  allowlistée des `SStatGameEvent` (camps + objectifs par carte) dans
  `timeline.objectives` (PARSER_VERSION 1.15, `MIN_PARSER_VERSION` inchangé),
  table additive `match_objective_events`, exposition sur `GET /matches/:id`,
  marqueurs + résumé FR sur la Chronologie de `/matches/[id]`.
~~~

- [ ] **Step 4: Commit the docs**

Run: `bun run typecheck`
Expected: PASS.

~~~bash
git add tasks/progression-roadmap.md tasks/README.md
git commit -m "docs(tasks): record the G1 objective-events chantier"
~~~

- [ ] **Step 5: Push only if the whole gate is green**

~~~bash
git push origin main
~~~

If any step above was not green, do NOT push: commit locally and report the blocker instead.

---

## Self-review notes

- **Spec coverage:** shared contract (Task 1), daemon extraction (Tasks 2-3), additive table + migration (Task 4), upsert (Task 5), API (Task 6), UI markers + text summary (Tasks 7-9), gate + docs (Task 10). Non-goals (per-player objective stats, aggregation, player attribution) are untouched.
- **Type consistency:** `MatchObjectiveEvent` is defined once in shared-types and consumed by the API, the web wire type, the label util and the component. `_extract_objective_events` is the only daemon producer; `matchObjectiveEvents` is the only table.
- **No placeholders:** every step carries the code or the exact command it needs.
