import { gameModeSchema } from "@hots-stats/shared-types";
import { z } from "zod";

/**
 * Query param for a game-mode filter that may represent more than one raw
 * `GameMode` -- the web UI groups the legacy/current ranked queues
 * (UnrankedDraft/HeroLeague/TeamLeague/StormLeague) into a single "Classé"
 * filter option rather than listing all 8 raw modes, sent as a
 * comma-separated list (e.g. "UnrankedDraft,HeroLeague,TeamLeague,
 * StormLeague"). A single mode is just a one-element list. The stored
 * `matches.gameMode` value is never touched by this -- only which rows a
 * filter matches.
 */
export const gameModeListSchema = z
  .string()
  .transform((value) => value.split(","))
  .pipe(z.array(gameModeSchema).min(1));

/**
 * Query param for a game-version filter: a comma-separated list of
 * `matches.gameVersion` values (e.g. "2.55.15.96477,2.55.9.90670"), plus
 * the `UNKNOWN_GAME_VERSION` sentinel standing in for `gameVersion IS NULL`
 * (matches ingested before PARSER_VERSION 1.5). See `buildMatchConditions`
 * in `routes/matches.ts` for how the sentinel is turned into an `IS NULL`.
 */
export const gameVersionListSchema = z
  .string()
  .transform((value) => value.split(","))
  .pipe(z.array(z.string().min(1)).min(1));
