"""Static lookup tables used to translate raw replay data into the API's payload shape.

Values here are cross-checked against the community-maintained `hots-parser`
project (https://github.com/ebshimizu/hots-parser, MIT) and its real-replay
test fixtures, since the Blizzard `heroprotocol` package only exposes the
binary encoding, not what game-specific event names/ids mean.
"""

from __future__ import annotations

# Bump whenever parser.py's output shape changes in a way that should
# override previously-ingested matches (see replay-upsert.service.ts).
# 1.1: ARAM ammId (50101) was missing and fell back to "Custom"; hero
# resolution mis-scoped `replay.attributes.events` by the tracker
# PlayerID instead of `m_playerList` position, occasionally attributing
# one player's hero (and only the hero -- talents/stats stayed correct)
# to a different player in the same match.
# 1.2: `replay.attributes.events`' `HeroAttributeId` (the only hero source
# before this version, including the 1.1 fix above) was observed to no
# longer reliably reflect the hero actually played on current replays --
# real matches where *every* player's attribute-resolved hero named someone
# nobody in the match played, with zero overlap with the actual 10 heroes
# (talents/stats/win result staying correct throughout, since those never
# read this attribute). Hero is now resolved primarily from the player's own
# talent picks (`EndOfGameTalentChoices`, tracker-events based -- see
# `_hero_from_talent_prefix` in parser.py), falling back to
# `HeroAttributeId` only when no talent is available to match against.
# 1.3: users kept seeing a wrong hero specifically on ARAM matches even after
# 1.2 (frequently "Arth" / Arthas) -- `HeroAttributeId` is written once at
# lobby time and never updated, and ARAM's shuffle/reroll pick phase is a
# strong suspect: a player who rerolls ends up on a hero different from
# whatever was true when that attribute was captured, in a mode where every
# player goes through that pick flow. Whether or not that's the *only*
# mechanism behind the 1.2 changelog's "no longer reliable" finding, the fix
# holds regardless: the 1.2 talent-prefix resolution only ever tried a
# player's *first* talent tier, so a single tier not matching any known hero
# prefix (see `UNIT_TYPE_HERO_OVERRIDES` below for cases that previously
# didn't) still fell all the way through to that unreliable attribute. Hero
# resolution now (a) tries every talent tier, not just the first, before
# giving up, (b) cross-checks the actual hero unit spawned in-game
# (`SUnitBornEvent`, see `_hero_from_unit_spawn_by_toon` in parser.py) ahead
# of `HeroAttributeId`, and (c) never falls back to `HeroAttributeId` at all
# for ARAM -- a replay that still can't resolve a hero after (a) and (b) now
# fails loudly (`ReplayParseError`) instead of silently recording a wrong
# one.
# 1.4: adds a per-match `timeline` (hero death timestamps from
# `SUnitDiedEvent`, and character-level timestamps from the `LevelUp`
# `SStatGameEvent`) so the web app's Coach tab can compute its
# timeline-dependent pillars (outnumberedFights/talentDelay/staggeredDeaths/
# firstDeath), previously always "unavailable" -- see
# apps/web/app/utils/coachAnalysis.ts and `_extract_deaths`/
# `_extract_level_snapshots` in parser.py. Existing matches have no timeline
# data yet; bumping the version re-syncs them (assuming the replay file is
# still available locally) the same way 1.1-1.3 did for their own fixes.
# 1.5: adds `gameVersion` ("major.minor.revision.baseBuild", from the
# replay header's `m_version` -- always available, no new tracker-event
# dependency) so matches can be filtered/labeled by game patch. Existing
# matches have `gameVersion: null` until resynced.
# 1.6: `_apply_score_event` read `values[0]["m_value"]` for every tracker
# stat, but a player's slot in `SScoreResultEvent.m_instanceList[].m_values[]`
# is a `{m_value, m_time}` *time series*, not a scalar -- confirmed against
# heroprotocol's generated struct definitions. Blizzard seeds it with a
# baseline `m_value: 0` entry at game start and pushes a new entry every time
# the stat changes, so `values[0]` silently read that baseline zero instead
# of the final tally for any stat updated more than once over the match --
# in practice, kills/deaths/assists on any match with real combat (fields
# like heroDamage/healing that only ever get one push happened to read
# correctly, since `[0] == [-1]` when there's just one entry). Now reads
# `values[-1]` (the most recent entry) instead.
# 1.7: `_apply_score_event` derived a player's index into
# `SScoreResultEvent.m_instanceList[].m_values[]` (positional, one slot per
# tracker id) by counting only *non-empty* slots seen so far -- meant to
# skip bot/open lobby seats, but a real player's genuinely untouched stat
# (a healer's 0 SiegeDamage, an ARAM support's 0 ExperienceContribution --
# anything Blizzard never pushed even a baseline entry for) is *also* an
# empty slot, and skipping it without still advancing the position desynced
# every following real player's index by one. Confirmed against a real
# match where this produced siege damage stuck at 0 for all 10 players and
# an identical experience-contribution value duplicated across a whole
# team. Now derives the index from the slot's own position (`enumerate`)
# instead of a count that silently drops out of sync.
# 1.8: adds an optional per-match `spatial` block (hero presence grid, plus
# `x`/`y`/`killers`/`killType` enriched onto each `timeline.deaths` entry)
# built from `SUnitPositionsEvent`, normalized against a per-map world-bounds
# calibration fetched from `GET /spatial/calibrations` (see `app.py`'s
# `_sync_spatial_calibrations` and tasks/epic-10-analyse-spatiale.md). Only
# present when the replay's map has a calibration cached locally; a map with
# none yet has its raw positions instead POSTed to `/spatial/samples` for an
# admin to calibrate, and gets no `spatial` block until it is.
# Deliberately NOT paired with a bump to apps/api/src/constants.ts's
# MIN_PARSER_VERSION this time, breaking the "move together" convention
# below: that constant forces a *mass resync* of every already-synced replay
# on every daemon that checks in, including ones still running an older
# build that can't produce `spatial` data at all -- bumping it here would
# burn their bandwidth/CPU re-uploading replays that would come back
# byte-identical to what's already stored, for zero gain. A daemon that
# *does* update to this build already resyncs its own previously-synced
# replays automatically the moment it starts (see `is_up_to_date` below,
# compared against *this* constant directly) -- no API-side signal needed
# for that case.
#
# Bumping this flags every previously-ingested match as stale so the
# daemon's API-driven resync (see sync_state.py's `invalidate_stale`)
# reparses and re-uploads it. Whenever this changes, also bump
# apps/api/src/constants.ts's MIN_PARSER_VERSION to the same value --
# they're meant to move together (see that constant's docstring) -- except
# for an additive-only change like 1.8 above, where doing so would only
# force wasted resyncs on daemons that can't yet benefit from it.
# 1.9: `SScoreResultEvent` can decode *without raising* even when the
# replay's `m_baseBuild` is newer than every entry in
# `_protocol_versions.KNOWN_PROTOCOL_BUILDS` (`_build_protocol` falls back to
# the newest known decoder for those, on the "wire format essentially never
# changes between consecutive builds" assumption) -- but for some such
# builds that assumption didn't hold for this specific event, and every
# player's stats came back as nothing but each field's baseline `m_value: 0`
# seed. Confirmed against real ingested matches (2026-08) that ended up with
# every one of kills/deaths/assists/damage/healing/experienceContribution at
# 0 for all 10 players despite being real, concluded, 5-27 minute games --
# impossible for a genuine result. `build_payload` now raises
# `ReplayParseError` in that shape (`_score_event_looks_corrupt`) instead of
# silently producing a payload of zeros, so it shows up as a reported parse
# failure instead of corrupted data quietly overwriting a match. Doesn't fix
# the underlying decoder gap (needs an updated `heroprotocol` release with a
# real decoder for the newer build), so a resync of an already-corrupted
# match will fail loudly rather than recover real numbers -- there simply
# isn't a way to get real numbers out of these specific replay files yet.
# 1.10: `UNIT_TYPE_HERO_OVERRIDES` was missing six heroes (Qhira, Cassia,
# Lunara, Lt. Morales, Brightwing, Blaze) whose `SUnitBornEvent`
# `m_unitTypeName` -- and, for the first four, every one of their talent ids
# too -- uses a design-era internal codename with no textual relationship to
# the hero's current display name (e.g. Qhira's is "NexusHunter", Lt.
# Morales's is "Medic"). Found (2026-08) by running this parser against ~70
# real replays: an ARAM game with any of the first four failed outright
# (`ReplayParseError`, since ARAM never falls back to `HeroAttributeId` --
# see 1.3's changelog entry) instead of ingesting; a non-ARAM game with one
# of the six didn't fail, but risked silently mislabeling that player's hero
# via the less-reliable `HeroAttributeId` fallback. Bumping this resyncs
# already-stored matches that hit the latter case (assuming the replay file
# is still available locally), the same way 1.1-1.3 did for hero-resolution
# fixes of their own.
# 1.11: adds two more additive, calibration/`SUnitPositionsEvent`-dependent
# blocks for the Pro Comparison View (side-by-side heatmap comparator):
# `spatial.trajectories[]` (a downsampled, per-hero, *timestamped* path --
# `{atSeconds[], x[], y[]}` -- unlike `spatial.presence[]`'s match-long
# aggregated grid, which has no timestamp left to slice by once built) and
# `timeline.structureEvents[]` (fort/keep/wall destructions, from the same
# `SUnitDiedEvent` stream `_extract_deaths` already reads, filtered by
# structure unit type -- see `_extract_trajectories`/`_extract_structure_events`
# in parser.py). Same non-strict-schema additive rollout as 1.8: both are
# absent/empty for a replay whose map has no calibration yet, and
# `structureEvents`' structure-unit-type-name table is UNCONFIRMED against a
# real replay (same caveat as `_iter_unit_positions` and the hero-side
# `UNIT_TYPE_HERO_OVERRIDES` table before it) -- ships anyway since the rest
# of the payload is unaffected if it under- or over-matches, pending
# real-replay validation. Deliberately NOT paired with a
# `MIN_PARSER_VERSION` bump, same reasoning as 1.8's entry above.
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
PARSER_VERSION = "1.13"

