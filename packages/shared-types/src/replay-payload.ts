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
 */
export const replayPayloadSchema = z.object({
  replayHash: z.string().min(32),
  parserVersion: z.string(),
  map: z.string(),
  gameMode: gameModeSchema,
  region: z.string(),
  playedAt: z.string().datetime(),
  durationSeconds: z.number().int().positive(),
  players: z.array(replayPlayerSchema).min(2),
});
export type ReplayPayload = z.infer<typeof replayPayloadSchema>;
