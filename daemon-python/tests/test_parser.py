import datetime as dt

import pytest

from src import constants
from src._protocol_versions import KNOWN_PROTOCOL_BUILDS
from src.parser import (
    ReplayParseError,
    ReplaySkipped,
    _attribute_scope_by_player_list_index,
    _build_protocol,
    _collect_calibration_samples,
    _distribute_segment_across_cells,
    _extract_deaths,
    _extract_level_snapshots,
    _extract_spatial,
    _extract_structure_events,
    _extract_trajectories,
    _game_version,
    _has_computer_player_attribute,
    _hero_from_any_talent,
    _hero_from_talent_prefix,
    _hero_from_unit_spawn_by_toon,
    _hero_from_unit_type_name,
    _hero_unit_tags_by_toon,
    _iter_unit_positions,
    _normalized_position_samples_by_toon,
    _position_at_or_before,
    _presence_seconds_by_cell,
    _protocol_module,
    _read_archive_file,
    _slugify,
    _structure_type_from_unit_type_name,
    _structure_unit_teams_by_tag,
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


def test_game_version_formats_major_minor_revision_base_build():
    # baseBuild, not the sibling m_build -- see _game_version's docstring.
    header = {"m_version": {"m_major": 2, "m_minor": 55, "m_revision": 15, "m_build": 999999, "m_baseBuild": 96477}}
    assert _game_version(header) == "2.55.15.96477"


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


def _unit_born_event(
    control_player_id: int,
    unit_type_name: str,
    *,
    unit_tag_index: int | None = None,
    unit_tag_recycle: int = 0,
) -> dict:
    return {
        "_event": "NNet.Replay.Tracker.SUnitBornEvent",
        "m_controlPlayerId": control_player_id,
        "m_unitTypeName": unit_type_name.encode(),
        # Defaults to `control_player_id` (distinct per call site in every
        # existing test that doesn't care about tags) rather than a fixed
        # constant, so two heroes born in the same test don't collide on the
        # same tag by accident.
        "m_unitTagIndex": control_player_id if unit_tag_index is None else unit_tag_index,
        "m_unitTagRecycle": unit_tag_recycle,
    }


def _unit_died_event(
    unit_tag_index: int, gameloop: int, *, unit_tag_recycle: int = 0, killer_player_id: int | None = None
) -> dict:
    event: dict = {
        "_event": "NNet.Replay.Tracker.SUnitDiedEvent",
        "m_unitTagIndex": unit_tag_index,
        "m_unitTagRecycle": unit_tag_recycle,
        "_gameloop": gameloop,
    }
    if killer_player_id is not None:
        event["m_killerPlayerId"] = killer_player_id
    return event


def _unit_positions_event(gameloop: int, positions: list[tuple[int, float, float]]) -> dict:
    """`positions` is `(unit_tag_index, x, y)` in *absolute* tag-index terms
    -- encoded here into the delta-encoded `m_items` flat list
    `_iter_unit_positions` expects (see that function's docstring for why
    this shape is a hypothesis, not a confirmed one, pending a real
    replay)."""
    items: list[float] = []
    previous_tag = 0
    for tag_index, x, y in positions:
        items.extend([tag_index - previous_tag, x, y])
        previous_tag = tag_index
    return {
        "_event": "NNet.Replay.Tracker.SUnitPositionsEvent",
        "_gameloop": gameloop,
        "m_firstUnitIndex": 0,
        "m_items": items,
    }


def _level_up_event(tracker_id: int, level: int, gameloop: int) -> dict:
    return {
        "_event": "NNet.Replay.Tracker.SStatGameEvent",
        "m_eventName": b"LevelUp",
        "m_intData": [{"m_key": b"PlayerID", "m_value": tracker_id}, {"m_key": b"Level", "m_value": level}],
        "_gameloop": gameloop,
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


def _header(
    elapsed_loops: int,
    base_build: int = 12345,
    *,
    major: int = 2,
    minor: int = 55,
    revision: int = 15,
) -> dict:
    return {
        "m_elapsedGameLoops": elapsed_loops,
        "m_version": {"m_baseBuild": base_build, "m_major": major, "m_minor": minor, "m_revision": revision},
    }


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
    assert payload["gameVersion"] == "2.55.15.12345"
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


def test_build_payload_reads_the_latest_score_snapshot_not_the_first():
    """A player's slot in `SScoreResultEvent.m_instanceList[].m_values[]` is a
    `{m_value, m_time}` time series -- seeded with a baseline zero entry at
    game start and appended to every time the stat changes (see
    `_apply_score_event`'s comment) -- not a single scalar. Reading `[0]`
    instead of `[-1]` would silently record that baseline zero instead of
    the final tally for a stat pushed more than once over a real match,
    which is exactly what happens to kills/deaths/assists in any match with
    real combat."""
    solo_kill_event = {
        "m_name": b"SoloKill",
        "m_values": [
            # Foo (index 1): baseline 0, then two real increments up to 5.
            [{"m_value": 0}, {"m_value": 3}, {"m_value": 5}],
            # Bar (index 2): a single snapshot -- still correctly read either way.
            [{"m_value": 6}],
        ],
    }
    other_stats_event = {
        "_event": "NNet.Replay.Tracker.SScoreResultEvent",
        "m_instanceList": [
            {"m_name": name.encode(), "m_values": [[{"m_value": v}] for v in values]}
            for name, values in REQUIRED_STATS.items()
            if name != "SoloKill"
        ],
    }
    other_stats_event["m_instanceList"].append(solo_kill_event)

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=[
            *_base_tracker_events()[:3],
            other_stats_event,
            *_base_tracker_events()[4:],
        ],
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    players_by_tag = {p["battletag"]: p for p in payload["players"]}
    assert players_by_tag["Foo#1111"]["kills"] == 5
    assert players_by_tag["Bar#2222"]["kills"] == 6


def test_build_payload_a_players_untouched_stat_does_not_desync_the_next_players_index():
    """`m_values` is positional -- slot i corresponds to tracker id i, and is
    an empty list when that player never touched the stat at all (not just
    for a bot/open lobby slot). The previous approach only advanced its
    position counter on a non-empty slot, so a real player's genuinely
    untouched stat (an assassin's 0 SiegeDamage, a specialist's 0 healing,
    ...) desynced every following player's index by one, attributing their
    value to the *previous* player instead. Confirmed against a real match
    where this produced siege damage stuck at 0 for every single player and
    an identical experience-contribution value duplicated across a whole
    team."""
    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=[
            *_base_tracker_events()[:3],
            {
                "_event": "NNet.Replay.Tracker.SScoreResultEvent",
                "m_instanceList": [
                    {"m_name": name.encode(), "m_values": [[{"m_value": v}] for v in values]}
                    for name, values in REQUIRED_STATS.items()
                ]
                + [
                    {
                        "m_name": b"CreepDamage",
                        "m_values": [
                            [],  # Foo (index 1): never touched this stat.
                            [{"m_value": 4200}],  # Bar (index 2): the real value.
                        ],
                    }
                ],
            },
            *_base_tracker_events()[4:],
        ],
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    players_by_tag = {p["battletag"]: p for p in payload["players"]}
    assert "creepDamage" not in players_by_tag["Foo#1111"]
    assert players_by_tag["Bar#2222"]["creepDamage"] == 4200


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


def test_build_payload_rejects_all_zero_score_event_as_corrupt():
    """Regression test: a replay whose `m_baseBuild` is newer than every
    known `heroprotocol` decoder can still decode `SScoreResultEvent`
    without raising, but with every player's stats stuck at each field's
    baseline 0 -- observed on real matches in 2026-08. Must fail loudly
    instead of silently ingesting a payload of zeros."""
    zero_stats = {name: [0, 0] for name in REQUIRED_STATS}
    events = [e if e.get("_event") != "NNet.Replay.Tracker.SScoreResultEvent" else _score_event(zero_stats) for e in _base_tracker_events()]

    with pytest.raises(ReplayParseError, match="all-zero"):
        build_payload(
            header=_header(610 + 16 * 600),
            details=_details(),
            initdata=_initdata(),
            tracker_events=events,
            attributes_events=_base_attributes_events(),
            battletags=_battletags(),
            replay_hash="a" * 64,
        )


def test_build_payload_allows_all_zero_score_event_below_the_duration_floor():
    """A short match can legitimately end with every stat still at 0 (e.g.
    abandoned moments after loading in) -- only gated above
    `_MIN_DURATION_FOR_ZERO_SCORE_CHECK_SECONDS`."""
    zero_stats = {name: [0, 0] for name in REQUIRED_STATS}
    events = [e if e.get("_event") != "NNet.Replay.Tracker.SScoreResultEvent" else _score_event(zero_stats) for e in _base_tracker_events()]

    payload = build_payload(
        header=_header(610 + 16 * 60),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )
    assert payload["durationSeconds"] == 60
    assert all(p["heroDamage"] == 0 for p in payload["players"])


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


def test_build_payload_resolves_aram_hero_with_no_name_relation_to_unit_type():
    """Regression test (PARSER_VERSION 1.10): before `UNIT_TYPE_HERO_OVERRIDES`
    gained Qhira ("HeroNexusHunter") and Lt. Morales ("HeroMedic"), an ARAM
    replay with either of them failed outright with "Could not determine
    hero" -- confirmed against real replays (see that override's changelog
    entry) -- since talent ids don't match their display name either
    ("NexusHunter.../Medic..."), and ARAM never falls back to the unreliable
    `HeroAttributeId` (see `test_build_payload_aram_never_falls_back_to_hero_attribute`)."""
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroNexusHunter"),
        _unit_born_event(2, "HeroMedic"),
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

    players_by_tag = {p["battletag"]: p for p in payload["players"]}
    assert players_by_tag["Foo#1111"]["heroId"] == "qhira"
    assert players_by_tag["Bar#2222"]["heroId"] == "lt-morales"


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
    assert _hero_from_unit_type_name("HeroLostVikingsController") == "The Lost Vikings"


def test_hero_from_unit_type_name_uses_overrides_found_against_real_replays():
    # Regression test (PARSER_VERSION 1.10): found by running the parser
    # against ~70 real replays -- these six heroes' unit type name shares no
    # prefix with their display name either, same shape as the pre-rename
    # cases above but discovered later. Qhira/Cassia/Lunara/Lt. Morales's
    # talent ids have the same mismatch (see `_hero_from_talent_prefix`),
    # which made every ARAM replay containing one of them fail outright.
    assert _hero_from_unit_type_name("HeroNexusHunter") == "Qhira"
    assert _hero_from_unit_type_name("HeroAmazon") == "Cassia"
    assert _hero_from_unit_type_name("HeroDryad") == "Lunara"
    assert _hero_from_unit_type_name("HeroMedic") == "Lt. Morales"
    assert _hero_from_unit_type_name("HeroFaerieDragon") == "Brightwing"
    assert _hero_from_unit_type_name("HeroFirebat") == "Blaze"
    # Gazlowe's talent ids already resolve him via the normal prefix match
    # ("Gazlowe...") -- this only fixes his *unit-spawn* resolution
    # specifically, which death-timeline attribution also depends on.
    assert _hero_from_unit_type_name("HeroTinker") == "Gazlowe"


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


def test_hero_unit_tags_by_toon_ignores_non_hero_units():
    tracker_id_to_toon = {1: "1-Hero-1-1001"}
    events = [
        _unit_born_event(1, "HeroLiMing", unit_tag_index=5),
        {
            "_event": "NNet.Replay.Tracker.SUnitBornEvent",
            "m_controlPlayerId": 1,
            "m_unitTypeName": b"NexusMinion",
            "m_unitTagIndex": 6,
            "m_unitTagRecycle": 0,
        },
    ]
    assert _hero_unit_tags_by_toon(events, tracker_id_to_toon) == {(5, 0): "1-Hero-1-1001"}


def test_hero_unit_tags_by_toon_keeps_every_tag_not_just_the_first():
    # The Lost Vikings control three independently-tagged hero units at
    # once -- unlike `_hero_from_unit_spawn_by_toon` (hero-name resolution,
    # where any one of the three answers the same question), every tag must
    # resolve back to the player for death tracking to work for all three.
    tracker_id_to_toon = {1: "1-Hero-1-1001"}
    events = [
        _unit_born_event(1, "HeroBaleog", unit_tag_index=10),
        _unit_born_event(1, "HeroErik", unit_tag_index=11),
        _unit_born_event(1, "HeroOlaf", unit_tag_index=12),
    ]
    assert _hero_unit_tags_by_toon(events, tracker_id_to_toon) == {
        (10, 0): "1-Hero-1-1001",
        (11, 0): "1-Hero-1-1001",
        (12, 0): "1-Hero-1-1001",
    }


def test_extract_deaths_skips_unresolvable_tags():
    events = [_unit_died_event(999, 700)]
    assert (
        _extract_deaths(
            events, hero_unit_tags={}, tracker_id_to_toon={}, players={}, gates_open_loop=0, calibrations=None
        )
        == []
    )


def test_extract_level_snapshots_skips_unknown_tracker_id():
    events = [_level_up_event(99, 2, 700)]
    assert _extract_level_snapshots(events, tracker_id_to_toon={}, players={}, gates_open_loop=0) == []


def test_build_payload_extracts_deaths_timeline():
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroLiMing"),
        _unit_born_event(2, "HeroMalfurion"),
        _unit_died_event(1, 610 + 16 * 30),  # Foo's Li-Ming dies 30s after gates open
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

    assert payload["timeline"]["deaths"] == [
        {"battletag": "Foo#1111", "team": 0, "atSeconds": 30, "killers": [], "killType": "other"}
    ]
    assert payload["timeline"]["levelSnapshots"] == []


def test_build_payload_ignores_non_hero_unit_deaths():
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroLiMing"),
        {
            "_event": "NNet.Replay.Tracker.SUnitBornEvent",
            "m_controlPlayerId": 1,
            "m_unitTypeName": b"NexusMinion",
            "m_unitTagIndex": 99,
            "m_unitTagRecycle": 0,
        },
        _unit_died_event(99, 610 + 16 * 10),  # the minion, not the hero
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

    assert payload["timeline"]["deaths"] == []


def test_build_payload_resolves_hero_deaths_after_respawn_same_tag():
    """A hero keeps the same unit tag across a respawn (see
    `_hero_unit_tags_by_toon`'s docstring) -- a second death on the same tag
    must resolve to the same player, at its own timestamp."""
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroLiMing", unit_tag_index=42),
        _unit_died_event(42, 610 + 16 * 30),
        _unit_died_event(42, 610 + 16 * 90),
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

    assert payload["timeline"]["deaths"] == [
        {"battletag": "Foo#1111", "team": 0, "atSeconds": 30, "killers": [], "killType": "other"},
        {"battletag": "Foo#1111", "team": 0, "atSeconds": 90, "killers": [], "killType": "other"},
    ]


def test_build_payload_extracts_level_snapshots_timeline():
    events = [
        *_base_tracker_events(),
        _level_up_event(1, 2, 610 + 16 * 45),
        _level_up_event(2, 2, 610 + 16 * 45),
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

    assert payload["timeline"]["levelSnapshots"] == [
        {"battletag": "Foo#1111", "atSeconds": 45, "level": 2},
        {"battletag": "Bar#2222", "atSeconds": 45, "level": 2},
    ]


def test_build_payload_timeline_defaults_to_empty_lists():
    # No SUnitBornEvent/SUnitDiedEvent/LevelUp events at all in the base
    # fixture -- `timeline` must still be present with empty arrays, not
    # omitted, so the API layer can tell "no timeline events occurred" apart
    # from "this payload predates the timeline feature" (the latter simply
    # won't have the key at all, from an un-upgraded daemon).
    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=_base_tracker_events(),
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    assert payload["timeline"] == {"deaths": [], "levelSnapshots": [], "structureEvents": []}


def test_iter_unit_positions_decodes_delta_encoded_tags():
    events = [_unit_positions_event(100, [(5, 1.0, 2.0), (7, 3.0, 4.0), (5, 5.0, 6.0)])]

    assert list(_iter_unit_positions(events)) == [
        (100, 5, 1.0, 2.0),
        (100, 7, 3.0, 4.0),
        (100, 5, 5.0, 6.0),
    ]


def test_collect_calibration_samples_returns_empty_without_position_events():
    assert _collect_calibration_samples(_base_tracker_events(), tracker_id_to_toon={}) == []


def test_collect_calibration_samples_subsamples_evenly_above_target():
    tracker_id_to_toon = {1: "1-Hero-1-1001"}
    points = [(float(i), float(i)) for i in range(10)]
    events = [
        _unit_born_event(1, "HeroLiMing", unit_tag_index=1),
        _unit_positions_event(100, [(1, x, y) for x, y in points]),
    ]

    sampled = _collect_calibration_samples(events, tracker_id_to_toon, target_count=5)

    assert len(sampled) == 5
    # Spread across the whole range, not front-loaded from the first 5 points.
    assert sampled[0]["x"] == 0.0
    assert sampled[-1]["x"] == 8.0


def test_collect_calibration_samples_returns_every_point_below_target():
    tracker_id_to_toon = {1: "1-Hero-1-1001", 2: "1-Hero-1-1002"}
    events = [
        _unit_born_event(1, "HeroLiMing", unit_tag_index=1),
        _unit_born_event(2, "HeroMalfurion", unit_tag_index=2),
        _unit_positions_event(100, [(1, 1.0, 1.0), (2, 2.0, 2.0)]),
    ]

    sampled = _collect_calibration_samples(events, tracker_id_to_toon, target_count=1000)

    assert sampled == [{"x": 1.0, "y": 1.0}, {"x": 2.0, "y": 2.0}]


def test_collect_calibration_samples_excludes_non_hero_units():
    tracker_id_to_toon = {1: "1-Hero-1-1001"}
    events = [
        _unit_born_event(1, "HeroLiMing", unit_tag_index=1),
        # Tag 99 never appears in a SUnitBornEvent for a hero -- stands in
        # for a structure/altar/minion position, which SUnitPositionsEvent
        # reports for every trackable unit, not just heroes.
        _unit_positions_event(100, [(1, 10.0, 10.0), (99, 500.0, 500.0)]),
    ]

    sampled = _collect_calibration_samples(events, tracker_id_to_toon)

    assert sampled == [{"x": 10.0, "y": 10.0}]


def test_build_payload_includes_spatial_block_for_calibrated_map():
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroLiMing"),
        _unit_born_event(2, "HeroMalfurion"),
        _unit_positions_event(610, [(1, 10.0, 10.0), (2, 90.0, 90.0)]),
        _unit_positions_event(610 + 16 * 10, [(1, 10.0, 10.0), (2, 90.0, 90.0)]),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
        calibrations_by_map={"cursed-hollow": {"": {"minX": 0.0, "maxX": 100.0, "minY": 0.0, "maxY": 100.0}}},
    )

    assert "_pendingSpatialSample" not in payload
    spatial = payload["spatial"]
    assert spatial["schemaVersion"] == constants.SPATIAL_SCHEMA_VERSION
    assert spatial["grid"] == {"cols": constants.SPATIAL_GRID_COLS, "rows": constants.SPATIAL_GRID_ROWS}

    presence_by_tag = {p["battletag"]: p for p in spatial["presence"]}
    foo = presence_by_tag["Foo#1111"]
    assert foo["heroId"] == "li-ming"
    assert foo["layer"] is None
    # Both samples land in the same grid cell -- one cell, 10s between them.
    assert foo["cellIndex"] == sorted(foo["cellIndex"])
    assert len(foo["cellIndex"]) == 1
    assert foo["secondsInCell"] == pytest.approx([10.0])


def test_extract_spatial_splits_one_hero_across_two_layers():
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroLiMing"),
        # Two samples in the default ("") layer's bounds, two more in
        # "bottom"'s -- `_presence_seconds_by_cell` only credits a segment
        # *between* two same-layer samples, so a layer needs at least a pair
        # to show up in `presence[]` at all (a single sample there would be
        # silently dropped, same as it already is for the default layer).
        _unit_positions_event(610, [(1, 10.0, 10.0)]),
        _unit_positions_event(610 + 16 * 10, [(1, 20.0, 20.0)]),
        _unit_positions_event(610 + 16 * 20, [(1, 1010.0, 1010.0)]),
        _unit_positions_event(610 + 16 * 30, [(1, 1020.0, 1020.0)]),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
        calibrations_by_map={
            "cursed-hollow": {
                "": {"minX": 0.0, "maxX": 100.0, "minY": 0.0, "maxY": 100.0},
                "bottom": {"minX": 1000.0, "maxX": 1100.0, "minY": 1000.0, "maxY": 1100.0},
            }
        },
    )

    entries = [p for p in payload["spatial"]["presence"] if p["battletag"] == "Foo#1111"]
    layers = {e["layer"] for e in entries}
    assert layers == {None, "bottom"}
    default_entry = next(e for e in entries if e["layer"] is None)
    bottom_entry = next(e for e in entries if e["layer"] == "bottom")
    assert sum(default_entry["secondsInCell"]) == pytest.approx(10.0, abs=0.1)
    assert bottom_entry["cellIndex"]


def test_extract_deaths_tags_death_layer():
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroLiMing"),
        _unit_positions_event(610, [(1, 1010.0, 1010.0)]),
        _unit_died_event(1, 610 + 16 * 5),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
        calibrations_by_map={
            "cursed-hollow": {
                "": {"minX": 0.0, "maxX": 100.0, "minY": 0.0, "maxY": 100.0},
                "bottom": {"minX": 1000.0, "maxX": 1100.0, "minY": 1000.0, "maxY": 1100.0},
            }
        },
    )

    death = next(d for d in payload["timeline"]["deaths"] if d["battletag"] == "Foo#1111")
    assert death["layer"] == "bottom"


