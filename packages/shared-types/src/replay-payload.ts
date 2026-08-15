import { z } from "zod";

export const gameModeSchema = z.enum([
  "QuickMatch",
  "UnrankedDraft",
  "HeroLeague",
  "TeamLeague",
  "StormLeague",
  "ARAM",
  "Brawl",
  "Custom",
]);
export type GameMode = z.infer<typeof gameModeSchema>;

export const talentPickSchema = z.object({
  tier: z.union([
    z.literal(1),
    z.literal(4),
    z.literal(7),
    z.literal(10),
    z.literal(13),
    z.literal(16),
    z.literal(20),
  ]),
  talentId: z.string(),
  talentName: z.string(),
});
export type TalentPick = z.infer<typeof talentPickSchema>;

/** One hero death, timestamped relative to "gates open" (the same reference
 * point `durationSeconds` uses) -- see daemon-python/src/parser.py's
 * `_extract_deaths`. Powers the Coach tab's `outnumberedFights`/
 * `staggeredDeaths`/`firstDeath` pillars (apps/web/app/utils/coachAnalysis.ts). */
export const matchTimelineDeathSchema = z.object({
  battletag: z.string(),
  team: z.union([z.literal(0), z.literal(1)]),
  atSeconds: z.number().int().nonnegative(),
});
export type MatchTimelineDeath = z.infer<typeof matchTimelineDeathSchema>;

/** A player's character level at a point in time, from a `LevelUp` tracker
 * event (see `_extract_level_snapshots`). Powers the Coach tab's
 * `talentDelay` pillar. */
export const matchTimelineLevelSnapshotSchema = z.object({
  battletag: z.string(),
  atSeconds: z.number().int().nonnegative(),
  level: z.number().int().positive(),
});
export type MatchTimelineLevelSnapshot = z.infer<typeof matchTimelineLevelSnapshotSchema>;

export const matchTimelineSchema = z.object({
  deaths: z.array(matchTimelineDeathSchema),
  levelSnapshots: z.array(matchTimelineLevelSnapshotSchema),
});
export type MatchTimeline = z.infer<typeof matchTimelineSchema>;

export const replayPlayerSchema = z.object({
  battletag: z.string(),
  heroId: z.string(),
  team: z.union([z.literal(0), z.literal(1)]),
  winner: z.boolean(),
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  heroDamage: z.number().int().nonnegative(),
  siegeDamage: z.number().int().nonnegative(),
  healing: z.number().int().nonnegative(),
  selfHealing: z.number().int().nonnegative(),
  damageTaken: z.number().int().nonnegative(),
  experienceContribution: z.number().int().nonnegative(),
  talents: z.array(talentPickSchema),
});
export type ReplayPlayer = z.infer<typeof replayPlayerSchema>;

/**
 * Payload posted by the Python daemon to POST /api/ingest.
 * `parserVersion` drives the upsert logic: a match is only overwritten
 * when the incoming version is strictly greater than the stored one.
 *
 * Forward-compat contract with the daemon: the daemon forwards every stat
 * the game's replay tracker reports for a player, not just the fields below
 * (see daemon-python/src/parser.py's `_apply_score_event` /
 * constants.stat_field_name). `z.object()` without `.strict()` silently
 * drops keys it doesn't recognize, so adding a new field here to start
 * reading a stat the daemon already sends (plus a matching DB column and
 * `replay-upsert.service.ts` write) is enough on its own -- no daemon
 * rebuild needed. A rebuild is only required when the daemon can't *decode*
 * a stat at all (a `heroprotocol` update for a new replay build).
 */
export const replayPayloadSchema = z.object({
  replayHash: z.string().min(32),
  parserVersion: z.string(),
  map: z.string(),
  gameMode: gameModeSchema,
  region: z.string(),
  // "major.minor.revision.baseBuild" (e.g. "2.55.15.96477"), from the
  // replay header -- see daemon-python/src/parser.py's `_game_version`.
  gameVersion: z.string(),
  playedAt: z.string().datetime(),
  durationSeconds: z.number().int().positive(),
  players: z.array(replayPlayerSchema).min(2),
  // Optional so a daemon build older than PARSER_VERSION 1.4 (which doesn't
  // send this yet) still validates -- see replay-upsert.service.ts, which
  // simply skips writing timeline rows when it's absent.
  timeline: matchTimelineSchema.optional(),
});
export type ReplayPayload = z.infer<typeof replayPayloadSchema>;
