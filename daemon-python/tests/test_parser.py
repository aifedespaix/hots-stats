import datetime as dt

import pytest

from src.parser import ReplayParseError, _slugify, _toon_handle, _windows_filetime_to_iso8601, build_payload


def _filetime(iso: str) -> int:
    seconds = dt.datetime.fromisoformat(iso).replace(tzinfo=dt.timezone.utc).timestamp()
    return round((seconds + 11_644_473_600) * 10_000_000)


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
                "m_hero": b"Wiza",
                "m_teamId": 0,
            },
            {
                "m_name": b"Bar",
                "m_toon": {"m_region": 1, "m_programId": b"Hero", "m_realm": 1, "m_id": 1002},
                "m_hero": b"Malf",
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


def _battletags() -> dict[str, str]:
    return {"1-Hero-1-1001": "Foo#1111", "1-Hero-1-1002": "Bar#2222"}


def _header(elapsed_loops: int) -> dict:
    return {"m_elapsedGameLoops": elapsed_loops}


def test_build_payload_happy_path():
    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=_base_tracker_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    assert payload["replayHash"] == "a" * 64
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
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    players_by_tag = {p["battletag"]: p for p in payload["players"]}
    assert players_by_tag["Foo#1111"]["minionKills"] == 12
    assert players_by_tag["Bar#2222"]["minionKills"] == 7


def test_build_payload_unknown_ammid_falls_back_to_custom():
    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(amm_id=999999),
        tracker_events=_base_tracker_events(),
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
            battletags=_battletags(),
            replay_hash="a" * 64,
        )


def test_build_payload_rejects_unknown_hero():
    details = _details()
    details["m_playerList"][0]["m_hero"] = b"ZZZZ"

    with pytest.raises(ReplayParseError, match="hero"):
        build_payload(
            header=_header(610 + 16 * 600),
            details=details,
            initdata=_initdata(),
            tracker_events=_base_tracker_events(),
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
            battletags={},
            replay_hash="a" * 64,
        )
