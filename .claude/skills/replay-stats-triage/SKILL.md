---
name: replay-stats-triage
description: Investigate a HotS Analytics report of "this match's stats are wrong/incoherent" (0 damage, missing heroes, mismatched players) down to a root cause in daemon-python's parser, then fix it with a guardrail plus a real correction, following this project's PARSER_VERSION/MIN_PARSER_VERSION conventions. Use whenever a user reports bad match stats, asks to investigate replay parsing correctness, or hands over .StormReplay files to debug with.
---

# Replay stats triage

This project (`hots-stats`) has already been through several rounds of "a
player says their stats are wrong" investigations (see
`daemon-python/src/constants.py`'s `PARSER_VERSION` changelog for the full
history). Every one of them turned out to be a real, fixable bug in
`daemon-python/src/parser.py` -- never "the user misread the page". Treat a
report the same way: assume there's a real root cause and go find it,
using production data and/or real replay files, not by staring at the
parser code in isolation.

## Step 0 -- what you're working with

- `daemon-python/src/parser.py` turns a decoded `.StormReplay` into the API
  payload. `daemon-python/src/constants.py` holds the lookup tables
  (`HERO_DISPLAY_NAMES`, `UNIT_TYPE_HERO_OVERRIDES`, `MAP_DISPLAY_NAMES`,
  `REQUIRED_SCORE_FIELDS`) and `PARSER_VERSION`.
- `apps/api/src/routes/internal.ts` exposes read-only diagnostics against
  the **live production DB**, guarded by `Authorization: Bearer
  <CLAUDE_INTERNAL_SECRET>` against `API_PUBLIC_URL`. Ask the user for
  these two values if they're not already in your environment -- never
  guess, hardcode, or commit them.
- `debug/*.StormReplay` at the repo root (as of 2026-08, ~70 real replay
  files) is this project's live triage corpus, kept in git on purpose so a
  fresh session can reproduce a bug without waiting on a user to re-upload
  files. Feel free to add more `.StormReplay` files there if the user hands
  you new ones for debugging -- that's the established convention, not a
  one-off.

## Step 1 -- confirm it's real, and scope it, from production

Don't trust a single anecdote about "match X looks wrong" until you've
checked the DB. Useful endpoints (all under `$API_PUBLIC_URL/_internal/diagnostics/`,
`Authorization: Bearer $CLAUDE_INTERNAL_SECRET`):

- `match/:matchId` -- raw per-player stats for the one match reported.
- `parser-versions` -- match counts grouped by `parserVersion`, oldest/newest
  `playedAt`. Tells you whether the bad match is on an *old* version
  (likely already-fixed, just needs a resync -- see Step 4) or the
  *current* one (still-live bug, needs a real fix first).
- `zero-kda` -- rows with kills=deaths=assists=0. Noisy (a genuine low-fight
  blowout, or specialists like Abathur, produce false positives) -- use it
  to spot patterns (`byHero`, `byParserVersion`), not as a definitive bug
  list.
- `all-zero-matches` -- **much more precise**: whole matches where *every*
  player is 0 on kills/deaths/assists/damage/healing/experience. Every row
  this returns is a real, live instance of the corrupted-score bug (see
  Step 3a) -- essentially zero false positives.

```bash
curl -sS -H "Authorization: Bearer $CLAUDE_INTERNAL_SECRET" \
  "$API_PUBLIC_URL/_internal/diagnostics/all-zero-matches?limit=50"
```

If the match/pattern is on the current `parserVersion`, this is a live bug
in `parser.py` -- proceed to Step 2. If it's on an old version already
fixed by a later `PARSER_VERSION` bump, it just needs `MIN_PARSER_VERSION`
(`apps/api/src/constants.ts`) raised and the owning player's daemon to
resync (Step 4) -- there may be nothing to code.

## Step 2 -- reproduce against real replay files