def test_build_payload_collects_calibration_sample_for_unmapped_map():
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroLiMing"),
        _unit_born_event(2, "HeroMalfurion"),
        _unit_positions_event(610, [(1, 10.0, 10.0), (2, 90.0, 90.0)]),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
        calibrations_by_map={},  # no entry for "cursed-hollow"
    )

    assert "spatial" not in payload
    pending = payload["_pendingSpatialSample"]
    assert pending["mapId"] == "cursed-hollow"
    assert {"x": 10.0, "y": 10.0} in pending["points"]
    assert {"x": 90.0, "y": 90.0} in pending["points"]


def test_build_payload_excludes_non_hero_positions_from_calibration_sample():
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroLiMing"),
        _unit_born_event(2, "HeroMalfurion"),
        _unit_positions_event(610, [(1, 10.0, 10.0), (2, 90.0, 90.0), (99, 5000.0, 5000.0)]),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
        calibrations_by_map={},  # no entry for "cursed-hollow"
    )

    pending = payload["_pendingSpatialSample"]
    assert {"x": 10.0, "y": 10.0} in pending["points"]
    assert {"x": 90.0, "y": 90.0} in pending["points"]
    assert {"x": 5000.0, "y": 5000.0} not in pending["points"]


def test_build_payload_omits_spatial_without_any_position_events():
    # No `calibrations` passed at all, and no SUnitPositionsEvent in the
    # fixture -- an older-build daemon calling `build_payload` the old way,
    # or any replay this event just doesn't exist in. Neither key should
    # appear; this must never be an error.
    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=_base_tracker_events(),
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
    )

    assert "spatial" not in payload
    assert "_pendingSpatialSample" not in payload


