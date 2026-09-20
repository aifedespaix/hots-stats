# Objective events — Design (G1)

**Date:** 2026-09-20
**Status:** approved (design), implementation pending
**Spec parent:** `docs/superpowers/specs/2026-09-18-player-progression-design.md` § G1
**Roadmap entry:** `tasks/progression-roadmap.md` — Lot G, chantier G1

## Context

G1 is the only chantier left in the player-progression roadmap. The parent spec
kept it out of lots A–F on purpose: it touches the ingestion pipeline
(daemon → payload → adapters/quarantine) and therefore needs its own design
before a line of code. Its stated goal is to make **objective captures** and
**mercenary camps** real, timestamped data instead of a gap the web app works
around.

Nothing in the pipeline carries objectives or camps today:

- `timeline` only has `deaths`, `levelSnapshots` and `structureEvents`
  (`packages/shared-types/src/replay-payload.ts`).
- The daemon *does* forward per-player objective **stats** already
  (`mercCampCaptures`, `dragonShrinesCaptured`,
  `gardenSeedsCollectedByPlayer`, `townKills`, …) through
  `SScoreResultEvent` — see `constants.py`'s `STAT_FIELD_RENAMES` comment
  — but `replayPlayerSchema` is a non-strict `z.object` and silently strips
  every field it does not declare, so none of them reach the database.

That per-player stat passthrough is a **separate, smaller change** (schema
field + column + write, no daemon rebuild) and is an explicit non-goal here:
it carries no team, no timestamp and no event identity.

## Finding: the tracker stream carries camps universally, objectives per map

Probed with the daemon's own decoder and `parser.parse_replay` against 120
real replays spanning 19 battlegrounds. There is **no `replay.game.events`**
stream in these archives — everything below is
`NNet.Replay.Tracker.SStatGameEvent`.

| Tracker event `m_eventName` | Seen (120 replays) | Battlegrounds | Payload |
|---|---|---|---|
| `JungleCampCapture` | 1621 | **19** | `m_intData: CampID`, `m_stringData: CampType` (e.g. "Siege Camp"), `m_fixedData: TeamID` |
| `SkyTempleCaptured` | 202 | 1 | `m_intData: TeamID`, `m_fixedData: GameTime` |
| `SkyTempleActivated` | 44 | 1 | `m_intData: TempleID` |
| `Altar Captured` | 107 | 1 | `m_intData: Firing Team` |
| `Town Captured` | 73 | 1 | `m_intData: New Owner` |
| `TributeCollected` | 51 | 1 | `m_fixedData: TeamID` |
| `RavenCurseActivated` | 12 | 1 | `m_fixedData: TeamID` |
| `DragonKnightActivated` | 34 | 1 | `m_fixedData: TeamID` |
| `GhostShipCaptured` | 41 | 1 | `m_fixedData: TeamID` |
| `WarheadJunctionNukeCollected` / `Fired` / `Dropped` | 73 / 69 / 25 | 1 | `m_intData: OwningTeam` |
| `HauntedMinesGolemsSpawned` | 60 | 1 | `m_fixedData: TeamID` |
| `VolskayaCapturePointComplete` | 27 | 1 | `m_intData: WinningTeam` |
| `Infernal Shrine Captured` | 33 | 1 | `m_intData: Winning Team` |
| `Punisher Killed` | 31 | 1 | `m_intData: Owning Team of Punisher`, `m_stringData: Punisher Type` |
| `SoulEatersSpawned` | 29 | 1 | `m_fixedData: TeamID` |
| `Immortal Defeated` | 13 | 1 | `m_intData: Winning Team` |
| `Six Town Event Start` | 5 | 1 | `m_intData: Owning Team` |


**Team convention.** `m_fixedData` values are Q12 fixed point
(`value // 4096`), so a fixed `TeamID` of `4096`/`8192` is team 1/2,
while several events carry a plain 1-based int team under a map-specific key.
The parser/database convention (`players[].team`, `structureEvents[].team`)
is `0`/`1`, so every extracted team is shifted by `- 1`. Validated on a
sample replay: all its camps fired `TeamID: 8192` → team `1`, the winning
side.

**Noise deliberately excluded.** `SkyTempleShotsFired` (1891 in the sample,
per-shot), `Boss Duel Started` (no team; the outcome is
`Immortal Defeated`), `GolemLanes` (two teams, one per lane),
`BraxisHoldoutMapEventComplete` (no team), `Pickup Spawned`/`Pickup Used`
(Braxis Escape, player-scoped), `TownStructureInit`/`TownStructureDeath`
and `PlayerDeath` (already covered by `timeline.structureEvents` /
`deaths`).

## Design

### 1. Shared contract (`packages/shared-types/src/replay-payload.ts`)

