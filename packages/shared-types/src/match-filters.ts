/**
 * Sentinel `gameVersion` filter value standing in for "matches with no
 * recorded game version" (`matches.gameVersion IS NULL` -- ingested before
 * PARSER_VERSION 1.5 added the field, not yet resynced). Shared between the
 * API (apps/api/src/routes/matches.ts's `buildMatchConditions`) and the web
 * app (the version filter's "Version inconnue" option) so both sides agree
 * on the exact string without importing from one another.
 */
export const UNKNOWN_GAME_VERSION = "unknown" as const;