def test_distribute_segment_across_cells_same_cell_returns_single_share():
    assert _distribute_segment_across_cells(0.05, 0.05, 0.08, 0.08, cols=10, rows=10) == {0: 1.0}


def test_distribute_segment_across_cells_splits_across_crossed_cells():
    shares = _distribute_segment_across_cells(0.05, 0.05, 0.95, 0.05, cols=10, rows=10)

    assert sum(shares.values()) == pytest.approx(1.0, abs=0.05)
    assert 0 in shares  # starting cell (col 0, row 0)
    assert 9 in shares  # ending cell (col 9, row 0)
    assert len(shares) > 2  # crosses intermediate cells too, not just start/end


def test_presence_seconds_by_cell_interpolates_between_samples():
    # 10s spent moving steadily from cell (0,0) to (9,0) on a 10x10 grid --
    # below the teleport threshold (0.9 normalized distance / 10s = 0.09 <
    # SPATIAL_MAX_INTERPOLATION_SPEED_NORMALIZED's 0.10).
    samples = [(0, 0.05, 0.05), (160, 0.95, 0.05)]

    cells = _presence_seconds_by_cell(samples, cols=10, rows=10)

    assert sum(cells.values()) == pytest.approx(10.0, abs=0.5)
    assert len(cells) > 1  # filled intermediate cells, not just the arrival one