# How many times a single replay is allowed to fail with a parse error (a
# corrupt/incomplete archive -- see parser.ReplayParseError) at the *same*
# PARSER_VERSION before the daemon stops reparsing and reporting it: such a
# failure is a pure function of the file's bytes and this build's parsing
# code, so retrying it forever on every sync cycle only burns CPU and spams
# the API with an identical report each time (see sync_state.py's
# `mark_parse_error` / `parse_retry_budget_exhausted`). A PARSER_VERSION bump
# resets the budget, since a parser fix could legitimately make a
# previously-unparseable file succeed.
MAX_PARSE_RETRY_ATTEMPTS = 5

# Resolution of the sparse presence grid in `spatial.presence[]` (see
# tasks/epic-10-analyse-spatiale.md Livrable 1 for the sizing rationale --
# payload cost grows linearly with resolution, not quadratically, so the
# real ceiling is SUnitPositionsEvent's sampling rate, not payload size).
# Provisional: confirm against a real replay's actual sampling interval
# before treating this as final.
SPATIAL_SCHEMA_VERSION = 1
SPATIAL_GRID_COLS = 128
SPATIAL_GRID_ROWS = 128

# Interpolation discontinuity ("teleport") threshold, expressed as a
# fraction of the map's width/height crossed per second, rather than an
# absolute world-units/sec speed -- sidesteps needing to know the real
# world-unit-to-distance conversion (unconfirmed), since it's relative to
# the calibrated bounds themselves. 0.10 means "crossing the whole map in
# under ~10s is treated as a discontinuity (Blink/Dash/Warp), not legitimate
# movement" -- a starting guess, not a measured value; tune once a real
# replay confirms both SUnitPositionsEvent's sampling rate and typical
# mounted/boosted traversal times (see
# tasks/epic-10-analyse-spatiale.md section 1).
SPATIAL_MAX_INTERPOLATION_SPEED_NORMALIZED = 0.10

