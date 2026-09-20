import type {
  GoalInput,
  GoalResponse,
  GoalSuggestionsResponse,
  GoalUpdate,
  GoalsResponse,
} from "@hots-stats/shared-types";

/**
 * E2 goals for the current viewer. Progress is measured across the accounts
 * currently selected; the global game-mode filter is deliberately NOT applied
 * -- a long-term goal is not a view of one mode (see the API route).
 */
export function useGoals() {
  return useApiFetch<GoalsResponse>("/goals", { withGameMode: false });
}

/** Pre-configured objectives for the /objectifs page, adapted to the player's
 * last 30 days. Same mode rule as useGoals: a goal is not a view of one mode. */
export function useGoalSuggestions() {
  return useApiFetch<GoalSuggestionsResponse>("/goals/suggestions", { withGameMode: false });
}

/** Write side of the same resource: `$fetch` is used for mutations so the
 * list is refreshed explicitly after each one (see the page). */
export function useGoalMutations() {
  const config = useRuntimeConfig();
  const base = { baseURL: config.public.apiBase, credentials: "include" as const };

  return {
    createGoal: (input: GoalInput) =>
      $fetch<GoalResponse>("/goals", { ...base, method: "POST", body: input }),
    updateGoal: (id: string, input: GoalUpdate) =>
      $fetch<GoalResponse>(`/goals/${id}`, { ...base, method: "PATCH", body: input }),
    deleteGoal: (id: string) => $fetch(`/goals/${id}`, { ...base, method: "DELETE" }),
  };
}