If you have `.StormReplay` files (the `debug/` corpus, or new ones the user
hands you), reproduce locally instead of theorizing from the payload alone
-- this project's own history shows the theories from reading `parser.py`
in isolation are usually wrong or incomplete (e.g. "stale decoder ⇒
corrupted stats for every newer-build replay" turned out to affect only
~10% of them; the much bigger issue in the same batch was an unrelated hero
resolution gap that reading the corrupted-stats code alone would never
have surfaced).

Set up once per session:

```bash
cd daemon-python
python3 -m venv /tmp/daemonvenv   # or reuse an existing one
/tmp/daemonvenv/bin/pip install -e ".[dev]"
# Optional, for the two tests that need a real decoder:
/tmp/daemonvenv/bin/pip install "heroprotocol @ git+https://github.com/Blizzard/heroprotocol.git@v2.55.15.96477"
```

Then run the batch triage script against the corpus:

```bash
/tmp/daemonvenv/bin/python scripts/diagnose_replay_corpus.py /path/to/replay/folder
```

It buckets every replay into: clean parse, deliberate skip (AI player /
incomplete game), corrupted-score (`ReplayParseError` with "all-zero" in
the message), hero-resolution failure ("Could not determine hero"), or
other. Read its summary before touching any code -- it tells you which of
Step 3's shapes you're actually dealing with, and how many replays each one
affects, so effort matches actual impact.

For one specific replay/player, `scripts/diagnose_hero_mapping.py
"<path>.StormReplay"` dumps every hero-resolution signal (talent prefix,
unit-spawn, attribute-events scope) side by side.

## Step 3 -- match the failure to a known shape (or find a new one)

### 3a. All-zero stats ("SScoreResultEvent decoded to all-zero...")

Root cause found in production (2026-08, `PARSER_VERSION` 1.9): the
replay's `m_baseBuild` is newer than every entry in
`_protocol_versions.KNOWN_PROTOCOL_BUILDS` (check
`daemon-python/pyproject.toml`'s pinned `heroprotocol` git tag for the
newest one actually installed). `_build_protocol` falls back to the newest
known decoder for those, and *usually* that's fine (the wire format rarely
changes between consecutive builds) -- but for `SScoreResultEvent`
specifically, on some builds it silently decodes down to nothing but each
field's baseline-0 seed for every player.

This is **not recoverable** without a real `heroprotocol` decoder for that
build -- there's no fix to write in this repo beyond what already exists
(`_score_event_looks_corrupt` in `parser.py` raises `ReplayParseError`
instead of ingesting the zeros). If you're seeing this: confirm the guard
is catching it (it raises `ReplayParseError`, not a silent bad payload),
check whether a newer `heroprotocol` release now covers the build in
question (bump the pin in `pyproject.toml` + regenerate
`_protocol_versions.py` if so), and otherwise there's nothing more to do
here.

### 3b. Hero resolution failure ("Could not determine hero for player ...")

Root cause found in production (2026-08, `PARSER_VERSION` 1.10): a hero
whose internal codename (talent-id prefix and/or `SUnitBornEvent`
`m_unitTypeName`) shares no textual relationship with its current display
name, and `UNIT_TYPE_HERO_OVERRIDES` doesn't have an entry for it. Six
heroes hit this (Qhira/"NexusHunter", Cassia/"Amazon", Lunara/"Dryad", Lt.
Morales/"Medic", Brightwing/"FaerieDragon", Blaze/"Firebat") -- there may be
others for heroes released since. **In ARAM this is a hard failure** (ARAM
never falls back to the unreliable `HeroAttributeId`, by design -- see
`PARSER_VERSION` 1.3's changelog); in other modes it silently mislabels the
player's hero via that fallback instead, which is worse (wrong data, not a
loud failure).

Fix: use `diagnose_hero_mapping.py` on one failing replay to find the
offending player, then use `scripts/diagnose_replay_corpus.py`'s printed
lines (or the ad-hoc pattern below) to get that player's raw
`SUnitBornEvent.m_unitTypeName`, and add it to `UNIT_TYPE_HERO_OVERRIDES`
in `constants.py`:

