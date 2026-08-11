"""Parses a `.StormReplay` file into a dict matching `replayPayloadSchema`.

Built on top of Blizzard's official `heroprotocol` package, which only
decodes the *binary encoding* of a replay — it has no notion of what a
"kill" or a "game mode" is. The event names, stat field names, map/game-mode
ids and hero attribute codes used below are cross-checked against the
community-maintained `hots-parser` project (MIT,
https://github.com/ebshimizu/hots-parser) and its real-replay test
fixtures, since they aren't documented anywhere in `heroprotocol` itself.
"""

from __future__ import annotations

import datetime as dt
import importlib
import re
from pathlib import Path
from typing import Any

import mpyq

from . import constants
from ._protocol_versions import KNOWN_PROTOCOL_BUILDS
from .hasher import hash_replay_file

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
        raise ReplayParseError(
            f"Unsupported replay base build {base_build}; upgrade the `heroprotocol` package."
        ) from err


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

        details = protocol.decode_replay_details(archive.read_file("replay.details"))
        initdata = protocol.decode_replay_initdata(archive.read_file("replay.initData"))
        tracker_events = list(protocol.decode_replay_tracker_events(archive.read_file("replay.tracker.events")))
        battletags = _extract_battletags(archive, details["m_playerList"])

        return build_payload(
            header=header,
            details=details,
            initdata=initdata,
            tracker_events=tracker_events,
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
    battletags: dict[str, str],
    replay_hash: str,
) -> dict[str, Any]:
    """Pure transformation from decoded replay structures to the API payload.

    Split out from `parse_replay` so the event-correlation logic (the part
    most likely to need adjusting against real replays) can be unit tested
    with synthetic data, independent of `mpyq`/`heroprotocol` decoding.
    """
    player_list = details["m_playerList"]

    players: dict[str, dict[str, Any]] = {}
    for player in player_list:
        toon_handle = _toon_handle(player["m_toon"])
        hero_code = _s(player["m_hero"])
        hero_name = constants.HERO_DISPLAY_NAMES.get(hero_code)
        if hero_name is None:
            raise ReplayParseError(f"Unknown hero attribute code: {hero_code!r}")

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

    tracker_id_to_toon: dict[int, str] = {}
    map_internal_name: str | None = None
    gates_open_loop = 0

    for event in tracker_events:
        if event.get("_event") != "NNet.Replay.Tracker.SStatGameEvent":
            continue
        event_name = _s(event["m_eventName"])

        if event_name == "PlayerInit":
            if _s(event["m_stringData"][0]["m_value"]) == "Computer":
                raise ReplayParseError("Replay includes a computer (AI) player; only real-player matches are ingested.")
            tracker_id = event["m_intData"][0]["m_value"]
            toon_handle = _s(event["m_stringData"][1]["m_value"])
            tracker_id_to_toon[tracker_id] = toon_handle

        elif event_name == "GatesOpen":
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
    map_display_name = constants.MAP_DISPLAY_NAMES.get(map_internal_name, map_internal_name)

    game_options = (
        initdata.get("m_syncLobbyState", {}).get("m_gameDescription", {}).get("m_gameOptions", {})
    )
    amm_id = game_options.get("m_ammId")
    game_mode = constants.GAME_MODE_BY_AMM_ID.get(amm_id, constants.DEFAULT_GAME_MODE)

    region = str(player_list[0]["m_toon"]["m_region"])

    duration_seconds = max(0, round((header["m_elapsedGameLoops"] - gates_open_loop) / _GAMELOOPS_PER_SECOND))

    return {
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