# Minimum elapsed match time between two consecutive points kept in
# `spatial.trajectories[]` (per hero, independently -- see
# `_extract_trajectories` in parser.py). Downsampled rather than forwarding
# every raw `SUnitPositionsEvent` sample: macro-strategic rotation/pathing
# analysis doesn't need sub-second resolution, and `_presence_seconds_by_cell`
# already recovers full-density "continuous route" coverage for the grid
# view from the same underlying samples. A 30-minute game x 10 heroes at
# this interval is ~9k points total, well within the payload's existing
# ~100KB budget (see tasks/epic-10-analyse-spatiale.md's presence-grid
# budget calculation, same order of magnitude).
SPATIAL_TRAJECTORY_SAMPLE_INTERVAL_SECONDS = 2

# Target number of raw (x, y) points collected and POSTed to
# /spatial/samples for a map with no calibration yet -- evenly strided
# across the whole match rather than front-loaded (see
# `_collect_calibration_samples` in parser.py).
CALIBRATION_SAMPLE_TARGET = 1000

# Shown in the settings window. Bump alongside `[project].version` in pyproject.toml.
APP_VERSION = "1.0.41"

# HotS talent tiers are always at these character levels, in pick order.
TALENT_TIER_LEVELS = (1, 4, 7, 10, 13, 16, 20)

