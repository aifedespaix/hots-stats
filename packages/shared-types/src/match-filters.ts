/**
 * Sentinel `gameVersion` filter value standing in for "matches with no
 * recorded game version" (`matches.gameVersion IS NULL` -- ingested before
 * PARSER_VERSION 1.5 added the field, not yet resynced). Shared between the
 * API (apps/api/src/routes/matches.ts's `buildMatchConditions`) and the web
 * app (the version filter's "Version inconnue" option) so both sides agree
 * on the exact string without importing from one another.
 */
export const UNKNOWN_GAME_VERSION = "unknown" as const;

/**
 * Server-side row cap for GET /matches/export.csv. Lives here so the API
 * enforces exactly the limit the web announces, and cannot drift (cross-cutting
 * "constants" rule). Exceeding it yields the first MATCH_EXPORT_MAX_ROWS rows
 * in the requested order, plus an X-Export-Truncated: true header.
 */
export const MATCH_EXPORT_MAX_ROWS = 5000;
