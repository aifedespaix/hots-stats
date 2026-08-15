"""Parses a `.StormReplay` file into a dict matching `replayPayloadSchema`.

Built on top of Blizzard's official `heroprotocol` package, which only
decodes the *binary encoding* of a replay — it has no notion of what a
"kill" or a "game mode" is. The event names, stat field names, map/game-mode
ids and hero attribute codes used below are cross-checked against the
community-maintained `hots-parser` project (MIT,
https://github.com/ebshimizu/hots-parser) and its real-replay test
fixtures, since they aren't documented anywhere in `heroprotocol` itself.
Hero resolution specifically (`_attribute_scope_by_player_list_index`)
instead follows `Heroes.ReplayParser` (MIT,
https://github.com/Heroes-Profile/Heroes.ReplayParser, the parser behind
HeroesProfile.com) -- `hots-parser`'s approach of keying
`replay.attributes.events` by the tracker "PlayerID" doesn't reliably match
that stream's own scope numbering (see that function's docstring).
"""

from __future__ import annotations

import datetime as dt
import importlib
import logging
import re
import sys
import types
from pathlib import Path
from typing import Any, Iterator

import mpyq

# `heroprotocol`'s `versions/__init__.py` still does `import imp` at module
# scope -- solely to reach `imp.find_module`/`imp.load_module` inside its
# `list_all()`/`latest()`/`build()` helpers, none of which we call (see
# `_protocol_module` below, which imports a named submodule via `importlib`
# instead). `imp` was removed from the stdlib in Python 3.12 (PEP 594), so on
# 3.12+ that bare `import imp` blows up as soon as anything imports
# `heroprotocol.versions` (or a submodule of it) -- even though nothing we do
# ever calls into the code paths that need it. Stub it in `sys.modules` so
# that import succeeds; the stub is never actually used.
if "imp" not in sys.modules:
    try:
        import imp  # noqa: F401
    except ModuleNotFoundError:
        sys.modules["imp"] = types.ModuleType("imp")

from . import constants
from ._protocol_versions import KNOWN_PROTOCOL_BUILDS
from .hasher import hash_replay_file

logger = logging.getLogger(__name__)

_GAMELOOPS_PER_SECOND = 16
# "Name#12345" — display names can contain most unicode letters/digits.
_BATTLETAG_RE = re.compile(r"[^\x00-\x1f\x7f#]{2,24}#\d{4,10}")


class ReplayParseError(Exception):
    """Raised when a replay can't be turned into a valid ingestion payload."""


class ReplaySkipped(ReplayParseError):
    """Raised for a replay that was read fine but is *intentionally* excluded
    from ingestion -- as opposed to `ReplayParseError` proper, which means
    something is wrong with the file or our ability to read it. A subclass
    (not a sibling exception) so any existing `except ReplayParseError`
    handler -- `parse_replay`'s own re-raise below, and any third-party
    caller that hasn't been updated -- still catches it unchanged; callers
    that care about the distinction (`ingestion.ingest_file`) match this
    subclass first.

    `reason` is a short stable code (not shown to the player) -- currently
    `"ai_player"` or `"incomplete_game"` -- so `ingestion.py`/`sync_state.py`/
    `gui.py` can count and label skips by category without parsing `str(err)`.
    """

    def __init__(self, message: str, *, reason: str) -> None:
        super().__init__(message)
        self.reason = reason


def _s(value: bytes | str) -> str:
    """heroprotocol decodes all string-ish fields as raw bytes."""
    return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else value


def _slugify(name: str) -> str:
    """Matches the slug convention documented in packages/db schema comments
    (e.g. "cursed-hollow", "li-ming"): lowercase, words joined by hyphens.
    """
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _prettify_pascal_case(name: str) -> str:
    """Best-effort "IndustrialDistrict" -> "Industrial District".

    Used as a fallback when a map's internal tracker name isn't a key in
    `constants.MAP_DISPLAY_NAMES` yet (a new battleground shipped before the
    lookup table was updated). Without this, `_slugify` would run directly
    on the unspaced PascalCase name and produce a malformed, wordless slug
    like "industrialdistrict" instead of "industrial-district".
    """
    return re.sub(r"(?<!^)(?=[A-Z])", " ", name).strip()


def _toon_handle(toon: dict) -> str:
    """Formats a player's Battle.net toon handle the same way the game itself
    does internally — this exact string also shows up as-is in the
    PlayerInit tracker event, which is how we correlate `m_playerList`
    entries with tracker/score events (see hots-parser's `getHeader`/
    `processReplay`, which relies on the same identity).
    """
    return f"{toon['m_region']}-{_s(toon['m_programId'])}-{toon['m_realm']}-{toon['m_id']}"