# `m_ammId` from replay.initData -> our `gameMode` enum (packages/shared-types).
# Confirmed against Heroes.ReplayParser's ReplayInitData.cs (the parser
# behind HeroesProfile.com's ingestion pipeline -- hots-parser's own table
# predates ARAM's launch as a matchmade queue and doesn't have an entry for
# it, which is exactly why it used to fall through to "Custom" here). AI
# lobbies (50021, "Cooperative" -- vs. AI bots) are intentionally excluded:
# `parser.py` rejects any replay containing a Computer player before
# `gameMode` is even resolved, so vs-AI games are never ingested at all.
GAME_MODE_BY_AMM_ID: dict[int, str] = {
    50001: "QuickMatch",
    50051: "UnrankedDraft",
    50061: "HeroLeague",
    50071: "TeamLeague",
    50091: "StormLeague",
    50031: "Brawl",
    50101: "ARAM",
}
# True custom (unranked, non-matchmade) lobbies report no ammId at all
# (`m_ammId` absent/null), which is the only case that should still land
# here.
DEFAULT_GAME_MODE = "Custom"

# Internal map identifier (as reported by the EndOfGameTalentChoices tracker
# event) -> display name. Slugified at parse time to match `maps.id`.
#
# NOTE: Braxis Outpost, Industrial District, Lost Cavern, and Silver City
# (ARAM maps) now exist as `maps` rows -- see packages/db/src/seed.ts's
# MAP_NAMES -- but are NOT yet listed here. Their real Blizzard internal
# map codes are unknown; guessing would silently corrupt replay parsing
# for other maps if wrong. Add their correct internal code -> display name
# entries here once confirmed (e.g. from an actual ARAM replay on one of
# these maps) before ARAM replays for them can ingest.
MAP_DISPLAY_NAMES: dict[str, str] = {
    "ControlPoints": "Sky Temple",
    "TowersOfDoom": "Towers of Doom",
    "HauntedMines": "Haunted Mines",
    "BattlefieldOfEternity": "Battlefield of Eternity",
    "BlackheartsBay": "Blackheart's Bay",
    "CursedHollow": "Cursed Hollow",
    "DragonShire": "Dragon Shire",
    "HauntedWoods": "Garden of Terror",
    "Shrines": "Infernal Shrines",
    "Crypts": "Tomb of the Spider Queen",
    "Volskaya": "Volskaya Foundry",
    "Warhead Junction": "Warhead Junction",
    "BraxisHoldout": "Braxis Holdout",
    "Hanamura": "Hanamura Temple",
    "AlteracPass": "Alterac Pass",
    # Found missing (2026-08) while triaging ~70 real replays with
    # scripts/diagnose_replay_corpus.py -- harmless (the prettified-fallback
    # path already produced the right name, e.g. "Braxis Outpost"), but
    # curated here anyway to cut the log noise for future triage sessions.
    "BraxisOutpost": "Braxis Outpost",
    "SilverCity": "Silver City",
    "LostCavern": "Lost Cavern",
    "IndustrialDistrict": "Industrial District",
}

