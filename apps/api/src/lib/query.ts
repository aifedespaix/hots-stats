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