```python
sys.path.insert(0, "daemon-python")
# ... decode the replay (see diagnose_hero_mapping.py for the boilerplate),
# find the target player's tracker id, then:
names = {
    _s(e["m_unitTypeName"])
    for e in tracker_events
    if e.get("_event") == "NNet.Replay.Tracker.SUnitBornEvent"
    and e.get("m_controlPlayerId") == target_tracker_id
}
```

Strip the "Hero" prefix from the interesting entry (skip generic ones like
`DeadUnitCameraTarget`) and add `{"StrippedName": "Display Name"}` to
`UNIT_TYPE_HERO_OVERRIDES`, with a comment explaining *why* the prefix
match fails (what the actual internal codename is) -- follow the existing
entries' style.

### 3c. Unknown map ("Unknown map internal name ...")

Cosmetic only -- the `_prettify_pascal_case` fallback already produces the
correct slug (confirmed: adding the curated entry never changes
`_slugify`'s output, since the fallback and the curated string end up
identical). Still worth curating in `MAP_DISPLAY_NAMES` to cut log noise
for the next triage session -- five-minute fix, do it while you're there
even if it's not the reported bug.

### 3d. A new shape

If none of the above match, you've found a new bug class. Follow the
established documentation pattern: a numbered `PARSER_VERSION` changelog
entry in `constants.py` explaining *what broke, how it was found (cite the
real match/replay evidence), and what the fix does* -- not just "fixed X".
Future-you (or future-Claude) triaging the next report depends on these
being genuinely informative, not "bump version, fix bug".

## Step 4 -- guardrails and version bumps

- **Add a regression test** in `daemon-python/tests/test_parser.py` using
  the file's existing synthetic-fixture helpers (`_score_event`,
  `_unit_born_event`, `_base_tracker_events`, etc.) -- don't commit a real
  replay file as a test fixture (large binary, personal battletags); a
  synthetic fixture reproducing the exact same shape is enough, and is what
  every existing regression test in that file already does.
- **Bump `PARSER_VERSION`** (`daemon-python/src/constants.py`) whenever the
  fix changes what a replay parses to -- with a changelog entry as above.
  This alone makes a daemon that updates automatically resync its own
  previously-synced replays (see `sync_state.py`'s `invalidate_stale`).
- **Bump `MIN_PARSER_VERSION`** (`apps/api/src/constants.ts`) to the same
  value *only* if the fix should force a mass resync of every other
  player's already-synced replays too -- skip this for a fix that doesn't
  change already-good output (see `PARSER_VERSION` 1.8's changelog entry
  for the reasoning on when *not* to pair them).
- If the fix is specifically about combat-stat correctness (not hero
  labeling, not a new field), also consider whether
  `MIN_RELIABLE_STATS_PARSER_VERSION` (same file) needs bumping, and
  whether `apps/api/src/lib/replay-plausibility.ts`'s guardrails
  (`isAllZeroCombat` and friends) need a matching addition -- that file is
  the ingestion-time defense-in-depth layer, independent of `parserVersion`,
  for exactly this bug shape. Keep the parser-side check
  (`_score_event_looks_corrupt` in `parser.py`) and the API-side one
  conceptually in sync: same shape, same duration threshold, so a
  regression only one of them catches doesn't quietly reappear.

## Step 5 -- verify before pushing

```bash
cd daemon-python
/tmp/daemonvenv/bin/python -m pytest tests/ -q
/tmp/daemonvenv/bin/ruff check src/ tests/ scripts/
/tmp/daemonvenv/bin/python scripts/diagnose_replay_corpus.py /path/to/replay/folder  # confirm the count for this bug shape dropped to 0
```

From the repo root, also typecheck anything touched on the API/web side
(`bun run --filter './apps/api' typecheck`, `bun run --filter './apps/web'
typecheck`) if the fix touched `replay-plausibility.ts`,
`MIN_PARSER_VERSION`, or the match-detail route's `statsReliable`
computation.
