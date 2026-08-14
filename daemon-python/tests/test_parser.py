import datetime as dt

import pytest

from src._protocol_versions import KNOWN_PROTOCOL_BUILDS
from src.parser import (
    ReplayParseError,
    ReplaySkipped,
    _attribute_scope_by_player_list_index,
    _build_protocol,
    _has_computer_player_attribute,
    _hero_from_any_talent,
    _hero_from_talent_prefix,
    _hero_from_unit_spawn_by_toon,
    _hero_from_unit_type_name,
    _protocol_module,
    _read_archive_file,
    _slugify,
    _toon_handle,
    _windows_filetime_to_iso8601,
    build_payload,
)


def _filetime(iso: str) -> int:
    seconds = dt.datetime.fromisoformat(iso).replace(tzinfo=dt.timezone.utc).timestamp()
    return round((seconds + 11_644_473_600) * 10_000_000)


def test_protocol_module_imports_a_known_build_by_name():
    # Regression test for the daemon's onefile packaging bug: this must go
    # through `importlib.import_module` (works under Nuitka's --onefile
    # build), not `heroprotocol.versions.build()`/`.latest()` (which
    # `os.listdir` next to their own `__file__` and fail there instead).
    latest_build = max(KNOWN_PROTOCOL_BUILDS)
    module = _protocol_module(latest_build)
    assert module.__name__ == f"heroprotocol.versions.protocol{latest_build:05d}"
    assert hasattr(module, "decode_replay_header")


def test_build_protocol_raises_replay_parse_error_for_unsupported_build():
    with pytest.raises(ReplayParseError, match="Unsupported replay base build"):
        _build_protocol({"m_version": {"m_baseBuild": 1}})


def test_build_protocol_falls_back_to_newest_known_build_for_newer_replays():
    # A replay recorded with a patch newer than anything `heroprotocol` has
    # published a decoder for yet shouldn't hard-fail: fall back to the
    # newest known build instead (see `_build_protocol`'s fallback comment).
    newest_build = max(KNOWN_PROTOCOL_BUILDS)
    module = _build_protocol({"m_version": {"m_baseBuild": newest_build + 1000}})
    assert module.__name__ == f"heroprotocol.versions.protocol{newest_build:05d}"


class _FakeArchive:
    """Stands in for `mpyq.MPQArchive`: only `read_file` is exercised here."""

    def __init__(self, files: dict[str, bytes]):
        self._files = files

    def read_file(self, filename: str) -> bytes | None:
        return self._files.get(filename)


def test_read_archive_file_returns_the_streams_bytes():
    archive = _FakeArchive({"replay.details": b"\x01\x02"})
    assert _read_archive_file(archive, "replay.details") == b"\x01\x02"


def test_read_archive_file_raises_replay_parse_error_for_a_missing_stream():
    # Regression test: `mpyq.MPQArchive.read_file` returns `None` (rather
    # than raising) for a stream that's absent from the archive's hash
    # table or resolves to a zero-length block entry. Feeding that `None`
    # straight into a `heroprotocol` decoder used to blow up several stack
    # frames deep with an opaque `TypeError: cannot convert 'NoneType'
    # object to bytes` instead of a message naming the actual problem.
    archive = _FakeArchive({"replay.details": b"\x01\x02"})
    with pytest.raises(ReplayParseError, match="replay.attributes.events"):
        _read_archive_file(archive, "replay.attributes.events")


def test_slugify():
    assert _slugify("Li-Ming") == "li-ming"
    assert _slugify("Cursed Hollow") == "cursed-hollow"
    assert _slugify("Anub'arak") == "anub-arak"


def test_toon_handle():
    toon = {"m_region": 1, "m_programId": b"Hero", "m_realm": 1, "m_id": 12345}
    assert _toon_handle(toon) == "1-Hero-1-12345"


