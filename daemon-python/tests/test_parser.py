import datetime as dt

import pytest

from src._protocol_versions import KNOWN_PROTOCOL_BUILDS
from src.parser import (
    ReplayParseError,
    _attribute_scope_by_player_list_index,
    _build_protocol,
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

    with pytest.raises(ReplayParseError, match="computer"):
        build_payload(
            header=_header(610 + 16 * 600),
            details=_details(),
            initdata=_initdata(),
            tracker_events=events,
            attributes_events=_base_attributes_events(),
            battletags=_battletags(),
            replay_hash="a" * 64,
        )


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


def test_build_payload_rejects_incomplete_game():
    events = [e for e in _base_tracker_events() if not (e.get("m_eventName") == b"EndOfGameTalentChoices")]

    with pytest.raises(ReplayParseError, match="result missing"):
        build_payload(
            header=_header(610 + 16 * 600),
            details=_details(),
            initdata=_initdata(),
            tracker_events=events,
            attributes_events=_base_attributes_events(),
            battletags=_battletags(),
            replay_hash="a" * 64,
        )


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
    # GAME_MODE_BY_AMM_ID and silently fell back to "Custom".
    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(amm_id=50101),
        tracker_events=_base_tracker_events(),
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    assert payload["gameMode"] == "ARAM"


def test_build_payload_resolves_hero_by_player_list_position_not_tracker_id():
    """Regression test: a player's hero must be resolved by their
    `m_playerList` position, not by whichever tracker id `PlayerInit`
    happened to assign them -- the two numberings aren't guaranteed to
    match (see `_attribute_scope_by_player_list_index`). Here `PlayerInit`
    fires in the *reverse* of `m_playerList` order (Foo, listed first, gets
    tracker id 2; Bar, listed second, gets tracker id 1), while the
    attribute-events scopes still follow plain `m_playerList` order
    (scope 1 = Foo = Li-Ming, scope 2 = Bar = Malfurion). The previous
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