One optional array is added to `matchTimelineSchema` — additive, so an older
daemon that omits it still validates:

```ts
export const objectiveEventKindSchema = z.enum([
  "mercenaryCamp", "dragonKnight", "tribute", "curse",
  "templeCaptured", "templeActivated", "altarCaptured", "townCaptured",
  "ghostShipCaptured", "nukeCollected", "nukeFired", "nukeDropped",
  "golemsSpawned", "capturePoint", "shrineCaptured", "punisherKilled",
  "soulEatersSpawned", "immortalDefeated", "sixTownStart",
]);

export const matchObjectiveEventSchema = z.object({
  kind: objectiveEventKindSchema,
  // null when the event carries no unambiguous team (see the table below)
  team: z.union([z.literal(0), z.literal(1)]).nullable(),
  atSeconds: z.number().int().nonnegative(),
  // camp type / punisher type, when the event carries one
  detail: z.string().nullable().optional(),
});
```

```ts
matchTimelineSchema = z.object({
  deaths, levelSnapshots, structureEvents,
  objectives: z.array(matchObjectiveEventSchema).optional(),
})
```

### 2. Daemon (`daemon-python/src/parser.py` + `constants.py`)

A **declarative allowlist** `OBJECTIVE_EVENT_SPECS` in `constants.py` maps a
tracker `m_eventName` to its kind, its team source (`("int"|"fixed", key)`
or `None`) and its optional detail source. `_extract_objective_events(
tracker_events, gates_open_loop)` walks `SStatGameEvent`s and emits one entry
per allowlisted name:

| `m_eventName` | kind | team source | detail |
|---|---|---|---|
| `JungleCampCapture` | `mercenaryCamp` | fixed `TeamID` | `CampType` |
| `DragonKnightActivated` | `dragonKnight` | fixed `TeamID` | — |
| `TributeCollected` | `tribute` | fixed `TeamID` | — |
| `RavenCurseActivated` | `curse` | fixed `TeamID` | — |
| `SkyTempleCaptured` | `templeCaptured` | int `TeamID` | — |
| `SkyTempleActivated` | `templeActivated` | `null` | — |
| `Altar Captured` | `altarCaptured` | int `Firing Team` | — |
| `Town Captured` | `townCaptured` | `null`² | — |
| `GhostShipCaptured` | `ghostShipCaptured` | fixed `TeamID` | — |
| `WarheadJunctionNukeCollected` | `nukeCollected` | int `OwningTeam` | — |
| `WarheadJunctionNukeFired` | `nukeFired` | int `OwningTeam` | — |
| `WarheadJunctionNukeDropped` | `nukeDropped` | int `OwningTeam` | — |
| `HauntedMinesGolemsSpawned` | `golemsSpawned` | fixed `TeamID` | — |
| `VolskayaCapturePointComplete` | `capturePoint` | int `WinningTeam` | — |
| `Infernal Shrine Captured` | `shrineCaptured` | int `Winning Team` | — |
| `Punisher Killed` | `punisherKilled` | int `Owning Team of Punisher`² | `Punisher Type` |
| `SoulEatersSpawned` | `soulEatersSpawned` | fixed `TeamID` | — |
| `Immortal Defeated` | `immortalDefeated` | int `Winning Team` | — |
| `Six Town Event Start` | `sixTownStart` | int `Owning Team` | — |

² `Town Captured`'s `New Owner` is not a team (observed `11`) and
`Punisher Killed`'s `Owning Team of Punisher` is the team that *owned* the
killed punisher, not the team that captured the shrine. Both are emitted, but
the spec never pretends they are a "team that won the objective" — the web
label reads accordingly, and the team is kept verbatim from the field key.

Rules:

- `atSeconds = max(0, round((event["_gameloop"] - gates_open_loop) / 16))`
  — the same reference point `deaths`/`structureEvents` use.
- fixed team → `value // 4096 - 1`; int team → `value - 1`.
- **Any mapped team outside `{0, 1}`, or a missing key, drops the event** —
  skip rather than guess, the same posture `_extract_deaths` and
  `_structure_unit_teams_by_tag` already take.
- An `m_eventName` absent from the allowlist produces nothing.
- `build_payload` adds `objectives` to the `timeline` dict (omitted, not
  empty, when there are none — same `... if events else` convention as the
  other timeline arrays).

### 3. Database (`packages/db/src/schema/match-objective-events.ts`)

New additive table, keyed by match like `match_structure_events`:

```
match_objective_events
  id          uuid pk default random
  match_id    uuid not null -> matches.id on delete cascade
  team        integer null          -- 0/1, null when not applicable
  at_seconds  integer not null
  kind        text not null         -- validated by the zod enum at ingest
  detail      text null
  index on (match_id)
```

