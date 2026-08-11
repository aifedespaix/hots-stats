"""Static lookup tables used to translate raw replay data into the API's payload shape.

Values here are cross-checked against the community-maintained `hots-parser`
project (https://github.com/ebshimizu/hots-parser, MIT) and its real-replay
test fixtures, since the Blizzard `heroprotocol` package only exposes the
binary encoding, not what game-specific event names/ids mean.
"""

from __future__ import annotations

# Bump whenever parser.py's output shape changes in a way that should
# override previously-ingested matches (see replay-upsert.service.ts).
PARSER_VERSION = "1.0"

# Shown in the settings window. Bump alongside `[project].version` in pyproject.toml.
APP_VERSION = "1.0.1"

# HotS talent tiers are always at these character levels, in pick order.
TALENT_TIER_LEVELS = (1, 4, 7, 10, 13, 16, 20)

# `m_ammId` from replay.initData -> our `gameMode` enum (packages/shared-types).
# Confirmed against hots-parser's constants.js. AI/Practice lobbies are
# intentionally excluded: they have no `gameMode` counterpart and are
# rejected by the parser (see parser.ReplayParseError).
GAME_MODE_BY_AMM_ID: dict[int, str] = {
    50001: "QuickMatch",
    50051: "UnrankedDraft",
    50061: "HeroLeague",
    50071: "TeamLeague",
    50091: "StormLeague",
    50031: "Brawl",
}
# ARAM has no confirmed dedicated ammId as of this writing; matches that
# don't resolve to a known id above fall back to "Custom" rather than being
# mis-tagged. Revisit with a real ARAM replay if this matters.
DEFAULT_GAME_MODE = "Custom"

# Internal map identifier (as reported by the EndOfGameTalentChoices tracker
# event) -> display name. Slugified at parse time to match `maps.id`.
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
