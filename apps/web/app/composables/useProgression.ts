import {
  DRAFT_RANKED_MODES,
  type ContextResponse,
  type DriverMetric,
  type HeroStatsScope,
  type DriversResponse,
  type PatternsResponse,
  type TrendResponse,
} from "@hots-stats/shared-types";

/** How many work axes the hub surfaces (B1 section 3). */
export const WORK_AXES_LIMIT = 3;

/**
 * The Diagnostic page (`/analysis`) is ranked-only end to end: it overrides the
 * global game-mode header filter with this exact `mode` query for every
 * progression endpoint it calls (patterns/drivers/trend). One place, so a future
 * caller cannot half-apply the rule.
 */
export function rankedModeQuery(): { mode: string } {
  return { mode: DRAFT_RANKED_MODES.join(",") };
}

/**
 * Picks the work axes shown at the top of the hub: only drivers whose win/loss
 * samples clear PROGRESSION_MIN_PER_SIDE, largest |effectSize| first. Pure and
 * deterministic, so the selection rule is unit-testable without a Nuxt runtime
 * (the fetch wiring lives in useProgression below).
 */
export function selectWorkAxes(drivers: DriverMetric[], limit: number = WORK_AXES_LIMIT): DriverMetric[] {
  return drivers
    .filter((driver) => driver.reliable)
    .sort((a, b) => {
      const magnitude = Math.abs(b.effectSize) - Math.abs(a.effectSize);
      if (magnitude !== 0) return magnitude;
      return a.key.localeCompare(b.key);
    })
    .slice(0, limit);
}

/**
 * One composable for the whole progression hub. useApiFetch bakes the active
 * game-mode and account selection into every request, and refreshes when the
 * reactive query changes (period / compareTo / tzOffsetMinutes).
 */
export function useProgression(
  query: ComputedRef<Record<string, unknown>>,
  scope: Ref<HeroStatsScope> = ref("personal"),
) {
  const trend = useApiFetch<TrendResponse>("/stats/trend", { query });
  const patterns = useApiFetch<PatternsResponse>("/stats/patterns", { query });
  const drivers = useApiFetch<DriversResponse>("/stats/drivers", { query });
  // /stats/context is the only progression endpoint that serves the global
  // scope, and it answers with the team-composition dimension alone there. The
  // three above stay personal whatever the scope toggle says.
  const context = useApiFetch<ContextResponse>("/stats/context", {
    query: computed(() => ({ ...unref(query), scope: scope.value })),
  });
  return { trend, patterns, drivers, context };
}
