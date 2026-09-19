import { z } from "zod";

/** Direction a goal is measured in. "atLeast": the target is a floor (the
 * metric is good when higher, e.g. XP/min). "atMost": the target is a ceiling
 * (the metric is good when lower, e.g. deaths). */
export const goalDirectionSchema = z.enum(["atLeast", "atMost"]);
export type GoalDirection = z.infer<typeof goalDirectionSchema>;

/** Body accepted by POST /goals. Whether `metricKey` is a *known* driver
 * metric is checked by the API, which owns that catalog (see
 * apps/api/src/lib/driver-analysis.ts). An omitted/null hero or map scope
 * tracks every match in scope; an omitted `dueAt` means no deadline. */
export const goalInputSchema = z.object({
  metricKey: z.string().min(1).max(64),
  targetValue: z.number(),
  direction: goalDirectionSchema,
  scopeHeroId: z.string().min(1).max(128).nullable().optional(),
  scopeMapId: z.string().min(1).max(128).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});
export type GoalInput = z.infer<typeof goalInputSchema>;

/** Body accepted by PATCH /goals/:id -- every field optional, same shapes. */
export const goalUpdateSchema = goalInputSchema.partial();
export type GoalUpdate = z.infer<typeof goalUpdateSchema>;

/** One metric a goal may target -- the A4 driver catalog, sent by the API so
 * the web never keeps a second copy of the list. */
export interface GoalMetricOption {
  key: string;
  label: string;
  betterWhen: "higher" | "lower";
}

/** Progress of one goal over the matches played since it was created (E2).
 * `currentValue` is the mean of the metric's per-match A4 definition over
 * every match with a readable value; it is null when no such match exists --
 * never fabricated as 0. */
export interface GoalProgress {
  /** Mean of the metric over the sample, or null with no readable value. */
  currentValue: number | null;
  targetValue: number;
  direction: GoalDirection;
  /** Matches in scope played strictly after creation. */
  matchesSinceCreated: number;
  /** Of those, the ones with a readable value for the metric. */
  sampleSize: number;
  /** False below the shared PROGRESSION_MIN_MATCHES gate: the value is shown
   * with its count, never as a verdict. */
  reliable: boolean;
  /** True only when `currentValue` is a number and it meets the target. */
  achieved: boolean;
  /** How far from a zero baseline to the target, clamped to [0, 1]; null when
   * `currentValue` is null. */
  ratio: number | null;
}

/** A goal plus its live progress (E2). */
export interface PlayerGoal {
  id: string;
  metricKey: string;
  targetValue: number;
  direction: GoalDirection;
  scopeHeroId: string | null;
  scopeMapId: string | null;
  dueAt: string | null;
  createdAt: string;
  /** Set by the API the first time the goal was observed met; null otherwise. */
  achievedAt: string | null;
  progress: GoalProgress;
}

/** GET /goals (E2). */
export interface GoalsResponse {
  goals: PlayerGoal[];
  availableMetrics: GoalMetricOption[];
}

/** POST/PATCH /goals response (E2). */
export interface GoalResponse {
  goal: PlayerGoal;
}