def _windows_filetime_to_iso8601(filetime: int) -> str:
    epoch_ms = filetime / 10_000 - 11_644_473_600_000
    return (
        dt.datetime.fromtimestamp(epoch_ms / 1000, tz=dt.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _game_version(header: dict) -> str:
    """"major.minor.revision.baseBuild" (e.g. "2.55.15.96477") -- the same
    4-part convention this project already uses to identify a build
    everywhere else (the `heroprotocol` git tag pinned in pyproject.toml,
    `KNOWN_PROTOCOL_BUILDS`), keyed by `m_baseBuild` rather than the
    sibling `m_build` for that same consistency: `m_baseBuild` is what
    `_build_protocol` actually selects a decoder by, so it's the one that
    unambiguously identifies "which wire format/patch this replay is on",
    whereas `m_build` can bump on a data-only hotfix that doesn't change it.
    """
    version = header["m_version"]
    return f"{version['m_major']}.{version['m_minor']}.{version['m_revision']}.{version['m_baseBuild']}"


def _extract_battletags(archive: mpyq.MPQArchive, player_list: list[dict]) -> dict[str, str]:
    """Maps a player's toon handle -> full "Name#1234" battletag.

    `replay.details` only carries the display name (no discriminator); the
    discriminator only shows up in the raw lobby buffer. We scan that buffer
    for "Name#1234" patterns and align them in order against player entries
    whose display name matches, mirroring `hots-parser`'s `getBattletags`.
    """
    try:
        raw = archive.read_file("replay.server.battlelobby")
    except KeyError:
        raw = b""

    text = (raw or b"").decode("utf-8", errors="ignore")
    candidates_by_name: dict[str, list[str]] = {}
    for candidate in _BATTLETAG_RE.findall(text):
        name = candidate.split("#", 1)[0]
        candidates_by_name.setdefault(name, []).append(candidate)

    result: dict[str, str] = {}
    for player in player_list:
        name = _s(player["m_name"])
        queue = candidates_by_name.get(name)
        if queue:
            result[_toon_handle(player["m_toon"])] = queue.pop(0)
    return result


def _protocol_module(build_number: int):
    """Imports `heroprotocol.versions.protocolNNNNN` by name.

    Deliberately not `heroprotocol.versions.build()`/`.latest()`: those pick
    the module by `os.listdir`-ing the directory next to their own
    `__file__`, which breaks under Nuitka's `--onefile` packaging (the
    compiled module's `__file__` points into the app's onefile temp
    extraction dir, but the actual protocol `.py` sources live compiled
    inside the executable, not extracted on disk at that path -- see
    `_protocol_versions.py`). A plain `importlib.import_module` goes through
    Nuitka's compiled-module registry instead, which resolves correctly.
    """
    return importlib.import_module(f"heroprotocol.versions.protocol{build_number:05d}")


def _build_protocol(header: dict):
    base_build = header["m_version"]["m_baseBuild"]
    try:
        return _protocol_module(base_build)
    except Exception as err:
        newest_known = max(KNOWN_PROTOCOL_BUILDS)
        if base_build > newest_known:
            # Blizzard shipped a patch before `heroprotocol` published a decoder
            # for it -- that upstream lag is routinely days to weeks. The wire
            # format essentially never changes between consecutive builds, so
            # best-effort decode with the newest build we do have rather than
            # refusing every replay until the next `heroprotocol` bump.
            logger.warning(
                "No `heroprotocol` decoder for replay base build %d yet; "
                "falling back to newest known build %d.",
                base_build,
                newest_known,
            )
            return _protocol_module(newest_known)
        raise ReplayParseError(
            f"Unsupported replay base build {base_build}; upgrade the `heroprotocol` package."
        ) from err


_HERO_ATTRIBUTE_ID = 4002
_PLAYER_TYPE_ATTRIBUTE_ID = 500


def _hero_attribute_code(attributes_events: dict, scope: int) -> str | None:
    """Resolves a player's hero via `replay.attributes.events` (attribute id
    4002), scoped by `scope` -- an attribute-events "scope" id, *not* a
    tracker player id (see `_attribute_scope_by_player_list_index`, which
    resolves the right one for a given `m_playerList` position).

    Deliberately *not* `m_playerList[i].m_hero` in `replay.details`: that
    field holds the *localized* hero display name (e.g. "Fénix", "Aile de
    mort" on a French client, "Lúcio" with its accent on some locales) rather
    than the stable short code `HERO_DISPLAY_NAMES` is keyed by, so using it
    directly makes every non-English replay fail hero resolution.

    As of `PARSER_VERSION` 1.2, only used as a last-resort *fallback* -- see
    `_hero_from_any_talent`/`_hero_from_unit_spawn_by_toon`, tried first, and
    `PARSER_VERSION`'s changelog for why `HeroAttributeId` itself stopped
    being trustworthy. As of 1.3, not used *at all* for ARAM, where it's
    been narrowed down to specifically that mode's shuffle/reroll pick
    leaving this attribute stale.
    """
    entries = attributes_events.get("scopes", {}).get(scope, {}).get(_HERO_ATTRIBUTE_ID)
    if not entries:
        return None
    return _s(entries[0]["value"])


def _normalize_hero_name(name: str) -> str:
    """Strips everything but letters/digits, e.g. "Kael'thas" -> "Kaelthas",
    "E.T.C." -> "ETC" -- talent ids are the hero's name immediately followed
    by the ability name, both PascalCase with no separator (see
    `_hero_from_name_prefix`)."""
    return re.sub(r"[^A-Za-z0-9]", "", name)


# A couple of `HERO_DISPLAY_NAMES` values carry an English article Blizzard's
# own internal name drops entirely -- The Butcher's talent ids and spawned
# unit type name (`HeroButcher`, cross-checked against `Heroes.ReplayParser`'s
# `Unit.cs`, MIT) start with "Butcher", not "TheButcher". Added as an extra
# candidate below, alongside (not instead of) the primary `HERO_DISPLAY_NAMES`
# entry, so either convention matches.
_EXTRA_NAME_CANDIDATES: dict[str, str] = {
    "Butcher": "The Butcher",
}


def _name_candidates() -> Iterator[tuple[str, str]]:
    for display in constants.HERO_DISPLAY_NAMES.values():
        yield _normalize_hero_name(display), display
    yield from _EXTRA_NAME_CANDIDATES.items()


# Longest-normalized-name first, so e.g. a hero whose name is a prefix of
# another's never wins by accident -- checked empirically against the
# current roster (no candidate's normalized form is a prefix of another's),
# not something this sort order can silently break if a future hero *does*
# introduce one, since the longer/more specific name is always tried first
# either way. Compared case-insensitively (`.lower()`): talent ids and
# `SUnitBornEvent` unit type names don't always agree on internal
# capitalization for the same hero -- e.g. D.Va's unit type name is
# "HeroDva" while `HERO_DISPLAY_NAMES`' "D.Va" normalizes to "DVa" -- so an
# exact-case comparison would silently fail to match one of the two sources.
_HERO_NAME_CANDIDATES: tuple[tuple[str, str], ...] = tuple(
    sorted(
        ((normalized.lower(), display) for normalized, display in _name_candidates()),
        key=lambda pair: len(pair[0]),
        reverse=True,
    )
)


def _hero_from_name_prefix(candidate: str) -> str | None:
    """Matches a PascalCase, no-separator name -- a talent id's leading
    hero-name (e.g. "DiabloSoulShield" -> "Diablo"), or a `SUnitBornEvent`
    unit type name with its "Hero" prefix already stripped -- against every
    known hero's normalized display name. `None` if no candidate matches (an
    unrecognized/very new hero not yet in `HERO_DISPLAY_NAMES`, or a name
    that doesn't fit the convention)."""
    lowered = candidate.lower()
    for normalized, display in _HERO_NAME_CANDIDATES:
        if lowered.startswith(normalized):
            return display
    return None


def _hero_from_talent_prefix(talent_id: str) -> str | None:
    """Matches a talent id's leading hero-name against every known hero's
    normalized display name -- see `_hero_from_name_prefix`."""
    return _hero_from_name_prefix(talent_id)


def _talent_ids_by_toon(tracker_events: list[dict], tracker_id_to_toon: dict[int, str]) -> dict[str, list[str]]:
    """Every tier's talent id per toon handle, in pick order, for
    `_hero_from_any_talent`. Reads `EndOfGameTalentChoices` (tracker events,
    scoped by tracker player id via `tracker_id_to_toon`), the same event
    `build_payload` reads talents from below -- a separate, independent pass
    here only because hero resolution now needs these *before* `players` is
    built."""
    talents_by_toon: dict[str, list[str]] = {}
    for event in tracker_events:
        if event.get("_event") != "NNet.Replay.Tracker.SStatGameEvent":
            continue
        if _s(event["m_eventName"]) != "EndOfGameTalentChoices":
            continue
        tracker_id = event["m_intData"][0]["m_value"]
        toon_handle = tracker_id_to_toon.get(tracker_id)
        if toon_handle is None or toon_handle in talents_by_toon:
            continue
        talents_by_toon[toon_handle] = [
            _s(entry["m_value"]) for entry in event["m_stringData"] if _s(entry["m_key"]).startswith("Tier")
        ]
    return talents_by_toon


def _hero_from_any_talent(talent_ids: list[str]) -> str | None:
    """Tries every one of a player's talent ids (see `_talent_ids_by_toon`)
    against `_hero_from_name_prefix` in pick order, returning the first
    match. More resilient than trusting a single tier alone (the previous
    behavior, which only ever looked at the first pick): a fringe
    hero-name-normalization gap or decode quirk on one tier's talent id no
    longer sinks hero resolution for that player as long as *any other*
    tier's pick matches."""
    for talent_id in talent_ids:
        hero_name = _hero_from_name_prefix(talent_id)
        if hero_name is not None:
            return hero_name
    return None


_HERO_UNIT_TYPE_PREFIX = "Hero"
_UNIT_BORN_EVENT = "NNet.Replay.Tracker.SUnitBornEvent"
_UNIT_DIED_EVENT = "NNet.Replay.Tracker.SUnitDiedEvent"


def _hero_from_unit_type_name(unit_type_name: str) -> str | None:
    """Resolves a hero from `SUnitBornEvent.m_unitTypeName` (e.g.
    "HeroLiMing"): strips the "Hero" prefix every playable hero's spawned
    unit carries, checks `constants.UNIT_TYPE_HERO_OVERRIDES` first (heroes
    whose internal unit name has no textual relationship to their current
    display name at all), then falls through to the same prefix matcher
    talent ids use."""
    if not unit_type_name.startswith(_HERO_UNIT_TYPE_PREFIX):
        return None
    stripped = unit_type_name[len(_HERO_UNIT_TYPE_PREFIX) :]
    override = constants.UNIT_TYPE_HERO_OVERRIDES.get(stripped)
    if override is not None:
        return override
    return _hero_from_name_prefix(stripped)


def _hero_from_unit_spawn_by_toon(tracker_events: list[dict], tracker_id_to_toon: dict[int, str]) -> dict[str, str]:
    """Ground-truth hero per toon handle, from the actual in-game hero unit
    that spawned under each player's control (`SUnitBornEvent`,
    `m_unitTypeName` + `m_controlPlayerId` -- confirmed against
    `heroprotocol`'s own struct layout and against `hots-parser`'s
    `playerIDMap[event.m_controlPlayerId]` lookup, which keys it by the
    *same* tracker player id space as `PlayerInit`/`EndOfGameTalentChoices`,
    i.e. `tracker_id_to_toon` applies unchanged, no offset needed).

    Used ahead of `HeroAttributeId` in the hero-resolution order (see
    `build_payload`): unlike that attribute -- written once at lobby time
    and never updated -- this reflects whichever hero the player actually
    loaded into the match with. That makes it immune to ARAM's shuffle-pick
    reroll leaving `HeroAttributeId` pointing at the player's earlier,
    discarded random assignment (very commonly surfacing as "Arthas").
    """
    hero_by_toon: dict[str, str] = {}
    for event in tracker_events:
        if event.get("_event") != _UNIT_BORN_EVENT:
            continue
        toon_handle = tracker_id_to_toon.get(event.get("m_controlPlayerId"))
        if toon_handle is None or toon_handle in hero_by_toon:
            continue
        hero_name = _hero_from_unit_type_name(_s(event["m_unitTypeName"]))
        if hero_name is not None:
            hero_by_toon[toon_handle] = hero_name
    return hero_by_toon


def _hero_unit_tags_by_toon(
    tracker_events: list[dict], tracker_id_to_toon: dict[int, str]
) -> dict[tuple[int, int], str]:
    """Every hero unit's `(m_unitTagIndex, m_unitTagRecycle)` tag -> owning
    toon handle, from every `SUnitBornEvent` for a hero-type unit -- *not*
    deduped to the first occurrence per toon like `_hero_from_unit_spawn_by_toon`
    above, since The Lost Vikings control three independently-tagged hero
    units at once (Baleog/Erik/Olaf), each needing its own tag entry. A
    respawned hero keeps its original tag (HotS fires `SUnitRevivedEvent` on
    respawn, not a fresh `SUnitBornEvent` -- confirmed against the actual
    `heroprotocol` protocol typeinfo for the pinned build, which has no other
    unit-level event that would reallocate a hero's tag mid-game), so one
    entry per hero unit for the whole match is enough.

    Used by `_extract_deaths` to identify which player's hero died on a
    `SUnitDiedEvent`, which only carries the dying unit's tag -- never a
    player id directly.
    """
    tags: dict[tuple[int, int], str] = {}
    for event in tracker_events:
        if event.get("_event") != _UNIT_BORN_EVENT:
            continue
        if _hero_from_unit_type_name(_s(event["m_unitTypeName"])) is None:
            continue
        toon_handle = tracker_id_to_toon.get(event.get("m_controlPlayerId"))
        if toon_handle is None:
            continue
        tags[(event["m_unitTagIndex"], event["m_unitTagRecycle"])] = toon_handle
    return tags


def _extract_deaths(
    tracker_events: list[dict],
    hero_unit_tags: dict[tuple[int, int], str],
    players: dict[str, dict[str, Any]],
    gates_open_loop: int,
) -> list[dict[str, Any]]:
    """Every hero death (`SUnitDiedEvent`), as `{battletag, team, atSeconds}`
    -- the timeline data the Coach tab's `outnumberedFights`/`staggeredDeaths`/
    `firstDeath` pillars need (see apps/web/app/types/coach.ts's
    `MatchTimelineDeath`). Non-hero unit deaths (minions, mercs, structures --
    these fire the same event) are silently skipped: their tag never appears
    in `hero_unit_tags`. `atSeconds` is measured from `gates_open_loop`, the
    same reference point `durationSeconds` below uses, so it lines up with
    the match clock the UI already shows.
    """
    deaths: list[dict[str, Any]] = []
    for event in tracker_events:
        if event.get("_event") != _UNIT_DIED_EVENT:
            continue
        toon_handle = hero_unit_tags.get((event["m_unitTagIndex"], event["m_unitTagRecycle"]))
        player = players.get(toon_handle) if toon_handle else None
        if player is None:
            continue
        deaths.append(
            {
                "battletag": player["battletag"],
                "team": player["team"],
                "atSeconds": max(0, round((event["_gameloop"] - gates_open_loop) / _GAMELOOPS_PER_SECOND)),
            }
        )
    return deaths


def _extract_level_snapshots(
    tracker_events: list[dict],
    tracker_id_to_toon: dict[int, str],
    players: dict[str, dict[str, Any]],
    gates_open_loop: int,
) -> list[dict[str, Any]]:
    """Every level-up, as `{battletag, atSeconds, level}` -- the Coach tab's
    `talentDelay` pillar needs this to compare each side's talent tier over
    time (see `MatchTimelineLevelSnapshot`).

    Sourced from the `SStatGameEvent` named `"LevelUp"` (the same
    `m_eventName`-dispatched mechanism as `GatesOpen`/`EndOfGameTalentChoices`
    above): `m_intData[0]` is the tracker PlayerID, `m_intData[1]` the new
    level. HotS levels are shared team-wide, so a single team level-up fires
    one of these per player on that team (5 events, not 1) -- cross-checked
    against the `ebshimizu/stats-of-the-storm` replay format reference, the
    same style of community documentation `hots-parser` draws from elsewhere
    in this file.
    """
    snapshots: list[dict[str, Any]] = []
    for event in tracker_events:
        if event.get("_event") != "NNet.Replay.Tracker.SStatGameEvent":
            continue
        if _s(event["m_eventName"]) != "LevelUp":
            continue
        tracker_id = event["m_intData"][0]["m_value"]
        level = event["m_intData"][1]["m_value"]
        toon_handle = tracker_id_to_toon.get(tracker_id)
        player = players.get(toon_handle) if toon_handle else None
        if player is None:
            continue
        snapshots.append(
            {
                "battletag": player["battletag"],
                "atSeconds": max(0, round((event["_gameloop"] - gates_open_loop) / _GAMELOOPS_PER_SECOND)),
                "level": level,
            }
        )
    return snapshots


def _attribute_scope_by_player_list_index(attributes_events: dict, player_count: int) -> dict[int, int]:
    """Maps each `m_playerList` position (1-based) to its matching
    `replay.attributes.events` scope id.

    `replay.attributes.events` scopes are numbered 1..N in *lobby slot*
    order -- including any slot left empty ("open") in an under-filled
    lobby -- which is SC2-lobby-heritage numbering, a genuinely different
    address space from the tracker "PlayerID" that `PlayerInit` tracker
    events use (confirmed against Heroes.ReplayParser's `ApplyAttributes`,
    the parser behind HeroesProfile.com's ingestion pipeline: its own
    comment there is explicit that this "PlayerID... does not seem to
    match any existing player array" other than `m_playerList`, adjusted
    for open slots). Scope N only equals `m_playerList` position N once
    "open" slots are skipped, tracked here via `PlayerTypeAttribute` (id
    500, one of "comp"/"humn"/"open" per scope).

    Using the tracker PlayerID as a stand-in for this (the previous
    approach, matching `hots-parser`'s own JS implementation) happens to
    coincide for *most* games, since both numberings are usually assigned
    in the same slot order -- but not reliably, which silently attributed
    one player's hero to a different player in the same match while
    leaving every other tracker-event-sourced field (talents, stats, win
    result) correct, since those stay entirely within the tracker
    numbering and never cross into this one.
    """
    scopes = attributes_events.get("scopes", {})
    player_types: dict[int, str] = {}
    for scope, attrs in scopes.items():
        entries = attrs.get(_PLAYER_TYPE_ATTRIBUTE_ID)
        if entries:
            player_types[scope] = _s(entries[0]["value"]).strip("\x00").lower()

    if not player_types:
        # No `PlayerTypeAttribute` data at all (very old replay build) --
        # assume a fully-filled lobby, where scope N already equals
        # `m_playerList` position N with no "open" slots to skip.
        return {i: i for i in range(1, player_count + 1)}

    open_slots = 0
    index_to_scope: dict[int, int] = {}
    for scope in sorted(player_types):
        if player_types[scope] == "open":
            open_slots += 1
            continue
        index_to_scope[scope - open_slots] = scope
    return index_to_scope


def _has_computer_player_attribute(attributes_events: dict) -> bool:
    """True if any lobby slot's `PlayerTypeAttribute` (id 500, see
    `_attribute_scope_by_player_list_index`) is `"comp"` -- a second,
    independent AI-detection signal from `build_payload`'s tracker-based
    `PlayerInit` "Computer" check.

    Needed because that tracker-based check only ever sees bots that fire
    their own `PlayerInit` tracker event -- true for a matchmade/custom
    "vs AI" lobby, but not for every bot-populated game: replays from
    "Bac à sable" (Sandbox/practice) have been observed where the bot
    slot's display name comes through as a generic placeholder ("Joueur 2",
    "Joueur\xa06") and hero/battletag resolution fails for it downstream
    (`build_payload`'s "Could not determine hero"/"Could not resolve
    battletag" `ReplayParseError`s below) without a `PlayerInit` "Computer"
    event ever having been seen for it. `PlayerTypeAttribute` -- read from
    `replay.attributes.events`, a completely different stream from the
    tracker events the other check reads -- still flags these slots
    correctly, since it's set for every lobby slot regardless of whether
    that slot ever produces its own tracker events.
    """
    for attrs in attributes_events.get("scopes", {}).values():
        entries = attrs.get(_PLAYER_TYPE_ATTRIBUTE_ID)
        if entries and _s(entries[0]["value"]).strip("\x00").lower() == "comp":
            return True
    return False


def _apply_score_event(tracker_events: list[dict], tracker_id_to_toon: dict[int, str], players: dict) -> None:
    for event in tracker_events:
        if event.get("_event") != "NNet.Replay.Tracker.SScoreResultEvent":
            continue
        for instance in event["m_instanceList"]:
            # Every stat the tracker reports is forwarded (generically
            # camelCased), not just the ones the API currently reads -- see
            # constants.stat_field_name's docstring.
            field = constants.stat_field_name(_s(instance["m_name"]))
            real_index = 0
            for values in instance["m_values"]:
                if not values:
                    continue
                real_index += 1
                toon_handle = tracker_id_to_toon.get(real_index)
                player = players.get(toon_handle) if toon_handle else None
                if player is not None:
                    player["stats"][field] = int(values[0]["m_value"])
        break


def _read_archive_file(archive: mpyq.MPQArchive, filename: str) -> bytes:
    """Reads a required stream from the replay's MPQ archive.

    `mpyq.MPQArchive.read_file` returns `None` -- rather than raising --
    when `filename` isn't in the archive's hash table, or resolves to a
    zero-length block entry (see its source: a missing hash entry, an
    `archived_size` of 0, and a block entry without `MPQ_FILE_EXISTS` set
    are all `None` returns, no exception). Feeding that straight into
    `heroprotocol`'s decoders blows up several stack frames deep with an
    opaque `TypeError: cannot convert 'NoneType' object to bytes` (see
    `heroprotocol.decoders.BitPackedBuffer.__init__`), which names neither
    the missing stream nor the actual problem. Fail fast here instead, with
    a `ReplayParseError` that says which stream the archive is missing --
    this is a genuinely incomplete/corrupt replay file, not something a
    decoder fix can address.
    """
    contents = archive.read_file(filename)
    if contents is None:
        raise ReplayParseError(f"Replay archive is missing '{filename}' (corrupt or incomplete replay file).")
    return contents


def parse_replay(path: Path) -> dict[str, Any]:
    """Parses a `.StormReplay` file into a dict matching `replayPayloadSchema`.

    Raises `ReplayParseError` for anything we can't confidently extract
    (incomplete games, unrecognized hero/map codes) -- or its subclass
    `ReplaySkipped` for a replay that parses fine but is intentionally
    excluded (currently: it includes an AI player). `ingestion.ingest_file`
    treats the two differently: the former is a failure worth surfacing in
    the Debug report, the latter isn't.
    """
    try:
        archive = mpyq.MPQArchive(str(path))

        header_contents = archive.header["user_data_header"]["content"]
        # Header format is stable across protocol versions, so any build's
        # decoder works here; we just need one that's actually importable
        # (see `_protocol_module`), hence the newest known build rather than
        # `heroprotocol.versions.latest()`.
        header = _protocol_module(max(KNOWN_PROTOCOL_BUILDS)).decode_replay_header(header_contents)
        protocol = _build_protocol(header)

        details = protocol.decode_replay_details(_read_archive_file(archive, "replay.details"))
        initdata = protocol.decode_replay_initdata(_read_archive_file(archive, "replay.initData"))
        tracker_events = list(
            protocol.decode_replay_tracker_events(_read_archive_file(archive, "replay.tracker.events"))
        )
        attributes_events = protocol.decode_replay_attributes_events(
            _read_archive_file(archive, "replay.attributes.events")
        )
        battletags = _extract_battletags(archive, details["m_playerList"])

        return build_payload(
            header=header,
            details=details,
            initdata=initdata,
            tracker_events=tracker_events,
            attributes_events=attributes_events,
            battletags=battletags,
            replay_hash=hash_replay_file(path),
        )
    except ReplayParseError:
        raise
    except Exception as err:
        # Covers both malformed/non-replay files (mpyq raising ValueError on
        # a bad MQP header, etc) and unexpected replay structures (KeyError,
        # IndexError...) — either way, one bad file shouldn't crash the daemon.
        raise ReplayParseError(f"Failed to parse replay ({type(err).__name__}: {err})") from err


def build_payload(
    *,
    header: dict,
    details: dict,
    initdata: dict,
    tracker_events: list[dict],
    attributes_events: dict,
    battletags: dict[str, str],
    replay_hash: str,
) -> dict[str, Any]:
    """Pure transformation from decoded replay structures to the API payload.

    Split out from `parse_replay` so the event-correlation logic (the part
    most likely to need adjusting against real replays) can be unit tested
    with synthetic data, independent of `mpyq`/`heroprotocol` decoding.
    """
    player_list = details["m_playerList"]

    # Checked up front, before any per-player work below: cheaper to bail
    # here than to reach hero/battletag resolution for a bot slot and fail
    # there instead (see `_has_computer_player_attribute`'s docstring for
    # why this needs to be a second signal, alongside the tracker-based
    # "Computer" `PlayerInit` check further down).
    if _has_computer_player_attribute(attributes_events):
        raise ReplaySkipped(
            "Replay includes a computer (AI) player; only real-player matches are ingested.",
            reason="ai_player",
        )

    # Resolved up front (not just at payload-assembly time below): hero
    # resolution itself now needs to know whether this is ARAM, where
    # `HeroAttributeId` is confirmed unreliable (see the hero-resolution
    # loop below and `PARSER_VERSION`'s 1.3 changelog entry).
    game_options = initdata.get("m_syncLobbyState", {}).get("m_gameDescription", {}).get("m_gameOptions", {})
    amm_id = game_options.get("m_ammId")
    game_mode = constants.GAME_MODE_BY_AMM_ID.get(amm_id, constants.DEFAULT_GAME_MODE)

    # Also used below for talents/stats (`EndOfGameTalentChoices` /
    # `SScoreResultEvent`) and, as of `PARSER_VERSION` 1.2, for hero
    # resolution itself via `_talent_ids_by_toon`/`_hero_from_unit_spawn_by_toon`
    # -- see those functions and `_hero_from_any_talent`.
    tracker_id_to_toon: dict[int, str] = {}
    for event in tracker_events:
        if event.get("_event") != "NNet.Replay.Tracker.SStatGameEvent":
            continue
        if _s(event["m_eventName"]) != "PlayerInit":
            continue
        if _s(event["m_stringData"][0]["m_value"]) == "Computer":
            raise ReplaySkipped(
                "Replay includes a computer (AI) player; only real-player matches are ingested.",
                reason="ai_player",
            )
        if len(event["m_stringData"]) < 2:
            # An empty ("Open") lobby slot in an under-filled custom/practice
            # lobby fires its own `PlayerInit` tracker event too, but with
            # only a `PlayerType` entry and no `ToonHandle` -- there's no
            # player to correlate this to, so skip it instead of indexing
            # into a `m_stringData` that doesn't have a second entry.
            continue
        tracker_id = event["m_intData"][0]["m_value"]
        toon_handle = _s(event["m_stringData"][1]["m_value"])
        tracker_id_to_toon[tracker_id] = toon_handle

    talent_ids_by_toon = _talent_ids_by_toon(tracker_events, tracker_id_to_toon)
    unit_spawn_hero_by_toon = _hero_from_unit_spawn_by_toon(tracker_events, tracker_id_to_toon)
    scope_by_player_list_index = _attribute_scope_by_player_list_index(attributes_events, len(player_list))
    is_aram = game_mode == "ARAM"

    players: dict[str, dict[str, Any]] = {}
    for index, player in enumerate(player_list, start=1):
        toon_handle = _toon_handle(player["m_toon"])

        # 1) Primary source: the hero-name prefix of any of this player's own
        # talent picks (`EndOfGameTalentChoices`, tracker-events based -- the
        # same mechanism that already resolves talents/stats/win result
        # further below, and unaffected by the bug described next). Trying
        # every tier (not just the first) makes this resilient to a single
        # tier's talent id not matching any known hero prefix.
        hero_name = _hero_from_any_talent(talent_ids_by_toon.get(toon_handle, []))

        # 2) Ground-truth cross-check: the hero unit that actually spawned
        # for this player (`SUnitBornEvent`) -- tried before the unreliable
        # `HeroAttributeId` fallback below. This matters most for ARAM: its
        # shuffle/reroll pick phase can leave `HeroAttributeId` pointing at
        # the player's *first*, discarded random assignment (very commonly
        # "Arthas"), while the spawned unit always reflects the hero they
        # actually loaded into the match with.
        if hero_name is None:
            hero_name = unit_spawn_hero_by_toon.get(toon_handle)

        # 3) Last resort: `replay.attributes.events`' `HeroAttributeId` (the
        # sole source before PARSER_VERSION 1.2) -- except for ARAM, where
        # it's confirmed unreliable (see PARSER_VERSION's 1.2/1.3 changelog
        # entries and `daemon-python/scripts/diagnose_hero_mapping.py`): an
        # ARAM replay that reaches this point with `hero_name` still unset
        # falls straight through to the `ReplayParseError` below instead of
        # silently recording a wrong hero.
        if hero_name is None and not is_aram:
            scope = scope_by_player_list_index.get(index)
            hero_code = _hero_attribute_code(attributes_events, scope) if scope is not None else None
            hero_name = constants.HERO_DISPLAY_NAMES.get(hero_code) if hero_code else None

        if hero_name is None:
            raise ReplayParseError(f"Could not determine hero for player {_s(player['m_name'])!r}.")

        battletag = battletags.get(toon_handle)
        if battletag is None:
            raise ReplayParseError(f"Could not resolve battletag for player {_s(player['m_name'])!r}")

        team = player["m_teamId"]
        if team not in (0, 1):
            raise ReplayParseError(f"Unsupported team id {team!r} (only 2-team matches are ingested).")

        players[toon_handle] = {
            "battletag": battletag,
            "heroId": _slugify(hero_name),
            "team": team,
            "winner": None,
            "stats": {},
            "talents": [],
        }

    map_internal_name: str | None = None
    gates_open_loop = 0

    for event in tracker_events:
        if event.get("_event") != "NNet.Replay.Tracker.SStatGameEvent":
            continue
        event_name = _s(event["m_eventName"])

        if event_name == "GatesOpen":
            gates_open_loop = event["_gameloop"]

        elif event_name == "EndOfGameTalentChoices":
            tracker_id = event["m_intData"][0]["m_value"]
            toon_handle = tracker_id_to_toon.get(tracker_id)
            player = players.get(toon_handle) if toon_handle else None
            if player is None:
                continue

            player["winner"] = _s(event["m_stringData"][1]["m_value"]) == "Win"

            if map_internal_name is None and len(event["m_stringData"]) > 2:
                map_internal_name = _s(event["m_stringData"][2]["m_value"])

            for entry in event["m_stringData"]:
                key = _s(entry["m_key"])
                if not key.startswith("Tier"):
                    continue
                digits = re.sub(r"\D", "", key)
                tier_index = int(digits) - 1 if digits else -1
                if 0 <= tier_index < len(constants.TALENT_TIER_LEVELS):
                    talent_name = _s(entry["m_value"])
                    player["talents"].append(
                        {
                            "tier": constants.TALENT_TIER_LEVELS[tier_index],
                            "talentId": talent_name,
                            "talentName": talent_name,
                        }
                    )

    _apply_score_event(tracker_events, tracker_id_to_toon, players)

    for player in players.values():
        if player["winner"] is None:
            # No `EndOfGameTalentChoices` for this player at all -- the game
            # never reached a real end, which is expected (not a parse bug)
            # for a Sandbox/practice session left running solo/unfinished:
            # those never fire the event for anyone, since there's no actual
            # win/loss condition to reach. Genuinely corrupt replays that
            # *did* conclude still fail below once `winner` resolves but
            # stats don't.
            raise ReplaySkipped(
                f"Match result missing for player {player['battletag']!r} (game may be incomplete).",
                reason="incomplete_game",
            )
        missing = [f for f in constants.REQUIRED_SCORE_FIELDS if f not in player["stats"]]
        if missing:
            raise ReplayParseError(f"Missing stats {missing} for player {player['battletag']!r}.")

    if map_internal_name is None:
        raise ReplayParseError("Could not determine the map played.")
    map_display_name = constants.MAP_DISPLAY_NAMES.get(map_internal_name)
    if map_display_name is None:
        map_display_name = _prettify_pascal_case(map_internal_name)
        logger.warning(
            "Unknown map internal name %r; using best-effort display name %r "
            "(add it to constants.MAP_DISPLAY_NAMES for a curated one).",
            map_internal_name,
            map_display_name,
        )

    region = str(player_list[0]["m_toon"]["m_region"])

    duration_seconds = max(0, round((header["m_elapsedGameLoops"] - gates_open_loop) / _GAMELOOPS_PER_SECOND))

    hero_unit_tags = _hero_unit_tags_by_toon(tracker_events, tracker_id_to_toon)
    deaths = _extract_deaths(tracker_events, hero_unit_tags, players, gates_open_loop)
    level_snapshots = _extract_level_snapshots(tracker_events, tracker_id_to_toon, players, gates_open_loop)

    return {
        # Blizzard's own field name, kept as-is (not camelCased) since
        # that's what `POST /ingest` reads at the payload root to route
        # through the quarantine/adapter system for builds `DefaultAdapter`
        # hasn't been confirmed compatible with yet (see
        # apps/api/src/routes/ingest.ts and adapters/registry.ts). Dropped
        # silently by `replayPayloadSchema` itself (no `.strict()`), so
        # sending it doesn't affect normal ingestion.
        "m_baseBuild": header["m_version"]["m_baseBuild"],
        "replayHash": replay_hash,
        "parserVersion": constants.PARSER_VERSION,
        "gameVersion": _game_version(header),
        "map": _slugify(map_display_name),
        "gameMode": game_mode,
        "region": region,
        "playedAt": _windows_filetime_to_iso8601(details["m_timeUTC"]),
        "durationSeconds": duration_seconds,
        "timeline": {"deaths": deaths, "levelSnapshots": level_snapshots},
        "players": [
            {
                "battletag": p["battletag"],
                "heroId": p["heroId"],
                "team": p["team"],
                "winner": p["winner"],
                "talents": p["talents"],
                **p["stats"],
            }
            for p in players.values()
        ],
    }