def test_windows_filetime_to_iso8601_roundtrip():
    iso = "2024-06-15T12:30:00+00:00"
    assert _windows_filetime_to_iso8601(_filetime(iso)) == "2024-06-15T12:30:00.000Z"


def _string_entry(key: bytes, value: bytes) -> dict:
    return {"m_key": key, "m_value": value}


def _player_init_event(tracker_id: int, toon_handle: str, kind: bytes = b"Human") -> dict:
    return {
        "_event": "NNet.Replay.Tracker.SStatGameEvent",
        "m_eventName": b"PlayerInit",
        "m_intData": [{"m_key": b"PlayerID", "m_value": tracker_id}],
        "m_stringData": [
            _string_entry(b"PlayerType", kind),
            _string_entry(b"ToonHandle", toon_handle.encode()),
        ],
    }


def _gates_open_event(gameloop: int) -> dict:
    return {"_event": "NNet.Replay.Tracker.SStatGameEvent", "m_eventName": b"GatesOpen", "_gameloop": gameloop}


def _end_of_game_event(tracker_id: int, result: bytes, map_name: bytes, talents: dict[int, str]) -> dict:
    string_data = [
        _string_entry(b"Hero", b"Wiza"),
        _string_entry(b"Result", result),
        _string_entry(b"Map", map_name),
    ]
    for tier, talent in talents.items():
        string_data.append(_string_entry(f"Tier {tier} Talent".encode(), talent.encode()))
    return {
        "_event": "NNet.Replay.Tracker.SStatGameEvent",
        "m_eventName": b"EndOfGameTalentChoices",
        "m_intData": [{"m_key": b"PlayerID", "m_value": tracker_id}],
        "m_stringData": string_data,
    }


def _attributes_events(hero_by_tracker_id: dict[int, bytes]) -> dict:
    return {
        "scopes": {
            tracker_id: {4002: [{"value": hero_code}]} for tracker_id, hero_code in hero_by_tracker_id.items()
        }
    }


def _unit_born_event(control_player_id: int, unit_type_name: str) -> dict:
    return {
        "_event": "NNet.Replay.Tracker.SUnitBornEvent",
        "m_controlPlayerId": control_player_id,
        "m_unitTypeName": unit_type_name.encode(),
    }


def _score_event(stats_by_name: dict[str, list[int]]) -> dict:
    return {
        "_event": "NNet.Replay.Tracker.SScoreResultEvent",
        "m_instanceList": [
            {"m_name": name.encode(), "m_values": [[{"m_value": v}] for v in values]}
            for name, values in stats_by_name.items()
        ],
    }


REQUIRED_STATS = {
    "SoloKill": [5, 1],
    "Deaths": [2, 4],
    "Assists": [3, 6],
    "HeroDamage": [50000, 10000],
    "SiegeDamage": [10000, 2000],
    "Healing": [0, 40000],
    "SelfHealing": [2000, 1000],
    "DamageTaken": [15000, 20000],
    "ExperienceContribution": [8000, 7000],
}


def _details() -> dict:
    return {
        "m_playerList": [
            {
                "m_name": b"Foo",
                "m_toon": {"m_region": 1, "m_programId": b"Hero", "m_realm": 1, "m_id": 1001},
                # Deliberately the *localized* display name, not the "Wiza"
                # attribute code -- hero resolution must ignore this field
                # entirely (see `_hero_attribute_code`) and use
                # `attributes_events` instead, same as a real French client.
                "m_hero": b"Li-Ming",
                "m_teamId": 0,
            },
            {
                "m_name": b"Bar",
                "m_toon": {"m_region": 1, "m_programId": b"Hero", "m_realm": 1, "m_id": 1002},
                "m_hero": b"Malfurion",
                "m_teamId": 1,
            },
        ],
        "m_timeUTC": _filetime("2024-06-15T12:00:00+00:00"),
    }


def _initdata(amm_id: int | None = 50001) -> dict:
    return {"m_syncLobbyState": {"m_gameDescription": {"m_gameOptions": {"m_ammId": amm_id}}}}