def test_presence_seconds_by_cell_drops_teleport_gaps():
    # Crossing 90% of the map in 1s is far above the interpolation threshold.
    samples = [(0, 0.0, 0.0), (16, 0.9, 0.9)]

    assert _presence_seconds_by_cell(samples, cols=10, rows=10) == {}


def test_presence_seconds_by_cell_ignores_out_of_order_zero_or_negative_gaps():
    # Two samples at the exact same gameloop (or, defensively, an
    # out-of-order pair) contribute nothing rather than dividing by zero.
    samples = [(100, 0.1, 0.1), (100, 0.2, 0.2)]

    assert _presence_seconds_by_cell(samples, cols=10, rows=10) == {}


def test_position_at_or_before_returns_the_latest_sample_not_after_gameloop():
    samples = [(0, None, 0.1, 0.1), (160, None, 0.2, 0.2), (320, None, 0.3, 0.3)]

    assert _position_at_or_before(samples, 200) == (None, 0.2, 0.2)
    assert _position_at_or_before(samples, 320) == (None, 0.3, 0.3)
    assert _position_at_or_before(samples, -1) is None


def test_normalized_position_samples_by_toon_sorts_and_drops_out_of_bounds():
    calibrations = {"": {"minX": 0.0, "maxX": 100.0, "minY": 0.0, "maxY": 100.0}}
    events = [
        _unit_positions_event(160, [(1, 50.0, 50.0)]),
        _unit_positions_event(0, [(1, 10.0, 10.0), (1, -50.0, -50.0)]),  # out-of-bounds point dropped
        _unit_born_event(1, "HeroLiMing"),
    ]

    samples = _normalized_position_samples_by_toon(
        events, tracker_id_to_toon={1: "1-Hero-1-1001"}, calibrations=calibrations
    )

    assert samples["1-Hero-1-1001"] == [(0, None, 0.1, 0.1), (160, None, 0.5, 0.5)]


