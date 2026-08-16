/**
 * Bump whenever the API's behavior changes in a way that's worth surfacing
 * to the daemon (shown in its settings window, see `GET /ingest/version`).
 * Independent from `apps/api/package.json`'s version, which nothing reads.
 */
export const API_VERSION = "1.1.0";

/**
 * The minimum daemon `PARSER_VERSION` (`daemon-python/src/constants.py`)
 * the API currently wants ingested. Bump this alongside a schema/parsing
 * change that means previously-synced replays should be reprocessed by
 * every daemon: `GET /ingest/version` reports it, and the daemon's
 * `SyncState.invalidate_stale()` drops its local "already synced" record
 * for anything below it, so those replays get reparsed and re-uploaded on
 * the next run instead of being skipped as already up to date. Leave
 * unchanged for a daemon release that doesn't touch the payload shape.
 */
// Bumped to 1.10 (2026-08): `UNIT_TYPE_HERO_OVERRIDES` was missing six
// heroes whose internal codename shares no prefix with their display name
// (see that constant's changelog entry) -- a non-ARAM match with one of
// them could have silently stored the wrong hero via the less-reliable
// `HeroAttributeId` fallback. Forces a resync of any already-stored match
// that hit that path, for players whose daemon updates and still has the
// replay file locally.
export const MIN_PARSER_VERSION = "1.10";

/**
 * Below this `parserVersion`, a stored match's combat stats
 * (kills/deaths/assists/damage/healing/experience) are known to be
 * potentially wrong -- not just "could use a new field" like
 * `MIN_PARSER_VERSION` above. See `daemon-python/src/constants.py`'s
 * `PARSER_VERSION` changelog, 1.6 and 1.7: a player-index desync in
 * `_apply_score_event` could stick an entire stat column at 0 for every
 * player, or duplicate one player's value onto several others.
 *
 * `GET /matches/:id` uses this to mark a match `statsReliable: false` in
 * its response so the web app can warn the viewer instead of presenting
 * corrupted numbers as fact -- a match only self-heals once its owning
 * player's daemon resyncs it (needs the replay file still present locally
 * and a daemon build new enough to have the fix), which isn't guaranteed
 * to ever happen for an inactive player or a deleted replay file.
 */
export const MIN_RELIABLE_STATS_PARSER_VERSION = "1.7";

/**
 * The site owner's account -- every brand new signup gets auto-friended
 * with it (see `friendships.service.ts#createDefaultFriendship`) so new
 * users immediately see what the friends feature does. Removable like any
 * other friendship; only applied once, at account creation.
 */
export const DEFAULT_FRIEND_USER_ID = "8732db6d-0749-4edf-85a6-e23212a24b86";
