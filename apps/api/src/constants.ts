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
export const MIN_PARSER_VERSION = "1.1";