# `replay.attributes.events` attribute id 4002 ("Hero") value -> display hero
# name. This is a stable, locale-independent short code (e.g. "Auri" for
# Auriel) -- unlike `m_playerList[i].m_hero` in `replay.details`, which holds
# the *localized* hero display name and must not be used as the lookup key
# here (see `_hero_attribute_code` in parser.py). Slugified at parse time to
# match `heroes.id`.
HERO_DISPLAY_NAMES: dict[str, str] = {
    "Abat": "Abathur",
    "Alar": "Alarak",
    "Alex": "Alexstrasza",
    "HANA": "Ana",
    "Andu": "Anduin",
    "Anub": "Anub'arak",
    "Arts": "Artanis",
    "Arth": "Arthas",
    "Auri": "Auriel",
    "Azmo": "Azmodan",
    "Fire": "Blaze",
    "Faer": "Brightwing",
    "Amaz": "Cassia",
    "Chen": "Chen",
    "CCho": "Cho",
    "Chro": "Chromie",
    "DEAT": "Deathwing",
    "DECK": "Deckard",
    "Deha": "Dehaka",
    "Diab": "Diablo",
    "DVA0": "D.Va",
    "L90E": "E.T.C.",
    "Fals": "Falstad",
    "FENX": "Fenix",
    "Gall": "Gall",
    "Garr": "Garrosh",
    "Tink": "Gazlowe",
    "Genj": "Genji",
    "Genn": "Greymane",
    "Guld": "Gul'dan",
    "Hanz": "Hanzo",
    "HOGG": "Hogger",
    "Illi": "Illidan",
    "IMPE": "Imperius",
    "Jain": "Jaina",
    "Crus": "Johanna",
    "Junk": "Junkrat",
    "Kael": "Kael'thas",
    "KelT": "Kel'Thuzad",
    "Kerr": "Kerrigan",
    "Monk": "Kharazim",
    "Leor": "Leoric",
    "LiLi": "Li Li",
    "Wiza": "Li-Ming",
    "Medi": "Lt. Morales",
    "Luci": "Lucio",
    "Drya": "Lunara",
    "Maie": "Maiev",
    "Malf": "Malfurion",
    "MalG": "Mal'Ganis",
    "MALT": "Malthael",
    "Mdvh": "Medivh",
    "HMEI": "Mei",
    "MEPH": "Mephisto",
    "Mura": "Muradin",
    "Murk": "Murky",
    "Witc": "Nazeebo",
    "Nova": "Nova",
    "ORPH": "Orphea",
    "Prob": "Probius",
    "NXHU": "Qhira",
    "Ragn": "Ragnaros",
    "Rayn": "Raynor",
    "Rehg": "Rehgar",
    "Rexx": "Rexxar",
    "Samu": "Samuro",
    "Sgth": "Sgt. Hammer",
    "Barb": "Sonya",
    "Stit": "Stitches",
    "STUK": "Stukov",
    "Sylv": "Sylvanas",
    "Tass": "Tassadar",
    "Butc": "The Butcher",
    "Lost": "The Lost Vikings",
    "Thra": "Thrall",
    "Tra0": "Tracer",
    "Tych": "Tychus",
    "Tyrl": "Tyrael",
    "Tyrd": "Tyrande",
    "Uthe": "Uther",
    "VALE": "Valeera",
    "Demo": "Valla",
    "Vari": "Varian",
    "Necr": "Xul",
    "WHIT": "Whitemane",
    "YREL": "Yrel",
    "Zaga": "Zagara",
    "Zary": "Zarya",
    "Zera": "Zeratul",
    "ZULJ": "Zul'jin",
}

