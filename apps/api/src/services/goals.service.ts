import { db, playerGoals, type PlayerGoalRow } from "@hots-stats/db";
import type {
  GoalInput,
  GoalsResponse,
  GoalUpdate,
  PlayerGoal,
} from "@hots-stats/shared-types";
import { and, desc, eq } from "drizzle-orm";
import type { Scope } from "../lib/account-selection";
import { DRIVER_METRIC_CATALOG } from "../lib/driver-analysis";
import { computeGoalProgress } from "../lib/goal-progress";
import { type DriversFilters, loadDriverMatchInputs } from "./drivers.service";

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** The matches a goal is measured over: strictly after creation, narrowed to
 * its own hero/map scope when set. */
function goalFilters(goal: PlayerGoalRow): DriversFilters {
  return {
    from: goal.createdAt.toISOString(),
    heroId: goal.scopeHeroId ?? undefined,
    mapId: goal.scopeMapId ?? undefined,
  };
}

async function withProgress(scope: Scope, row: PlayerGoalRow): Promise<PlayerGoal> {
  const matches = await loadDriverMatchInputs(scope, goalFilters(row));
  const direction = row.direction === "atMost" ? "atMost" : "atLeast";
  const progress = computeGoalProgress(
    { metricKey: row.metricKey, targetValue: row.targetValue, direction, createdAt: row.createdAt },
    matches,
  );
  return {
    id: row.id,
    metricKey: row.metricKey,
    targetValue: row.targetValue,
    direction,
    scopeHeroId: row.scopeHeroId,
    scopeMapId: row.scopeMapId,
    dueAt: toIso(row.dueAt),
    createdAt: row.createdAt.toISOString(),
    achievedAt: toIso(row.achievedAt),
    progress,
  };
}

/** Records the first observation of the goal being met. Idempotent: only fires
 * while `achievedAt` is still null. */
async function stampAchievement(row: PlayerGoalRow, goal: PlayerGoal): Promise<void> {
  if (!goal.progress.achieved || goal.achievedAt !== null) return;
  const stampedAt = new Date();
  await db.update(playerGoals).set({ achievedAt: stampedAt }).where(eq(playerGoals.id, row.id));
  goal.achievedAt = stampedAt.toISOString();
}

export async function listGoals(scope: Scope, userId: string): Promise<GoalsResponse> {
  const rows = await db
    .select()
    .from(playerGoals)
    .where(eq(playerGoals.userId, userId))
    .orderBy(desc(playerGoals.createdAt));

  const goals: PlayerGoal[] = [];
  for (const row of rows) {
    const goal = await withProgress(scope, row);
    await stampAchievement(row, goal);
    goals.push(goal);
  }

  return { goals, availableMetrics: DRIVER_METRIC_CATALOG };
}

export async function createGoal(scope: Scope, userId: string, input: GoalInput): Promise<PlayerGoal> {
  const [row] = await db
    .insert(playerGoals)
    .values({
      userId,
      metricKey: input.metricKey,
      targetValue: input.targetValue,
      direction: input.direction,
      scopeHeroId: input.scopeHeroId ?? null,
      scopeMapId: input.scopeMapId ?? null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
    })
    .returning();
  if (!row) throw new Error("Failed to create goal");
  const goal = await withProgress(scope, row);
  await stampAchievement(row, goal);
  return goal;
}

export async function updateGoal(
  scope: Scope,
  userId: string,
  goalId: string,
  input: GoalUpdate,
): Promise<PlayerGoal | null> {
  const [existing] = await db
    .select()
    .from(playerGoals)
    .where(and(eq(playerGoals.userId, userId), eq(playerGoals.id, goalId)));
  if (!existing) return null;

  // A goal whose definition changed has never been achieved *in this form*:
  // clear the stale timestamp instead of showing a success that no longer holds.
  const definitionChanged =
    (input.metricKey !== undefined && input.metricKey !== existing.metricKey) ||
    (input.targetValue !== undefined && input.targetValue !== existing.targetValue) ||
    (input.direction !== undefined && input.direction !== existing.direction);

  const [updated] = await db
    .update(playerGoals)
    .set({
      ...(input.metricKey !== undefined ? { metricKey: input.metricKey } : {}),
      ...(input.targetValue !== undefined ? { targetValue: input.targetValue } : {}),
      ...(input.direction !== undefined ? { direction: input.direction } : {}),
      ...(input.scopeHeroId !== undefined ? { scopeHeroId: input.scopeHeroId } : {}),
      ...(input.scopeMapId !== undefined ? { scopeMapId: input.scopeMapId } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
      ...(definitionChanged ? { achievedAt: null } : {}),
    })
    .where(and(eq(playerGoals.userId, userId), eq(playerGoals.id, goalId)))
    .returning();
  if (!updated) return null;

  const goal = await withProgress(scope, updated);
  await stampAchievement(updated, goal);
  return goal;
}

export async function deleteGoal(userId: string, goalId: string): Promise<boolean> {
  const deleted = await db
    .delete(playerGoals)
    .where(and(eq(playerGoals.userId, userId), eq(playerGoals.id, goalId)))
    .returning({ id: playerGoals.id });
  return deleted.length > 0;
}