def _base_tracker_events() -> list[dict]:
    return [
        _player_init_event(1, "1-Hero-1-1001"),
        _player_init_event(2, "1-Hero-1-1002"),
        _gates_open_event(610),
        _score_event(REQUIRED_STATS),
        # Event keys are pick order (1st..7th pick), not character level —
        # the 2nd pick happens at level 4, per TALENT_TIER_LEVELS.
        _end_of_game_event(1, b"Win", b"CursedHollow", {1: "TalentA", 2: "TalentB"}),
        _end_of_game_event(2, b"Loss", b"CursedHollow", {1: "TalentC"}),
    ]


def _base_attributes_events() -> dict:
    return _attributes_events({1: b"Wiza", 2: b"Malf"})


def _battletags() -> dict[str, str]:
    return {"1-Hero-1-1001": "Foo#1111", "1-Hero-1-1002": "Bar#2222"}


def _header(elapsed_loops: int, base_build: int = 12345) -> dict:
    return {"m_elapsedGameLoops": elapsed_loops, "m_version": {"m_baseBuild": base_build}}


def test_build_payload_happy_path():
    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=_base_tracker_events(),
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    assert payload["replayHash"] == "a" * 64
    assert payload["m_baseBuild"] == 12345
    assert payload["map"] == "cursed-hollow"
    assert payload["gameMode"] == "QuickMatch"
    assert payload["region"] == "1"
    assert payload["durationSeconds"] == 600
    assert payload["playedAt"] == "2024-06-15T12:00:00.000Z"

    players_by_tag = {p["battletag"]: p for p in payload["players"]}
    foo = players_by_tag["Foo#1111"]
    assert foo["heroId"] == "li-ming"
    assert foo["team"] == 0
    assert foo["winner"] is True
    assert foo["kills"] == 5
    assert foo["deaths"] == 2
    assert foo["heroDamage"] == 50000
    assert foo["talents"] == [
        {"tier": 1, "talentId": "TalentA", "talentName": "TalentA"},
        {"tier": 4, "talentId": "TalentB", "talentName": "TalentB"},
    ]

    bar = players_by_tag["Bar#2222"]
    assert bar["heroId"] == "malfurion"
    assert bar["winner"] is False
    assert bar["kills"] == 1


def test_build_payload_forwards_stats_the_api_does_not_use_yet():
    """A tracker stat the API doesn't read (yet) is still sent, generically
    camelCased -- so the API can start using it without a daemon rebuild."""
    stats = dict(REQUIRED_STATS)
    stats["MinionKills"] = [12, 7]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=[
            *_base_tracker_events()[:3],
            _score_event(stats),
            *_base_tracker_events()[4:],
        ],
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    players_by_tag = {p["battletag"]: p for p in payload["players"]}
    assert players_by_tag["Foo#1111"]["minionKills"] == 12
    assert players_by_tag["Bar#2222"]["minionKills"] == 7


