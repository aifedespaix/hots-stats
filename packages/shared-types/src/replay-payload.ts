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
 * `staggeredDeaths`/`firstDeath` pillars (apps/web/app/utils/coachAnalysis.ts).
 *
 * `x`/`y`/`killers`/`killType` are optional additions (see
 * tasks/epic-10-analyse-spatiale.md Livrable 1): only present when the
 * replay's map has a spatial calibration (same gate as the `spatial` block
 * below). `x`/`y` are the *normalized* `[0,1]` position of the death,
 * derived by the daemon from the dying hero's last known position sample at
 * or before the death (not a field `SUnitDiedEvent` is confirmed to carry
 * itself). `killType` is deliberately a 2-way split, not the 4-way
 * "hero/minion/structure/environment" originally envisioned in epic-10: the
 * daemon can only confirm a killer *player* id or the absence of one, not
 * distinguish a minion/structure/terrain kill from each other -- narrowing
 * the field rather than fabricating a distinction the data doesn't support. */
export const killTypeSchema = z.enum(["hero", "other"]);
export type KillType = z.infer<typeof killTypeSchema>;

export const matchTimelineDeathSchema = z.object({
  battletag: z.string(),
  team: z.union([z.literal(0), z.literal(1)]),
  atSeconds: z.number().int().nonnegative(),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  // Which calibrated layer `x`/`y` are normalized against -- `null` (or
  // absent, for a daemon build older than PARSER_VERSION 1.13) is the map's
  // default/only level, same convention as `spatialPresenceEntrySchema.layer`
  // below. Only meaningful alongside `x`/`y`; a death with no position never
  // has a layer either.
  layer: z.string().nullable().optional(),
  killers: z.array(z.string()).optional(),
  killType: killTypeSchema.optional(),
});
export type MatchTimelineDeath = z.infer<typeof matchTimelineDeathSchema>;

/** A fort/keep/wall/core destruction (`SUnitDiedEvent` on a structure unit
 * -- see `_extract_structure_events` in daemon-python/src/parser.py,
 * PARSER_VERSION 1.11). `team` is the *owning* team, i.e. the side that
 * lost the structure. An anchor point for the Pro Comparison View's
 * event-anchored heatmap slices (apps/web/app/composables/useHeatmapSync.ts).
 * Optional/best-effort: the daemon's structure-unit-type-name table is
 * unconfirmed against a real replay (see that changelog entry), so this may
 * under- or over-match on some replays -- absence never blocks the rest of
 * `timeline`. */
export const matchStructureEventSchema = z.object({
  team: z.union([z.literal(0), z.literal(1)]),
  atSeconds: z.number().int().nonnegative(),
  structureType: z.enum(["fort", "keep", "wall", "core"]),
});
export type MatchStructureEvent = z.infer<typeof matchStructureEventSchema>;

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
  // Optional so a daemon build older than PARSER_VERSION 1.11 (which
  // doesn't send this yet) still validates -- see replay-upsert.service.ts,
  // which simply skips writing structure-event rows when it's absent.
  structureEvents: z.array(matchStructureEventSchema).optional(),
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
 * One hero's sparse presence grid for the match (see
 * tasks/epic-10-analyse-spatiale.md Livrable 1) -- structure-of-arrays
 * (`cellIndex[i]` <-> `secondsInCell[i]`) rather than an array of `{cell,
 * seconds}` objects, to avoid repeating JSON keys per cell in a match with
 * hundreds of occupied cells across 10 heroes.
 */
export const spatialPresenceEntrySchema = z.object({
  battletag: z.string(),
  heroId: z.string(),
  // Always null today (single-layer maps only) -- reserved for a map like
  // Haunted Mines whose surface/underground may need distinct calibrations.
  // See epic-10 section 1.4.
  layer: z.string().nullable(),
  cellIndex: z.array(z.number().int().nonnegative()),
  secondsInCell: z.array(z.number().nonnegative()),
});
export type SpatialPresenceEntry = z.infer<typeof spatialPresenceEntrySchema>;

/**
 * One hero's downsampled, *timestamped* path for the match (see
 * `_extract_trajectories` in daemon-python/src/parser.py, PARSER_VERSION
 * 1.11) -- structure-of-arrays like `spatialPresenceEntrySchema` above
 * (`atSeconds[i]` <-> `x[i]`/`y[i]`), but deliberately a separate,
 * parallel block: `spatial.presence[]` collapses every sample into a
 * match-long aggregate with no timestamp left to slice by, which is
 * exactly why the Pro Comparison View (time-sliced/event-anchored
 * heatmaps, literal rotation pathing -- see
 * apps/web/app/composables/useHeatmapSync.ts) needs this instead.
 */
export const matchHeroTrajectorySchema = z.object({
  battletag: z.string(),
  heroId: z.string(),
  layer: z.string().nullable(),
  atSeconds: z.array(z.number().int().nonnegative()),
  x: z.array(z.number().min(0).max(1)),
  y: z.array(z.number().min(0).max(1)),
});
export type MatchHeroTrajectory = z.infer<typeof matchHeroTrajectorySchema>;

export const spatialSchema = z.object({
  schemaVersion: z.number().int().positive(),
  grid: z.object({ cols: z.number().int().positive(), rows: z.number().int().positive() }),
  presence: z.array(spatialPresenceEntrySchema),
  // Optional so a daemon build older than PARSER_VERSION 1.11 (which
  // doesn't send this yet) still validates -- see replay-upsert.service.ts,
  // which simply skips writing trajectory rows when it's absent.
  trajectories: z.array(matchHeroTrajectorySchema).optional(),
});
export type Spatial = z.infer<typeof spatialSchema>;

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
  // Optional: only present when the replay's map has a spatial calibration
  // at parse time -- absent for an uncalibrated map (the daemon instead
  // POSTs raw samples to /spatial/samples, see spatial-calibration docs) or
  // a daemon build older than PARSER_VERSION 1.7.
  spatial: spatialSchema.optional(),
});
export type ReplayPayload = z.infer<typeof replayPayloadSchema>;