# `replay.tracker.events`' `SUnitBornEvent.m_unitTypeName` (e.g. "HeroLiMing")
# for the actual hero unit spawned under a player's control -- the "Hero"
# prefix is stripped before this table is consulted (see
# `_hero_from_unit_type_name` in parser.py), and most heroes then match a
# `HERO_DISPLAY_NAMES` value directly via `_hero_from_name_prefix`. This
# table covers the ones that don't match *at all*: several early-roster
# heroes shipped with (and kept) their original pre-rename class name as
# their internal unit type -- Sonya as "Barbarian", Johanna as "Crusader",
# Valla as "Demon Hunter", Kharazim as "Monk", Xul as "Necromancer", Nazeebo
# as "Witch Doctor", Li-Ming as "Wizard", E.T.C. as "L90ETC" (matching its
# own `HeroAttributeId` code "L90E") -- and The Lost Vikings control three
# individually-named units (Baleog/Erik/Olaf), never a "LostVikings" unit at
# all. Cross-checked against `Heroes.ReplayParser`'s `Unit.cs` (MIT,
# https://github.com/Heroes-Profile/Heroes.ReplayParser) -- extend this
# table (via `scripts/diagnose_hero_mapping.py` against a real replay) if a
# newer hero turns out to need it too.
UNIT_TYPE_HERO_OVERRIDES: dict[str, str] = {
    "Barbarian": "Sonya",
    "Crusader": "Johanna",
    "DemonHunter": "Valla",
    "Monk": "Kharazim",
    "Necromancer": "Xul",
    "WitchDoctor": "Nazeebo",
    "Wizard": "Li-Ming",
    "L90ETC": "E.T.C.",
    "Baleog": "The Lost Vikings",
    "Erik": "The Lost Vikings",
    "Olaf": "The Lost Vikings",
    "LostVikingsController": "The Lost Vikings",
    # The six overrides below were found (2026-08) by running this parser
    # against ~70 real replays: each of these heroes' `SUnitBornEvent`
    # `m_unitTypeName` (after stripping the "Hero" prefix) -- and, other than
    # Gazlowe/Tinker, every one of their talent ids too -- uses a design-era
    # internal codename with zero textual relationship to the hero's current
    # display name, so neither `_hero_from_name_prefix` path (talent-id
    # prefix, tried first, or this override's own unit-type-name path)
    # matches without an explicit entry -- unlike a name like "DemonHunter"
    # above, which the normal prefix matching would still botch (too generic
    # a word) even if you knew to look for it. Qhira/Cassia/Lunara/Lt.
    # Morales's gap made every ARAM replay containing any of them fail
    # outright (`ReplayParseError`, since ARAM never falls back to the
    # unreliable `HeroAttributeId` -- see this constant's own 1.3 changelog
    # entry): confirmed against real replays with e.g. "Could not determine
    # hero for player ...\" errors that stopped reproducing once these were
    # added. A non-ARAM replay with one of these heroes didn't fail outright
    # (fell back to `HeroAttributeId`) but risked silently mislabeling that
    # player's hero, since that attribute is the least reliable of the three
    # resolution sources. Confirmed against real replay fixtures under
    # `daemon-python/tests/fixtures/` -- see PARSER_VERSION's changelog.
    "NexusHunter": "Qhira",
    "Amazon": "Cassia",
    "Dryad": "Lunara",
    "Medic": "Lt. Morales",
    "FaerieDragon": "Brightwing",
    "Firebat": "Blaze",
    # Talent-id prefix already resolves Gazlowe fine (his talent ids mostly
    # use "Gazlowe", not his unit type name) -- this only fixes the
    # *unit-spawn* path specifically, which `_hero_unit_tags_by_toon` (death
    # timeline attribution) also depends on independently of talent ids.
    "Tinker": "Gazlowe",
}

# NNet.Replay.Tracker.SScoreResultEvent m_instanceList[i].m_name values whose
# desired API field name doesn't already match `stat_field_name`'s generic
# `name[0].lower() + name[1:]` conversion (only "SoloKill" -> "kills" as of
# this writing). Every *other* stat name the tracker reports (MinionKills,
# Level, MercCampCaptures, TeamTakedowns, ...) is still forwarded, generically
# camelCased, in each player's payload -- see `_apply_score_event` in
# parser.py. That's what lets the API start reading a stat it didn't use
# before without needing a daemon rebuild: the daemon is already sending it,
# the field was just being dropped (zod strips unrecognized keys) until the
# API's schema/storage catches up. A rebuild is only needed when
# `heroprotocol` itself can't decode a replay build, which this can't fix.
STAT_FIELD_RENAMES: dict[str, str] = {
    "SoloKill": "kills",
}

REQUIRED_SCORE_FIELDS = (
    "kills",
    "deaths",
    "assists",
    "heroDamage",
    "siegeDamage",
    "healing",
    "selfHealing",
    "damageTaken",
    "experienceContribution",
)


def stat_field_name(raw_name: str) -> str:
    """Tracker stat name (e.g. "HeroDamage") -> API payload field name (e.g.
    "heroDamage"), applying `STAT_FIELD_RENAMES` first for the few names that
    don't already fit the generic camelCase conversion."""
    renamed = STAT_FIELD_RENAMES.get(raw_name)
    if renamed is not None:
        return renamed
    return raw_name[:1].lower() + raw_name[1:] if raw_name else raw_name