def test_extract_spatial_returns_none_for_degenerate_calibration():
    calibrations = {"": {"minX": 50.0, "maxX": 50.0, "minY": 0.0, "maxY": 100.0}}
    events = [_unit_positions_event(0, [(1, 10.0, 10.0)])]

    assert _extract_spatial(events, tracker_id_to_toon={}, players={}, calibrations=calibrations) is None


def test_extract_deaths_derives_position_from_last_known_sample():
    players = {"toon-1": {"battletag": "Foo#1111", "team": 0, "heroId": "li-ming"}}
    hero_unit_tags = {(1, 0): "toon-1"}
    tracker_id_to_toon = {1: "toon-1"}
    calibrations = {"": {"minX": 0.0, "maxX": 100.0, "minY": 0.0, "maxY": 100.0}}
    events = [
        # `_normalized_position_samples_by_toon` (unlike `hero_unit_tags`
        # above) resolves tag -> toon via a real SUnitBornEvent scan, not
        # the dict passed in -- needed here for the death's position lookup.
        _unit_born_event(1, "HeroLiMing"),
        _unit_positions_event(0, [(1, 10.0, 10.0)]),
        _unit_positions_event(160, [(1, 20.0, 20.0)]),  # 10s later
        _unit_died_event(1, 200),  # dies shortly after the second sample
    ]

    deaths = _extract_deaths(
        events, hero_unit_tags, tracker_id_to_toon, players, gates_open_loop=0, calibrations=calibrations
    )

    assert len(deaths) == 1
    assert deaths[0]["x"] == pytest.approx(0.2)
    assert deaths[0]["y"] == pytest.approx(0.2)


