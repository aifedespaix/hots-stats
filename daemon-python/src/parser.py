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
from typing import Any

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

    As of `PARSER_VERSION` 1.2, only used as a *fallback* -- see
    `_hero_from_talent_prefix`, the primary source now, and that constant's
    changelog for why `HeroAttributeId` itself stopped being trustworthy.
    """
    entries = attributes_events.get("scopes", {}).get(scope, {}).get(_HERO_ATTRIBUTE_ID)
    if not entries:
        return None
    return _s(entries[0]["value"])


def _normalize_hero_name(name: str) -> str:
    """Strips everything but letters/digits, e.g. "Kael'thas" -> "Kaelthas",
    "E.T.C." -> "ETC" -- talent ids are the hero's name immediately followed
    by the ability name, both PascalCase with no separator (see
    `_hero_from_talent_prefix`)."""
    return re.sub(r"[^A-Za-z0-9]", "", name)


# Longest-normalized-name first, so e.g. a hero whose name is a prefix of
# another's never wins by accident -- checked empirically against the
# current roster (no `HERO_DISPLAY_NAMES` value's normalized form is a
# prefix of another's), not something this sort order can silently break if
# a future hero *does* introduce one, since the longer/more specific name is
# always tried first either way.
_HERO_NAME_CANDIDATES: tuple[tuple[str, str], ...] = tuple(
    sorted(
        ((_normalize_hero_name(display), display) for display in constants.HERO_DISPLAY_NAMES.values()),
        key=lambda pair: len(pair[0]),
        reverse=True,
    )
)


def _hero_from_talent_prefix(talent_id: str) -> str | None:
    """Matches a talent id's leading hero-name (e.g. "DiabloSoulShield" ->
    "Diablo") against every known hero's normalized display name. `None` if
    no candidate matches (an unrecognized/very new hero not yet in
    `HERO_DISPLAY_NAMES`, or a talent id that doesn't fit the convention)."""
    for normalized, display in _HERO_NAME_CANDIDATES:
        if talent_id.startswith(normalized):
            return display
    return None


def _first_talent_id_by_toon(tracker_events: list[dict], tracker_id_to_toon: dict[int, str]) -> dict[str, str]:
    """One talent id per toon handle (any tier -- the hero-name prefix is the
    same at every tier), for `_hero_from_talent_prefix`. Reads
    `EndOfGameTalentChoices` (tracker events, scoped by tracker player id via
    `tracker_id_to_toon`), the same event `build_payload` reads talents from
    below -- a separate, independent pass here only because hero resolution
    now needs one talent id *before* `players` is built."""
    first_talent: dict[str, str] = {}
    for event in tracker_events:
        if event.get("_event") != "NNet.Replay.Tracker.SStatGameEvent":
            continue
        if _s(event["m_eventName"]) != "EndOfGameTalentChoices":
            continue
        tracker_id = event["m_intData"][0]["m_value"]
        toon_handle = tracker_id_to_toon.get(tracker_id)
        if toon_handle is None or toon_handle in first_talent:
            continue
        for entry in event["m_stringData"]:
            if _s(entry["m_key"]).startswith("Tier"):
                first_talent[toon_handle] = _s(entry["m_value"])
                break
    return first_talent


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

    Raises `ReplayParseError` for anything the ingestion API wouldn't accept
    or that we can't confidently extract (AI players, incomplete games,
    unrecognized hero/map codes).
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

    # Also used below for talents/stats (`EndOfGameTalentChoices` /
    # `SScoreResultEvent`) and, as of `PARSER_VERSION` 1.2, for hero
    # resolution itself via `_first_talent_id_by_toon` -- see that function
    # and `_hero_from_talent_prefix`.
    tracker_id_to_toon: dict[int, str] = {}
    for event in tracker_events:
        if event.get("_event") != "NNet.Replay.Tracker.SStatGameEvent":
            continue
        if _s(event["m_eventName"]) != "PlayerInit":
            continue
        if _s(event["m_stringData"][0]["m_value"]) == "Computer":
            raise ReplayParseError("Replay includes a computer (AI) player; only real-player matches are ingested.")
        tracker_id = event["m_intData"][0]["m_value"]
        toon_handle = _s(event["m_stringData"][1]["m_value"])
        tracker_id_to_toon[tracker_id] = toon_handle

    first_talent_by_toon = _first_talent_id_by_toon(tracker_events, tracker_id_to_toon)
    scope_by_player_list_index = _attribute_scope_by_player_list_index(attributes_events, len(player_list))

    players: dict[str, dict[str, Any]] = {}
    for index, player in enumerate(player_list, start=1):
        toon_handle = _toon_handle(player["m_toon"])

        # Primary source: the hero-name prefix of this player's own talent
        # picks (`EndOfGameTalentChoices`, tracker-events based -- the same
        # mechanism that already resolves talents/stats/win result further
        # below, and unaffected by the bug described next). Falls back to
        # `replay.attributes.events`' `HeroAttributeId` (the sole source
        # before PARSER_VERSION 1.2) only when no talent is available to
        # match against -- e.g. a very new hero not yet in
        # `HERO_DISPLAY_NAMES`. `HeroAttributeId` stopped being reliable on
        # its own at some point: real replays have been observed where every
        # player's `HeroAttributeId` names a hero nobody in the match
        # actually played (talents/stats/win result staying correct
        # regardless, since those never read this attribute) -- see
        # `daemon-python/scripts/diagnose_hero_mapping.py`.
        hero_name = None
        first_talent = first_talent_by_toon.get(toon_handle)
        if first_talent is not None:
            hero_name = _hero_from_talent_prefix(first_talent)

        if hero_name is None:
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
            raise ReplayParseError(f"Match result missing for player {player['battletag']!r} (game may be incomplete).")
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

    game_options = (
        initdata.get("m_syncLobbyState", {}).get("m_gameDescription", {}).get("m_gameOptions", {})
    )
    amm_id = game_options.get("m_ammId")
    game_mode = constants.GAME_MODE_BY_AMM_ID.get(amm_id, constants.DEFAULT_GAME_MODE)

    region = str(player_list[0]["m_toon"]["m_region"])

    duration_seconds = max(0, round((header["m_elapsedGameLoops"] - gates_open_loop) / _GAMELOOPS_PER_SECOND))

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
        "map": _slugify(map_display_name),
        "gameMode": game_mode,
        "region": region,
        "playedAt": _windows_filetime_to_iso8601(details["m_timeUTC"]),
        "durationSeconds": duration_seconds,
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
