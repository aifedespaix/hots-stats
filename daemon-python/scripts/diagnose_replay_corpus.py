"""Batch triage tool for a folder of `.StormReplay` files.

Runs the daemon's own `parser.parse_replay` (not a reimplementation) against
every replay in a directory and buckets the outcome: clean parse, deliberate
skip (AI player / incomplete game), or `ReplayParseError` -- broken out
further into the two recurring shapes this project has hit in production
(see `daemon-python/src/constants.py`'s `PARSER_VERSION` changelog, 1.9 and
1.10):

- a `SUnitBornEvent`/talent-id internal codename with no `UNIT_TYPE_HERO_OVERRIDES`
  entry ("Could not determine hero" errors), and
- a replay build newer than every entry in
  `_protocol_versions.KNOWN_PROTOCOL_BUILDS`, which can silently decode
  `SScoreResultEvent` down to all-zero stats (`_score_event_looks_corrupt`).

Point this at a folder of real replays whenever a player reports "my stats
look wrong" and you have (or can get) their replay files -- far faster than
debugging one file by hand, and it tells you whether a fix is a quick
`UNIT_TYPE_HERO_OVERRIDES` addition or a deeper decoder-version problem this
project can't fix on its own. See also `diagnose_hero_mapping.py` for
digging into one specific mismatched replay in detail once this narrows it
down to a single file.

Usage (from `daemon-python/`, with the daemon's deps installed --
`pip install -e ".[dev]"`):

    python scripts/diagnose_replay_corpus.py "C:\\path\\to\\replay\\folder"
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src._protocol_versions import KNOWN_PROTOCOL_BUILDS
from src.parser import ReplayParseError, ReplaySkipped, parse_replay


def main(replay_dir: Path) -> None:
    files = sorted(replay_dir.glob("*.StormReplay"))
    if not files:
        print(f"No .StormReplay files found directly in {replay_dir}")
        return

    newest_known_build = max(KNOWN_PROTOCOL_BUILDS)
    print(f"{len(files)} replays found; newest known heroprotocol build: {newest_known_build}\n")

    ok = 0
    skipped_reasons: Counter[str] = Counter()
    corrupt_score = 0
    hero_resolution_failures: Counter[str] = Counter()  # missing-hero-name -> count
    other_errors: list[tuple[str, str]] = []
    newer_build_ok = 0

    hero_name_re = re.compile(r"Could not determine hero for player '(.+)'\.")

    for f in files:
        try:
            payload = parse_replay(f)
            ok += 1
            if payload["m_baseBuild"] > newest_known_build:
                newer_build_ok += 1
        except ReplaySkipped as e:
            skipped_reasons[e.reason] += 1
        except ReplayParseError as e:
            msg = str(e)
            if "all-zero" in msg:
                corrupt_score += 1
                print(f"[CORRUPT SCORE] {f.name}")
            elif hero_name_re.search(msg):
                # Grouping by player name isn't useful across replays -- what
                # matters is *how many* hit this shape at all, and each
                # printed line's own player name for follow-up with
                # diagnose_hero_mapping.py.
                hero_resolution_failures["Could not determine hero"] += 1
                print(f"[HERO RESOLUTION] {f.name}: {msg}")
            else:
                other_errors.append((f.name, msg))
                print(f"[OTHER ERROR] {f.name}: {msg}")

    print()
    print(f"ok={ok} (of which on a build newer than any known decoder: {newer_build_ok})")
    print(f"skipped={sum(skipped_reasons.values())} {dict(skipped_reasons)}")
    print(f"corrupt_score (stale-decoder all-zero stats)={corrupt_score}")
    print(f"hero_resolution_failures (missing UNIT_TYPE_HERO_OVERRIDES entry)={sum(hero_resolution_failures.values())}")
    print(f"other_errors={len(other_errors)}")

    if corrupt_score:
        print(
            "\nCorrupt-score replays can't be recovered without a heroprotocol decoder "
            "for their build -- see PARSER_VERSION 1.9's changelog entry. Nothing to fix "
            "here beyond confirming the guard caught them (it already has, by construction)."
        )
    if hero_resolution_failures:
        print(
            "\nHero resolution failures are usually fixable: re-run with "
            "scripts/diagnose_hero_mapping.py on one of the printed files to find the "
            "player, then check its SUnitBornEvent unit type name / talent id prefix "
            "against constants.UNIT_TYPE_HERO_OVERRIDES -- see PARSER_VERSION 1.10's "
            "changelog entry for the pattern."
        )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: python {sys.argv[0]} <replay-folder>", file=sys.stderr)
        raise SystemExit(1)
    main(Path(sys.argv[1]))