def test_extract_deaths_omits_position_without_calibration():
    players = {"toon-1": {"battletag": "Foo#1111", "team": 0, "heroId": "li-ming"}}
    hero_unit_tags = {(1, 0): "toon-1"}
    tracker_id_to_toon = {1: "toon-1"}
    events = [_unit_positions_event(0, [(1, 10.0, 10.0)]), _unit_died_event(1, 200)]

    deaths = _extract_deaths(
        events, hero_unit_tags, tracker_id_to_toon, players, gates_open_loop=0, calibrations=None
    )

    assert "x" not in deaths[0]
    assert "y" not in deaths[0]


def test_extract_deaths_attributes_killer_when_resolvable():
    players = {
        "toon-1": {"battletag": "Foo#1111", "team": 0, "heroId": "li-ming"},
        "toon-2": {"battletag": "Bar#2222", "team": 1, "heroId": "malfurion"},
    }
    hero_unit_tags = {(1, 0): "toon-1"}
    tracker_id_to_toon = {1: "toon-1", 2: "toon-2"}
    events = [_unit_died_event(1, 200, killer_player_id=2)]

    deaths = _extract_deaths(
        events, hero_unit_tags, tracker_id_to_toon, players, gates_open_loop=0, calibrations=None
    )

    assert deaths[0]["killers"] == ["Bar#2222"]
    assert deaths[0]["killType"] == "hero"


