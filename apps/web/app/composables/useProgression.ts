import type {
  ContextResponse,
  DriverMetric,
  DriversResponse,
  PatternsResponse,
  TrendResponse,
} from "@hots-stats/shared-types";

/** How many work axes the hub surfaces (B1 section 3). */
export const WORK_AXES_LIMIT = 3;

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
export function useProgression(query: ComputedRef<Record<string, unknown>>) {
  const trend = useApiFetch<TrendResponse>("/stats/trend", { query });
  const patterns = useApiFetch<PatternsResponse>("/stats/patterns", { query });
  const drivers = useApiFetch<DriversResponse>("/stats/drivers", { query });
  const context = useApiFetch<ContextResponse>("/stats/context", { query });
  return { trend, patterns, drivers, context };
}