`kind` is `text`, not a `pgEnum`: unlike `structure_type`'s closed set of
four, the objective vocabulary grows with each battleground, and the boundary
that actually matters is the ingest-time zod enum. `detail` is free text
(camp/punisher type), never a number the UI would present as a metric.

### 4. Ingestion and API

- `apps/api/src/services/replay-upsert.service.ts` inserts the rows next to
  the existing `structureEvents` insert (inside the same per-match
  transaction).
- `GET /matches/:id` (`apps/api/src/routes/matches.ts`) reads the rows and
  attaches `timeline.objectives` to the existing response. The `timeline`
  object is now also emitted when objectives are the only timeline data. The
  field is absent for older matches — exactly like `structureEvents` today,
  so no existing value changes.

### 5. Web UI (`apps/web`)

- Pure module `app/utils/objectiveEvents.ts`: French labels per kind
  (`mercenaryCamp` → « Camp mercenaire », `immortalDefeated` →
  « Immortel vaincu », …), a `detail` suffix, and the marker geometry/order.
  Locked by `objectiveEvents.test.ts` — no rule lives in the template.
- `components/matches/MatchTimelineChart.vue` (the C2 Chronologie) gains
  objective/camp markers at their `atSeconds`, plus a **text summary** of the
  events (accessibility + SSR fallback, per the parent spec's cross-cutting
  rule). Empty state via `UiStateCard`.

## Non-goals

- Per-player objective stats (`mercCampCaptures`, `dragonShrinesCaptured`,
  `gardenSeedsCollectedByPlayer`, `townKills`): already sent by the daemon,
  stripped by zod. Separate additive change, not G1.
- Aggregate per-map objective analytics (objective control per side over N
  matches). Own chantier.
- Player attribution for camps: `JungleCampCapture` carries no `PlayerID`.
- The excluded event names listed above.
- Feeding objectives into the heatmap "event anchor" sync (C1/C2 Slots).

## Version decision

- `PARSER_VERSION` `1.14` → **`1.15`** with a changelog entry.
- `MIN_PARSER_VERSION` (`apps/api/src/constants.ts`) stays **`1.10`**.

Rationale: the new block is additive and optional, exactly like the 1.8 /
1.11 / 1.13 blocks. Bumping `MIN_PARSER_VERSION` would force a *mass resync*
of every already-synced replay on every daemon that checks in — including
builds that cannot produce the block, for zero gain. A daemon that updates to
1.15 resyncs its own previously-synced replays by itself (see
`daemon-python/src/constants.py`'s 1.8 entry and `sync_state.is_up_to_date`).

## Acceptance criteria

1. The daemon emits one `objectives` entry per allowlisted tracker event with
   the right kind, team, `atSeconds` and `detail`; an `m_eventName` outside
   the allowlist produces none.
2. Team mapping: fixed `4096`→`0`, `8192`→`1`; int `1`→`0`, `2`→`1`;
   a mapped value outside `{0, 1}` drops the event rather than guessing;
   `templeActivated` and `townCaptured` emit `team: null`.
3. `atSeconds` is measured from gates open, the same reference
   `timeline.deaths` uses.
4. A daemon that sends no `objectives` still validates and ingests exactly as
   today: no objective row written, `timeline.objectives` absent from
   `GET /matches/:id`. No existing endpoint or page value changes.
5. The migration is additive only (CREATE TABLE/INDEX and the FK) — no
   DROP/RENAME.
6. `GET /matches/:id` returns the events, and `/matches/[id]`'s Chronologie
   shows their markers plus a French text summary; the empty state is handled.
7. `PARSER_VERSION` is `1.15` with its changelog entry;
   `MIN_PARSER_VERSION` is unchanged and this decision is documented.
8. Tests: daemon pytest (synthetic `SStatGameEvent` fixtures, every kind,
   unknown-name skip, out-of-range team skip, 1/2→0/1 shift), shared-types
   schema test, web vitest on the pure util, plus the full gate
   (`bun run typecheck`, `bun test packages/shared-types`,
   `bun test apps/api`, `bun run --filter './apps/web' test`,
   `cd daemon-python && pytest -q`).

## Risks

| Risk | Mitigation |
|---|---|
| Team semantics ambiguous on two events | Emit `null` or keep the field's literal meaning; the label says so; never invent a "winner". |
| Allowlist not provably exhaustive for unobserved maps | Unknown names are silently ignored (never guessed); the table is data-backed and additive — a new kind is a constants row + a label. |
| Fixed-vs-int team key confusion | Declared per kind in the table and pinned by a test for each shape. |
| Payload growth | Camps+objectives are a few events per minute of match — tens of rows, negligible against the existing spatial block. |
| `Six Town Event Start` fires five times per match | Each is emitted verbatim; the UI groups them by `atSeconds`. |
