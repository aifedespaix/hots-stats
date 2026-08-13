"""Debug tool for hero/player mismatches (see `parser._attribute_scope_by_player_list_index`).

Reuses the daemon's own parser internals (not a reimplementation) to dump,
for one `.StormReplay` file, every piece of data involved in resolving
"which player played which hero": `m_playerList` order, the raw
`replay.attributes.events` scopes (both sorted and in on-disk/decode order,
to check whether they actually differ), our current scope->player-index
mapping, and -- as an independent ground truth -- the hero implied by each
player's talent name prefixes (`EndOfGameTalentChoices`, tracker-events
based, a completely different resolution path from the attribute-events one
being debugged). If the attribute-resolved hero and the talent-prefix hero
disagree for a player, that's the mismatch, and this script shows exactly
which scope/index got swapped with which.

Usage (from `daemon-python/`, with the daemon's deps installed --
`pip install -e ".[dev]"`):

    python scripts/diagnose_hero_mapping.py "C:\\path\\to\\replay.StormReplay"
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import mpyq

from src import constants, parser


def _talent_hero_guess(tracker_events: list[dict], tracker_id_to_toon: dict[int, str]) -> dict[str, str]:
    """Best-effort hero guess per toon handle, from talent name prefixes
    (e.g. "DiabloSoulShield" -> "Diablo") -- independent ground truth, since
    this reads `EndOfGameTalentChoices` (tracker events), not
    `replay.attributes.events` (the thing being debugged)."""
    guesses: dict[str, str] = {}
    for event in tracker_events:
        if event.get("_event") != "NNet.Replay.Tracker.SStatGameEvent":
            continue
        if parser._s(event["m_eventName"]) != "EndOfGameTalentChoices":
            continue
        tracker_id = event["m_intData"][0]["m_value"]
        toon_handle = tracker_id_to_toon.get(tracker_id)
        if toon_handle is None:
            continue
        for entry in event["m_stringData"]:
            key = parser._s(entry["m_key"])
            if not key.startswith("Tier"):
                continue
            talent = parser._s(entry["m_value"])
            # Talent ids are the hero's internal name immediately followed by
            # the ability name, both PascalCase with no separator -- there's
            # no reliable delimiter, so just show the raw talent string and
            # let a human eyeball the hero prefix (works fine for this
            # one-off debug tool; not worth a real hero-name-prefix matcher).
            guesses.setdefault(toon_handle, talent)
    return guesses


def main(path_arg: str) -> None:
    path = Path(path_arg)
    archive = mpyq.MPQArchive(str(path))

    header_contents = archive.header["user_data_header"]["content"]
    header = parser._protocol_module(max(parser.KNOWN_PROTOCOL_BUILDS)).decode_replay_header(header_contents)
    protocol = parser._build_protocol(header)
    base_build = header["m_version"]["m_baseBuild"]
    print(f"m_baseBuild: {base_build}\n")

    details = protocol.decode_replay_details(parser._read_archive_file(archive, "replay.details"))
    tracker_events = list(
        protocol.decode_replay_tracker_events(parser._read_archive_file(archive, "replay.tracker.events"))
    )
    attributes_events = protocol.decode_replay_attributes_events(
        parser._read_archive_file(archive, "replay.attributes.events")
    )
    battletags = parser._extract_battletags(archive, details["m_playerList"])

    player_list = details["m_playerList"]

    print("=== m_playerList (details stream) ===")
    for index, player in enumerate(player_list, start=1):
        toon_handle = parser._toon_handle(player["m_toon"])
        print(
            f"  index={index}  team={player['m_teamId']}  name={parser._s(player['m_name'])!r}  "
            f"toon={toon_handle}  battletag={battletags.get(toon_handle)!r}"
        )

    print("\n=== replay.attributes.events scopes ===")
    scopes = attributes_events.get("scopes", {})
    print(f"  scope keys, decode/insertion order: {list(scopes.keys())}")
    print(f"  scope keys, numeric sort:           {sorted(scopes.keys())}")
    for scope in scopes:
        player_type_entries = scopes[scope].get(parser._PLAYER_TYPE_ATTRIBUTE_ID)
        player_type = parser._s(player_type_entries[0]["value"]).strip("\x00") if player_type_entries else None
        hero_code = parser._hero_attribute_code(attributes_events, scope)
        hero_name = constants.HERO_DISPLAY_NAMES.get(hero_code) if hero_code else None
        print(f"  scope={scope}  PlayerTypeAttribute={player_type!r}  HeroAttributeId={hero_code!r} -> {hero_name!r}")

    scope_by_index = parser._attribute_scope_by_player_list_index(attributes_events, len(player_list))
    print(f"\n=== our computed m_playerList-index -> scope mapping ===\n  {scope_by_index}")

    tracker_id_to_toon: dict[int, str] = {}
    for event in tracker_events:
        if event.get("_event") != "NNet.Replay.Tracker.SStatGameEvent":
            continue
        if parser._s(event["m_eventName"]) != "PlayerInit":
            continue
        tracker_id = event["m_intData"][0]["m_value"]
        toon_handle = parser._s(event["m_stringData"][1]["m_value"])
        tracker_id_to_toon[tracker_id] = toon_handle
    talent_guess_by_toon = _talent_hero_guess(tracker_events, tracker_id_to_toon)

    print("\n=== cross-check: attribute-resolved hero vs talent-prefix hero, per player ===")
    mismatches = 0
    for index, player in enumerate(player_list, start=1):
        toon_handle = parser._toon_handle(player["m_toon"])
        scope = scope_by_index.get(index)
        hero_code = parser._hero_attribute_code(attributes_events, scope) if scope is not None else None
        hero_name = constants.HERO_DISPLAY_NAMES.get(hero_code) if hero_code else None
        talent_sample = talent_guess_by_toon.get(toon_handle, "(no talents found)")
        flag = ""
        if hero_name and talent_sample != "(no talents found)" and not talent_sample.lower().startswith(
            hero_name.replace(" ", "").replace("-", "").replace(".", "").lower()[:4]
        ):
            flag = "  <-- MISMATCH"
            mismatches += 1
        print(
            f"  index={index} battletag={battletags.get(toon_handle)!r:30} scope={scope} "
            f"attribute_hero={hero_name!r:20} first_talent={talent_sample!r}{flag}"
        )

    print(f"\n{mismatches} likely mismatch(es) found." if mismatches else "\nNo mismatches detected by this heuristic.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: python {sys.argv[0]} <path-to-.StormReplay>")
        raise SystemExit(1)
    main(sys.argv[1])
