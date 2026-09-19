# Draft capture enrichment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the draft battleground and each slot's picked hero from the
live-draft screenshot (text OCR) and carry them from the daemon to the API
snapshot, so D1 has composition data.

**Architecture:** Two new text crops on the existing relative-box layout
(one battleground region, five hero-name regions per team), OCR'd by the
existing engine and POSTed additively; the API resolves raw names to
`mapId`/`heroId` once at ingest via a pure normalizer.

**Tech Stack:** Python 3 (Pillow, RapidOCR) daemon, Zod/TypeScript shared
types, Hono + Drizzle API, pytest / bun:test.

**Spec:** `docs/superpowers/specs/2026-09-19-draft-capture-enrichment-design.md`

## Global Constraints

- UI strings in French, identifiers/comments in English.
- Migrations additive only (none here); no new dependency.
- Every personal query goes through `accountScope`/`scopeConditions` (the
  draft routes already do; nothing here changes that).
- No invented data: an unresolved name stays `null` with its raw text kept.
- Verification: `cd daemon-python && pytest -q`, `bun test packages/shared-types`,
  `bun test apps/api`, `bun run typecheck`.

---

### Task 1 — Daemon: battleground + hero crops in the layout

**Files:** Modify `daemon-python/src/draft_layout.py`; test
`daemon-python/tests/test_draft_layout.py`.

**Interfaces:** Produces `BATTLEGROUND_CROP: RelBox`,
`TeamLayout.hero_crops: tuple[RelBox, ...]`, `TeamCropResult.hero_crops`,
`default_crop_config()` gaining `battlegroundCrop` / per-team `heroCrops`.

Defaults (validated against `draft-live-test/screenshot.png` with the real
OCR, 1920×1080):

```python
BATTLEGROUND_CROP = RelBox(0.30, 0.005, 0.70, 0.045)
# left
hero_crops=(RelBox(0.100,0.246,0.300,0.278), RelBox(0.325,0.334,0.525,0.366),
            RelBox(0.325,0.514,0.525,0.546), RelBox(0.540,0.604,0.740,0.636),
            RelBox(0.540,0.786,0.740,0.818))
# right
hero_crops=(RelBox(0.720,0.242,0.900,0.274), RelBox(0.530,0.335,0.730,0.367),
            RelBox(0.470,0.510,0.650,0.545), RelBox(0.300,0.604,0.500,0.636),
            RelBox(0.250,0.788,0.430,0.824))
```

- [ ] Step 1: failing tests — `extract_team_crops` exposes `hero_crops`
  (5 non-empty at 1080p, degrade to `None` on tiny screenshots);
  `default_crop_config()["battlegroundCrop"]`; `load_team_layouts` reads a
  custom `heroCrops`; the built-in left slot-1 hero box is pinned.
- [ ] Step 2: run `pytest tests/test_draft_layout.py -q` → fail.
- [ ] Step 3: add the fields + config (de)serialization, mirroring
  `player_crops`; give `TeamCropResult.hero_crops` a default so existing
  positional constructions keep compiling.
- [ ] Step 4: run the same command → pass.
- [ ] Step 5: commit `feat(daemon): capture the draft battleground and hero crops`.

### Task 2 — Daemon: battleground OCR keeps spaces

**Files:** Modify `daemon-python/src/ocr.py`; test `daemon-python/tests/test_ocr.py`.

**Interfaces:** Produces `read_battleground_name(crop) -> OcrResult`, identical
to `read_player_name` except the recognized text keeps its internal spaces
(`"GARDEN OF TERROR CLASSIC"`, not `"GARDENOFTERRORCLASSIC"`).

- [ ] Step 1: failing test on `_clean_text`/public behavior: given an engine
  reading `"GARDEN OF TERROR"`, `read_battleground_name` returns the spaced
  text while `read_player_name` still collapses it.
- [ ] Step 2: `pytest tests/test_ocr.py -q` → fail.
- [ ] Step 3: thread a `collapse_whitespace: bool = True` flag through
  `_read_with_engine`/`_choose_reading`; add the public wrapper.
