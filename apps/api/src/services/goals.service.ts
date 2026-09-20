import { db, heroes, matchPlayers, matches, playerGoals, type PlayerGoalRow } from "@hots-stats/db";
import {
  GOAL_SUGGESTION_WINDOW_DAYS,
  type GoalInput,
  type GoalsResponse,
  type GoalSuggestionsResponse,
  type GoalUpdate,
  type PlayerGoal,
} from "@hots-stats/shared-types";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { type Scope, scopeConditions } from "../lib/account-selection";
import { DRIVER_METRIC_CATALOG } from "../lib/driver-analysis";
import { computeGoalProgress } from "../lib/goal-progress";
import { type GoalSuggestionInput, buildGoalSuggestions } from "../lib/goal-suggestions";
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

interface TopHero {
  heroId: string;
  heroName: string;
}

/**
 * The two heroes the player has played the most distinct matches with over the
 * suggestion window, most played first. Counts distinct matches (not rows) so a
 * match never counts twice when two linked accounts are in it.
 */
async function loadTopHeroes(scope: Scope, from: Date): Promise<TopHero[]> {
  const conditions = scopeConditions([gte(matches.playedAt, from)], scope, matchPlayers.battletag);
  const games = sql<number>`count(distinct ${matchPlayers.matchId})`;
  return db
    .select({ heroId: matchPlayers.heroId, heroName: heroes.name })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .where(and(...conditions))
    .groupBy(matchPlayers.heroId, heroes.name)
    .orderBy(desc(games), matchPlayers.heroId)
    .limit(2);
}

/**
 * Pre-configured objectives adapted to the player's last 30 days: two across
 * every hero, then two per top-2 most-played hero. Reuses the exact A4 match
 * loading the goal progress uses, so a suggestion and the goal it pre-fills
 * read the same numbers. Nothing is written: the web pre-fills the form.
 */
export async function suggestGoals(scope: Scope, now = new Date()): Promise<GoalSuggestionsResponse> {
  const from = new Date(now.getTime() - GOAL_SUGGESTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const fromIso = from.toISOString();

  const topHeroes = await loadTopHeroes(scope, from);
  const [globalMatches, ...heroMatchSets] = await Promise.all([
    loadDriverMatchInputs(scope, { from: fromIso }),
    ...topHeroes.map((hero) => loadDriverMatchInputs(scope, { from: fromIso, heroId: hero.heroId })),
  ]);

  const inputs: GoalSuggestionInput[] = [
    { scope: { group: "global", heroId: null, heroName: null }, matches: globalMatches ?? [] },
    ...topHeroes.map((hero, index) => ({
      scope: {
        group: index === 0 ? ("topHero" as const) : ("secondHero" as const),
        heroId: hero.heroId,
        heroName: hero.heroName,
      },
      matches: heroMatchSets[index] ?? [],
    })),
  ];

  return {
    scope: scope.mode,
    windowDays: GOAL_SUGGESTION_WINDOW_DAYS,
    suggestions: buildGoalSuggestions(inputs),
  };
}
