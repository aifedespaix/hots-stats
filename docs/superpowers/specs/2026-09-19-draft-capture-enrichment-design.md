# Draft capture enrichment — Design (prerequisite of D1)

**Date:** 2026-09-19
**Status:** implemented (phase 1)
**Spec parent:** `docs/superpowers/specs/2026-09-18-player-progression-design.md` § D1

## Context

D1 ("Aide au draft") needs two things the live-draft snapshot does not carry
today: the current **battleground**, and each slot's **picked hero**, so the
front can warn on a lopsided composition and rank picks/bans. The current
pipeline only OCRs the 10 player-name plates (`daemon-python/src/
draft_layout.py` + `draft_capture.py`); `DraftPlayerSlot` has no hero and
`DraftSnapshot` has no map. D1 is therefore blocked at the data layer, not
at the UI layer.

## Finding: heroes and the map are rendered as TEXT (no computer vision needed)

The obvious assumption was that hero picks would need portrait recognition.
They do not. On the HotS draft lobby the nameplate carries, in large caps
**above** the small player name, the hero's display name, and the
battleground name is rendered as text at the top centre.

Measured against the reference capture
`daemon-python/draft-live-test/screenshot.png` (1920×1080) with
`rapidocr-onnxruntime` **and the daemon's own `src/ocr.py`** (both engines,
`use_det=False`, same prepare/pad pipeline as production):

| Region | OCR read |
|---|---|
| top centre | `GARDEN OF TERROR CLASSIC` |
| left hero lines | `E.T.C.`, `JAINA`, `LTMORALES`, `LUISAILE`, `ZAGARA` |
| right hero lines | `MÉPHISTO`, `VALEERA`, `TYCHUS`, `ASMODAN`, `GRISETETE` |
| right small lines | `I.A. Elite` (bot difficulty), `aife` (a real player) |

So the extension is an **OCR crop**, not a vision model: exactly the machinery
`draft_layout.py` already ships (relative boxes, hand-editable appdata crop
config, debug snapshots). Every crop box below was validated end-to-end by
running the real daemon OCR on the reference capture.

## Design

**Daemon (`draft_layout.py`, `ocr.py`, `draft_capture.py`).** Add one
battleground crop and five hero-name crops per team to the same relative-box
layout and appdata config; OCR them with the existing engine; POST them
additively in the snapshot body (`mapName`, per-slot `heroName`). A missing
or unreadable crop degrades to `null` per slot, never fails the capture.

**Shared contract (`packages/shared-types/src/draft.ts`).** `heroName` /
`mapName` are optional on the input schema (older daemons keep working) and
exposed, resolved, on `DraftPlayerSlot` / `DraftSnapshot`.

**API (`draft.service.ts` + pure `lib/draft-resolution.ts`).** Resolution
happens once at ingest against the `maps` / `heroes` tables, then rides the
in-memory snapshot; the SSE read path stays DB-free.

- `mapId`: normalize (case/diacritics/punctuation), exact match, else a single
  canonical map name that is a **prefix** of the OCR key
  (`gardenofterror` ⊂ `gardenofterrorclassic`). Map names are unique as
  prefixes of each other in the current seed, so the fallback is unambiguous;
  more than one prefix match resolves to `null`.
- `heroId`: normalize + exact match against `heroes.name`. No fuzzy matching:
  a wrongly-attributed hero is worse than an unresolved one.

## Known gap: hero names are localized

Hero names come from the **game client language** (the reference capture is a
French client: LUISAILE = Brightwing, GRISETETE = Greymane, ASMODAN =
Azmodan), while `heroes.name` only holds the English names. Normalized exact
matching therefore resolves 7/10 of the reference roster and leaves
localized-only names `null` — honest, never wrong, but D1's composition alert
will be incomplete on a non-English client until aliases exist.

Recommended follow-up (own chantier, additive, no invented data): the parser
already has the localized name in `replay.details.m_playerList[i].m_hero`
(see `parser.py`'s `_hero_attribute_code` docstring). Emit it per player on
ingest and upsert a `hero_localized_names(normalized_name, hero_id)` table,
then let draft resolution consult it before the canonical match. **Not done
here** because it touches the ingestion pipeline and needs its own spec.

## Acceptance criteria (phase 1)

1. The daemon sends `mapName` and one `heroName` per slot, `null` when the
   crop is unreadable; a bad crop never drops the capture.
2. The crop boxes are part of the hand-editable appdata config and their
   built-in defaults are pinned by a test.
3. `GARDENOFTERRORCLASSIC` resolves to `garden-of-terror`;
   `LTMORALES`/`MEPHISTO` resolve to their hero ids; unknown/localized names
   resolve to `null` and keep their raw text.
4. An older daemon that sends no `mapName`/`heroName` produces exactly the
   snapshot it produces today (the fields stay `null`).
5. Multi-account behaviour is unchanged: resolution is language/identity only,
   the extra fields ride the existing per-recipient snapshot.