- [ ] Step 4: pass.
- [ ] Step 5: commit.

### Task 3 — Daemon: capture + payload + debug artifacts

**Files:** Modify `daemon-python/src/draft_capture.py`,
`daemon-python/src/draft_debug.py`; tests `test_draft_capture.py`,
`test_draft_debug.py`.

**Interfaces:** Produces payload `{"mapName": str|None, "teamLeft": [{"slot",
"rawName", "status", "heroName"}], ...}`; `save_capture(..., battleground=None,
left_hero_results=None, right_hero_results=None)`.

- [ ] Step 1: failing tests — the payload carries `mapName` and per-slot
  `heroName`; an unreadable crop yields `heroName: None` yet still submits;
  `save_capture` writes `battleground.png`/`*-hero-<n>.png` and records
  `heroOcrText`.
- [ ] Step 2: `pytest tests/test_draft_capture.py tests/test_draft_debug.py -q` → fail.
- [ ] Step 3: implement — OCR `TeamCropResult.hero_crops`, OCR
  `BATTLEGROUND_CROP` off the screenshot, widen both payloads.
- [ ] Step 4: pass.
- [ ] Step 5: commit.

### Task 4 — Shared contract

**Files:** Modify `packages/shared-types/src/draft.ts`; test
`packages/shared-types/src/draft.test.ts` (create).

**Interfaces:** `draftSlotInputSchema` gains optional nullable `heroName`;
`draftSnapshotInputSchema` gains optional nullable `mapName`;
`DraftPlayerSlot` gains `heroName: string | null` and `heroId: string | null`;
`DraftSnapshot` gains `mapName: string | null` and `mapId: string | null`.

- [ ] Step 1: failing tests — a payload with the new fields parses; one without
  them also parses (backward compatible) and the parsed slot has no `heroName`.
- [ ] Step 2: `bun test packages/shared-types` → fail.
- [ ] Step 3: implement.
- [ ] Step 4: pass.
- [ ] Step 5: commit.

### Task 5 — API: pure draft resolution

**Files:** Create `apps/api/src/lib/draft-resolution.ts` + `draft-resolution.test.ts`.

**Interfaces:** `normalizeNameKey(value: string): string`;
`resolveMapId(rawName: string | null | undefined, maps: NamedEntity[]): string | null`;
`resolveHeroId(rawName: string | null | undefined, heroes: NamedEntity[]): string | null`.

- [ ] Step 1: failing tests — `E.T.C.`→`etc`, `MÉPHISTO`→`mephisto`,
  `Lt. Morales`→`ltmorales`; `GARDEN OF TERROR CLASSIC`→the map id;
  `LUISAILE`→`null`; two prefix candidates→`null`; empty→`null`.
- [ ] Step 2: `bun test apps/api` → fail.
- [ ] Step 3: implement.
- [ ] Step 4: pass.
- [ ] Step 5: commit.

### Task 6 — API: store + resolve + expose on the snapshot

**Files:** Modify `apps/api/src/services/draft.service.ts`.

**Interfaces:** `ResolvedSlot` gains `heroName`/`heroId`; `StoredSnapshot`
gains `mapName`/`mapId`; `toViewerSnapshot` exposes them; resolution runs once
in `ingestDraftSnapshot` with all `maps`/`heroes` rows (additive DB reads).

- [ ] Step 1: failing API tests? `draft.service.ts` needs a DB, so cover the
  pure part in Task 5 and assert here via typecheck + the existing suite.
- [ ] Step 2/3/4: implement, `bun run typecheck`, `bun test apps/api`.
- [ ] Step 5: commit `feat(api): resolve the draft battleground and hero names`.

### Task 7 — Docs

- [ ] Tick the roadmap / add the tasks-README line / update the D1 spec's
  data matrix. Commit `docs(tasks): ...`.

## Self-review

- Spec § acceptance 1–5 ↔ Tasks 1–6. ✔
- Localized aliases are explicitly out of scope; recorded in the spec. ✔
- No placeholders; all signatures defined once. ✔
