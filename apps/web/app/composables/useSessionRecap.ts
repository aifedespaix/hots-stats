import type { SessionRecapResponse } from "@hots-stats/shared-types";

/**
 * The E1 session recap for the current viewer. Personal-only: GET
 * /stats/session refuses the global scope (see the API route), exactly like
 * /patterns, /trend, /drivers, /context and /killers. useApiFetch bakes the
 * active game-mode and account selection into the request.
 */
export function useSessionRecap(
  query?: Record<string, unknown> | ComputedRef<Record<string, unknown>>,
) {
  return useApiFetch<SessionRecapResponse>("/stats/session", { query });
}