def test_extract_deaths_kill_type_other_without_a_resolvable_killer():
    players = {"toon-1": {"battletag": "Foo#1111", "team": 0, "heroId": "li-ming"}}
    hero_unit_tags = {(1, 0): "toon-1"}
    events = [_unit_died_event(1, 200)]  # no killer_player_id at all

    deaths = _extract_deaths(
        events, hero_unit_tags, tracker_id_to_toon={}, players=players, gates_open_loop=0, calibrations=None
    )

    assert deaths[0]["killers"] == []
    assert deaths[0]["killType"] == "other"


def test_build_payload_spatial_presence_interpolates_fast_movement():
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroLiMing"),
        _unit_born_event(2, "HeroMalfurion"),
        _unit_positions_event(610, [(1, 5.0, 5.0), (2, 90.0, 90.0)]),
        _unit_positions_event(610 + 16 * 10, [(1, 95.0, 5.0), (2, 90.0, 90.0)]),  # Foo crosses the map in 10s
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
        calibrations_by_map={"cursed-hollow": {"": {"minX": 0.0, "maxX": 100.0, "minY": 0.0, "maxY": 100.0}}},
    )

    presence_by_tag = {p["battletag"]: p for p in payload["spatial"]["presence"]}
    foo = presence_by_tag["Foo#1111"]
    assert len(foo["cellIndex"]) > 1  # filled intermediate cells, not just the arrival one
    assert sum(foo["secondsInCell"]) == pytest.approx(10.0, abs=1.0)


def test_build_payload_death_includes_position_and_killer():
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroLiMing"),
        _unit_born_event(2, "HeroMalfurion"),
        _unit_positions_event(610, [(1, 50.0, 50.0)]),
        _unit_died_event(1, 610 + 16 * 5, killer_player_id=2),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
        calibrations_by_map={"cursed-hollow": {"": {"minX": 0.0, "maxX": 100.0, "minY": 0.0, "maxY": 100.0}}},
    )

    death = payload["timeline"]["deaths"][0]
    assert death["x"] == pytest.approx(0.5)
    assert death["y"] == pytest.approx(0.5)
    assert death["killers"] == ["Bar#2222"]
    assert death["killType"] == "hero"


def test_structure_type_from_unit_type_name_matches_known_prefixes():
    assert _structure_type_from_unit_type_name("TownFortHeroesLegacy") == "fort"
    assert _structure_type_from_unit_type_name("TownKeepBlue") == "keep"
    assert _structure_type_from_unit_type_name("TownWallLeft") == "wall"
    assert _structure_type_from_unit_type_name("TownGateLeft") == "wall"
    assert _structure_type_from_unit_type_name("TownTownCore") == "core"
    assert _structure_type_from_unit_type_name("HeroLiMing") is None
    assert _structure_type_from_unit_type_name("NexusMinion") is None


def test_structure_unit_teams_by_tag_resolves_from_born_event():
    players = {"1-Hero-1-1001": {"battletag": "Foo#1111", "team": 0, "heroId": "li-ming"}}
    events = [_unit_born_event(1, "TownFort", unit_tag_index=200)]

    tags = _structure_unit_teams_by_tag(events, tracker_id_to_toon={1: "1-Hero-1-1001"}, players=players)

    assert tags == {(200, 0): ("fort", 0)}


def test_structure_unit_teams_by_tag_skips_non_structure_units():
    players = {"1-Hero-1-1001": {"battletag": "Foo#1111", "team": 0, "heroId": "li-ming"}}
    events = [_unit_born_event(1, "HeroLiMing", unit_tag_index=5)]

    assert _structure_unit_teams_by_tag(events, tracker_id_to_toon={1: "1-Hero-1-1001"}, players=players) == {}