def test_build_payload_unknown_map_falls_back_to_prettified_slug():
    """Regression test: a map internal name not yet in
    constants.MAP_DISPLAY_NAMES (a new battleground) must not produce a
    malformed, wordless slug like "industrialdistrict" -- see
    `_prettify_pascal_case`."""
    events = [
        *_base_tracker_events()[:4],
        _end_of_game_event(1, b"Win", b"IndustrialDistrict", {1: "TalentA", 2: "TalentB"}),
        _end_of_game_event(2, b"Loss", b"IndustrialDistrict", {1: "TalentC"}),
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

    assert payload["map"] == "industrial-district"


def test_build_payload_unknown_ammid_falls_back_to_custom():
    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(amm_id=999999),
        tracker_events=_base_tracker_events(),
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    assert payload["gameMode"] == "Custom"


def test_build_payload_rejects_computer_player():
    events = [
        _player_init_event(1, "1-Hero-1-1001", kind=b"Computer"),
        *_base_tracker_events()[1:],
    ]

    # ReplaySkipped is a ReplayParseError subclass, so `pytest.raises(ReplayParseError, ...)`
    # still matches -- but this must specifically be `ReplaySkipped` (not a
    # plain `ReplayParseError`), since `ingestion.ingest_file` treats the two
    # very differently: a `ReplaySkipped` is recorded via `mark_skipped` and
    # kept out of the Debug report's error count, a `ReplayParseError` isn't.
    with pytest.raises(ReplaySkipped, match="computer") as exc_info:
        build_payload(
            header=_header(610 + 16 * 600),
            details=_details(),
            initdata=_initdata(),
            tracker_events=events,
            attributes_events=_base_attributes_events(),
            battletags=_battletags(),
            replay_hash="a" * 64,
        )
    assert exc_info.value.reason == "ai_player"


def test_build_payload_rejects_computer_player_detected_via_attribute_only():
    """Regression test: some AI-populated replays (observed on 'Bac à
    sable' / practice-mode games, where the bot's display name comes
    through as a generic placeholder like 'Joueur 2') never fire a
    'Computer'-typed `PlayerInit` tracker event for the bot slot at all --
    only `PlayerTypeAttribute`, a completely different stream, flags it.
    Every tracker `PlayerInit` event below says 'Human' on purpose, to
    prove this is caught independently of that other check."""
    attributes_events = {
        "scopes": {
            1: {4002: [{"value": b"Wiza"}], 500: [{"value": b"humn"}]},
            2: {4002: [{"value": b"Malf"}], 500: [{"value": b"comp"}]},
        }
    }

    with pytest.raises(ReplaySkipped, match="computer") as exc_info:
        build_payload(
            header=_header(610 + 16 * 600),
            details=_details(),
            initdata=_initdata(),
            tracker_events=_base_tracker_events(),  # every PlayerInit here says "Human"
            attributes_events=attributes_events,
            battletags=_battletags(),
            replay_hash="a" * 64,
        )
    assert exc_info.value.reason == "ai_player"


def test_build_payload_ignores_open_slot_player_init_event():
    """Regression test: an empty ("Open") lobby slot in an under-filled
    custom/practice lobby fires its own `PlayerInit` tracker event too, but
    with only a `PlayerType` entry and no `ToonHandle` -- indexing into
    `m_stringData[1]` for it used to crash the whole parse with an
    `IndexError` instead of just having nothing to correlate it to."""
    open_slot_event = {
        "_event": "NNet.Replay.Tracker.SStatGameEvent",
        "m_eventName": b"PlayerInit",
        "m_intData": [{"m_key": b"PlayerID", "m_value": 99}],
        "m_stringData": [_string_entry(b"PlayerType", b"Open")],
    }
    events = [open_slot_event, *_base_tracker_events()]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    assert {p["battletag"] for p in payload["players"]} == {"Foo#1111", "Bar#2222"}


def test_build_payload_rejects_unknown_hero():
    with pytest.raises(ReplayParseError, match="hero"):
        build_payload(
            header=_header(610 + 16 * 600),
            details=_details(),
            initdata=_initdata(),
            tracker_events=_base_tracker_events(),
            attributes_events=_attributes_events({1: b"ZZZZ", 2: b"Malf"}),
            battletags=_battletags(),
            replay_hash="a" * 64,
        )


def test_build_payload_skips_incomplete_game():
    """A replay that never fires `EndOfGameTalentChoices` for a player --
    observed on Sandbox/practice sessions left running without ever reaching
    a real win/loss condition -- is a deliberate skip, not a parse error: see
    `ReplaySkipped`'s docstring and `ingestion.ingest_file`'s handling of it."""
    events = [e for e in _base_tracker_events() if not (e.get("m_eventName") == b"EndOfGameTalentChoices")]

    with pytest.raises(ReplaySkipped, match="result missing") as exc_info:
        build_payload(
            header=_header(610 + 16 * 600),
            details=_details(),
            initdata=_initdata(),
            tracker_events=events,
            attributes_events=_base_attributes_events(),
            battletags=_battletags(),
            replay_hash="a" * 64,
        )
    assert exc_info.value.reason == "incomplete_game"


def test_build_payload_rejects_missing_battletag():
    with pytest.raises(ReplayParseError, match="battletag"):
        build_payload(
            header=_header(610 + 16 * 600),
            details=_details(),
            initdata=_initdata(),
            tracker_events=_base_tracker_events(),
            attributes_events=_base_attributes_events(),
            battletags={},
            replay_hash="a" * 64,
        )


def test_build_payload_resolves_aram_game_mode():
    # Regression test: ARAM's ammId (50101) was missing from
    # GAME_MODE_BY_AMM_ID and silently fell back to "Custom". `_base_tracker_events`'s
    # placeholder talent ids ("TalentA"/"TalentB"/"TalentC") don't match any real
    # hero-name prefix, so hero resolution needs the `SUnitBornEvent`s added
    # here to succeed at all -- ARAM never falls back to `HeroAttributeId`
    # (see `test_build_payload_aram_never_falls_back_to_hero_attribute`).
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroLiMing"),
        _unit_born_event(2, "HeroMalfurion"),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(amm_id=50101),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    assert payload["gameMode"] == "ARAM"
    players_by_tag = {p["battletag"]: p for p in payload["players"]}
    assert players_by_tag["Foo#1111"]["heroId"] == "li-ming"
    assert players_by_tag["Bar#2222"]["heroId"] == "malfurion"


def test_build_payload_aram_never_falls_back_to_hero_attribute():
    """Regression test for the "Arthas" bug: ARAM's shuffle/reroll pick can
    leave `HeroAttributeId` pointing at a player's discarded first
    assignment, so ARAM must never trust it, even as a last resort -- a
    replay with neither a matching talent nor a `SUnitBornEvent` must fail
    loudly instead of silently recording whatever `HeroAttributeId` says
    (here, "Arth"/Arthas, though nobody in the match played it)."""
    events = [e for e in _base_tracker_events() if e.get("_event") != "NNet.Replay.Tracker.SUnitBornEvent"]

    with pytest.raises(ReplayParseError, match="Could not determine hero"):
        build_payload(
            header=_header(610 + 16 * 600),
            details=_details(),
            initdata=_initdata(amm_id=50101),
            tracker_events=events,
            attributes_events=_attributes_events({1: b"Arth", 2: b"Arth"}),
            battletags=_battletags(),
            replay_hash="a" * 64,
        )


def test_build_payload_aram_resolves_hero_from_unit_spawn_over_stale_attribute():
    """The positive counterpart of the test above: with a `SUnitBornEvent`
    available, ARAM resolves the *actually played* hero even when
    `HeroAttributeId` disagrees for every player (simulating the post-reroll
    staleness that causes the real "Arthas" bug)."""
    events = [
        *(e for e in _base_tracker_events() if e.get("_event") != "NNet.Replay.Tracker.SUnitBornEvent"),
        _unit_born_event(1, "HeroLiMing"),
        _unit_born_event(2, "HeroMalfurion"),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(amm_id=50101),
        tracker_events=events,
        attributes_events=_attributes_events({1: b"Arth", 2: b"Arth"}),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    players_by_tag = {p["battletag"]: p for p in payload["players"]}
    assert players_by_tag["Foo#1111"]["heroId"] == "li-ming"
    assert players_by_tag["Bar#2222"]["heroId"] == "malfurion"


def test_build_payload_resolves_hero_by_player_list_position_not_tracker_id():
    """Regression test for the `replay.attributes.events` *fallback* path
    (talents here -- "TalentA"/"TalentC" -- don't match any real hero name
    prefix, so `_hero_from_talent_prefix` returns `None` and hero resolution
    falls through to this attribute-based logic, same as before
    PARSER_VERSION 1.2 made talents the primary source): a player's hero
    must be resolved by their `m_playerList` position, not by whichever
    tracker id `PlayerInit` happened to assign them -- the two numberings
    aren't guaranteed to match (see `_attribute_scope_by_player_list_index`).
    Here `PlayerInit` fires in the *reverse* of `m_playerList` order (Foo,
    listed first, gets tracker id 2; Bar, listed second, gets tracker id 1),
    while the attribute-events scopes still follow plain `m_playerList`
    order (scope 1 = Foo = Li-Ming, scope 2 = Bar = Malfurion). The previous
    tracker-id-keyed lookup would swap their heroes.
    """
    events = [
        _player_init_event(2, "1-Hero-1-1001"),  # Foo (m_playerList[0])
        _player_init_event(1, "1-Hero-1-1002"),  # Bar (m_playerList[1])
        _gates_open_event(610),
        _score_event(REQUIRED_STATS),
        # EndOfGameTalentChoices is keyed by tracker id, a separate,
        # internally-consistent numbering -- unaffected by this bug, and
        # deliberately left swapped-looking here to prove it stays correct.
        _end_of_game_event(2, b"Win", b"CursedHollow", {1: "TalentA"}),
        _end_of_game_event(1, b"Loss", b"CursedHollow", {1: "TalentC"}),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_attributes_events({1: b"Wiza", 2: b"Malf"}),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    players_by_tag = {p["battletag"]: p for p in payload["players"]}
    assert players_by_tag["Foo#1111"]["heroId"] == "li-ming"
    assert players_by_tag["Bar#2222"]["heroId"] == "malfurion"
    # Talents/result, sourced from the tracker-id-keyed event, are correct
    # for the *tracker id* each player actually got (2 for Foo, 1 for Bar).
    assert players_by_tag["Foo#1111"]["winner"] is True
    assert players_by_tag["Foo#1111"]["talents"] == [{"tier": 1, "talentId": "TalentA", "talentName": "TalentA"}]
    assert players_by_tag["Bar#2222"]["winner"] is False
    assert players_by_tag["Bar#2222"]["talents"] == [{"tier": 1, "talentId": "TalentC", "talentName": "TalentC"}]


def test_build_payload_resolves_hero_from_talent_prefix_even_when_attribute_disagrees():
    """Regression test for a real production bug (PARSER_VERSION 1.2, see
    `daemon-python/scripts/diagnose_hero_mapping.py`): on current replays,
    `replay.attributes.events`' `HeroAttributeId` has been observed to name
    a hero nobody in the match actually played, for every player at once --
    not a simple index swap (the wrong hero has zero overlap with anyone's
    real hero), so no amount of re-indexing into that attribute fixes it.
    Talents (`EndOfGameTalentChoices`, a separate tracker-events mechanism)
    stayed correct throughout. Foo's attribute-events hero says "Wiza"
    (Li-Ming) but their talent is "DiabloSoulShield" -- the talent must win.
    """
    events = [
        _player_init_event(1, "1-Hero-1-1001"),
        _player_init_event(2, "1-Hero-1-1002"),
        _gates_open_event(610),
        _score_event(REQUIRED_STATS),
        _end_of_game_event(1, b"Win", b"CursedHollow", {1: "DiabloSoulShield"}),
        _end_of_game_event(2, b"Loss", b"CursedHollow", {1: "ThrallMaelstromWeapon"}),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_attributes_events({1: b"Wiza", 2: b"Malf"}),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    players_by_tag = {p["battletag"]: p for p in payload["players"]}
    assert players_by_tag["Foo#1111"]["heroId"] == "diablo"
    assert players_by_tag["Bar#2222"]["heroId"] == "thrall"


def test_build_payload_falls_back_to_hero_attribute_without_a_matching_talent_prefix():
    """No `EndOfGameTalentChoices` event at all for this player (e.g. a
    replay build/edge case where talents didn't decode) -- hero resolution
    must still fall back to `replay.attributes.events` rather than failing
    outright."""
    events = [e for e in _base_tracker_events() if e.get("m_eventName") != b"EndOfGameTalentChoices"]
    events.append(_end_of_game_event(1, b"Win", b"CursedHollow", {}))
    events.append(_end_of_game_event(2, b"Loss", b"CursedHollow", {}))

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    players_by_tag = {p["battletag"]: p for p in payload["players"]}
    assert players_by_tag["Foo#1111"]["heroId"] == "li-ming"
    assert players_by_tag["Bar#2222"]["heroId"] == "malfurion"


def test_build_payload_resolves_hero_from_a_later_talent_tier():
    """Regression test for the "fragile" single-tier talent matching this
    replaces: a player's *first* talent tier not matching any known hero
    prefix (e.g. a decode quirk, or a hero-name-normalization gap) must not
    sink hero resolution when a *later* tier's pick still matches fine."""
    events = [
        _player_init_event(1, "1-Hero-1-1001"),
        _player_init_event(2, "1-Hero-1-1002"),
        _gates_open_event(610),
        _score_event(REQUIRED_STATS),
        _end_of_game_event(1, b"Win", b"CursedHollow", {1: "NotAKnownHeroPrefix", 2: "DiabloSoulShield"}),
        _end_of_game_event(2, b"Loss", b"CursedHollow", {1: "ThrallMaelstromWeapon"}),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_attributes_events({1: b"Wiza", 2: b"Malf"}),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    players_by_tag = {p["battletag"]: p for p in payload["players"]}
    assert players_by_tag["Foo#1111"]["heroId"] == "diablo"
    assert players_by_tag["Bar#2222"]["heroId"] == "thrall"


def test_hero_from_talent_prefix_matches_known_heroes():
    assert _hero_from_talent_prefix("DiabloSoulShield") == "Diablo"
    assert _hero_from_talent_prefix("KaelthasManaAddict") == "Kael'thas"
    assert _hero_from_talent_prefix("LiMingCriticalMass") == "Li-Ming"
    assert _hero_from_talent_prefix("LiLiSecondWind") == "Li Li"


def test_hero_from_talent_prefix_matches_case_insensitively():
    # D.Va's unit type name is "HeroDva" (lowercase "v"/"a") while
    # `HERO_DISPLAY_NAMES`' "D.Va" normalizes to "DVa" -- an exact-case
    # match would miss this.
    assert _hero_from_talent_prefix("DvaBoosters") == "D.Va"


def test_hero_from_talent_prefix_matches_the_butcher_without_its_article():
    # Blizzard's internal name drops "The" entirely (confirmed via
    # `HeroButcher`'s `SUnitBornEvent` unit type name).
    assert _hero_from_talent_prefix("ButcherFreshMeat") == "The Butcher"


def test_hero_from_talent_prefix_returns_none_for_unrecognized_talent():
    assert _hero_from_talent_prefix("SomeBrandNewHeroAbility") is None


def test_hero_from_any_talent_tries_every_tier_in_order():
    assert _hero_from_any_talent(["NotAKnownHeroPrefix", "DiabloSoulShield"]) == "Diablo"
    assert _hero_from_any_talent(["NotAKnownHeroPrefix"]) is None
    assert _hero_from_any_talent([]) is None


def test_hero_from_unit_type_name_matches_directly():
    assert _hero_from_unit_type_name("HeroLiMing") == "Li-Ming"
    assert _hero_from_unit_type_name("HeroMalfurion") == "Malfurion"


def test_hero_from_unit_type_name_uses_overrides_for_pre_rename_internal_names():
    # Several early-roster heroes kept their original class name as their
    # internal unit type (see `constants.UNIT_TYPE_HERO_OVERRIDES`).
    assert _hero_from_unit_type_name("HeroBarbarian") == "Sonya"
    assert _hero_from_unit_type_name("HeroWizard") == "Li-Ming"
    assert _hero_from_unit_type_name("HeroL90ETC") == "E.T.C."
    assert _hero_from_unit_type_name("HeroBaleog") == "The Lost Vikings"
    assert _hero_from_unit_type_name("HeroErik") == "The Lost Vikings"
    assert _hero_from_unit_type_name("HeroOlaf") == "The Lost Vikings"


def test_hero_from_unit_type_name_requires_the_hero_prefix():
    assert _hero_from_unit_type_name("LiMing") is None
    assert _hero_from_unit_type_name("SomeOtherUnit") is None


def test_hero_from_unit_spawn_by_toon_keys_by_tracker_player_id():
    tracker_id_to_toon = {1: "1-Hero-1-1001", 2: "1-Hero-1-1002"}
    events = [
        _unit_born_event(1, "HeroLiMing"),
        _unit_born_event(2, "HeroMalfurion"),
        # A respawn after death fires another SUnitBornEvent with the same
        # unit type name -- must not override the first (harmless either
        # way here, but proves the "first occurrence wins" dedup works).
        _unit_born_event(1, "HeroLiMing"),
    ]

    assert _hero_from_unit_spawn_by_toon(events, tracker_id_to_toon) == {
        "1-Hero-1-1001": "Li-Ming",
        "1-Hero-1-1002": "Malfurion",
    }


def test_attribute_scope_by_player_list_index_skips_open_slots():
    # Scope 2 is an unfilled ("open") lobby slot between two real players --
    # the 2nd real player's scope (3) must map to `m_playerList` position 2,
    # not 3. Mirrors Heroes.ReplayParser's `ApplyAttributes` adjustment.
    attributes_events = {
        "scopes": {
            1: {500: [{"value": b"humn"}]},
            2: {500: [{"value": b"open"}]},
            3: {500: [{"value": b"humn"}]},
        }
    }

    assert _attribute_scope_by_player_list_index(attributes_events, player_count=2) == {1: 1, 2: 3}


def test_attribute_scope_by_player_list_index_falls_back_to_identity_without_player_type_data():
    # Very old replay builds may not carry `PlayerTypeAttribute` (id 500)
    # at all -- assume a fully-filled lobby (scope N == position N) rather
    # than failing hero resolution outright.
    attributes_events = {"scopes": {1: {4002: [{"value": b"Wiza"}]}, 2: {4002: [{"value": b"Malf"}]}}}

    assert _attribute_scope_by_player_list_index(attributes_events, player_count=2) == {1: 1, 2: 2}


def test_has_computer_player_attribute_true_when_any_scope_is_comp():
    attributes_events = {
        "scopes": {
            1: {500: [{"value": b"humn"}]},
            2: {500: [{"value": b"comp"}]},
        }
    }
    assert _has_computer_player_attribute(attributes_events) is True


def test_has_computer_player_attribute_false_for_all_human_lobby():
    attributes_events = {
        "scopes": {
            1: {500: [{"value": b"humn"}]},
            2: {500: [{"value": b"humn"}]},
        }
    }
    assert _has_computer_player_attribute(attributes_events) is False


def test_has_computer_player_attribute_ignores_open_slots():
    attributes_events = {"scopes": {1: {500: [{"value": b"humn"}]}, 2: {500: [{"value": b"open"}]}}}
    assert _has_computer_player_attribute(attributes_events) is False


def test_has_computer_player_attribute_false_without_player_type_data():
    # Very old replay builds (or the synthetic fixtures elsewhere in this
    # file, which only set HeroAttributeId) may carry no PlayerTypeAttribute
    # at all -- must not be treated as "found a computer player".
    attributes_events = {"scopes": {1: {4002: [{"value": b"Wiza"}]}}}
    assert _has_computer_player_attribute(attributes_events) is False