def test_extract_structure_events_resolves_owning_team_and_type():
    events = [
        _unit_born_event(1, "TownFort", unit_tag_index=200),
        _unit_died_event(200, 610 + 16 * 300),
    ]
    players = {"1-Hero-1-1001": {"battletag": "Foo#1111", "team": 0, "heroId": "li-ming"}}

    result = _extract_structure_events(
        events, tracker_id_to_toon={1: "1-Hero-1-1001"}, players=players, gates_open_loop=610
    )

    assert result == [{"team": 0, "atSeconds": 300, "structureType": "fort"}]


def test_extract_structure_events_ignores_hero_deaths():
    events = [
        _unit_born_event(1, "HeroLiMing", unit_tag_index=5),
        _unit_died_event(5, 610 + 16 * 30),
    ]
    players = {"1-Hero-1-1001": {"battletag": "Foo#1111", "team": 0, "heroId": "li-ming"}}

    result = _extract_structure_events(
        events, tracker_id_to_toon={1: "1-Hero-1-1001"}, players=players, gates_open_loop=610
    )

    assert result == []


def test_extract_structure_events_skips_unresolvable_tags():
    events = [_unit_died_event(999, 700)]

    assert _extract_structure_events(events, tracker_id_to_toon={}, players={}, gates_open_loop=0) == []


def test_build_payload_includes_structure_events_for_fort_destruction():
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "TownFort", unit_tag_index=200),
        _unit_died_event(200, 610 + 16 * 300),
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

    assert payload["timeline"]["structureEvents"] == [{"team": 0, "atSeconds": 300, "structureType": "fort"}]


def test_extract_trajectories_downsamples_to_the_configured_interval():
    calibrations = {"": {"minX": 0.0, "maxX": 100.0, "minY": 0.0, "maxY": 100.0}}
    players = {"1-Hero-1-1001": {"battletag": "Foo#1111", "team": 0, "heroId": "li-ming"}}
    interval_loops = constants.SPATIAL_TRAJECTORY_SAMPLE_INTERVAL_SECONDS * 16
    events = [
        _unit_born_event(1, "HeroLiMing"),
        # Three samples spaced half an interval apart -- only the 1st and 3rd
        # should survive downsampling (the 2nd is too soon after the 1st).
        _unit_positions_event(0, [(1, 10.0, 10.0)]),
        _unit_positions_event(interval_loops // 2, [(1, 20.0, 20.0)]),
        _unit_positions_event(interval_loops, [(1, 30.0, 30.0)]),
    ]

    trajectories = _extract_trajectories(
        events, tracker_id_to_toon={1: "1-Hero-1-1001"}, players=players, calibrations=calibrations, gates_open_loop=0
    )

    assert len(trajectories) == 1
    foo = trajectories[0]
    assert foo["battletag"] == "Foo#1111"
    assert foo["heroId"] == "li-ming"
    assert foo["layer"] is None
    assert foo["atSeconds"] == [0, constants.SPATIAL_TRAJECTORY_SAMPLE_INTERVAL_SECONDS]
    assert foo["x"] == pytest.approx([0.1, 0.3])
    assert foo["y"] == pytest.approx([0.1, 0.3])


def test_extract_trajectories_returns_empty_without_position_events():
    calibrations = {"": {"minX": 0.0, "maxX": 100.0, "minY": 0.0, "maxY": 100.0}}

    assert (
        _extract_trajectories(
            _base_tracker_events(), tracker_id_to_toon={}, players={}, calibrations=calibrations, gates_open_loop=0
        )
        == []
    )


def test_build_payload_includes_trajectories_alongside_presence_grid():
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroLiMing"),
        _unit_born_event(2, "HeroMalfurion"),
        _unit_positions_event(610, [(1, 10.0, 10.0), (2, 90.0, 90.0)]),
        _unit_positions_event(610 + 16 * 10, [(1, 20.0, 20.0), (2, 90.0, 90.0)]),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
        calibrations_by_map={"cursed-hollow": {"": {"minX": 0.0, "maxX": 100.0, "minY": 0.0, "maxY": 100.0}}},
    )

    trajectories_by_tag = {t["battletag"]: t for t in payload["spatial"]["trajectories"]}
    foo = trajectories_by_tag["Foo#1111"]
    assert foo["atSeconds"] == [0, 10]
    assert foo["x"] == pytest.approx([0.1, 0.2])
    assert foo["y"] == pytest.approx([0.1, 0.2])


def test_build_payload_omits_trajectories_key_without_calibration():
    events = [
        *_base_tracker_events(),
        _unit_born_event(1, "HeroLiMing"),
        _unit_positions_event(610, [(1, 10.0, 10.0)]),
    ]

    payload = build_payload(
        header=_header(610 + 16 * 600),
        details=_details(),
        initdata=_initdata(),
        tracker_events=events,
        attributes_events=_base_attributes_events(),
        battletags=_battletags(),
        replay_hash="a" * 64,
        calibrations_by_map={},  # no calibration for "cursed-hollow" -- spatial itself is omitted
    )

    assert "spatial" not in payload
