type ApiFetchOptions = {
  query?: Record<string, unknown> | ComputedRef<Record<string, unknown>>;
  /**
   * Every stats-bearing endpoint must be scoped by the global game-mode
   * filter (see useGameModeStore). Set to `false` only for routes that are
   * not mode-dependent (auth, tokens, profile identity, ...).
   */
  withGameMode?: boolean;
};

/**
 * Root of every stats API call: bakes the active game-mode filter into the
 * query so no page/component can accidentally bypass it. This is the single
 * injection point required by the global filter architecture - do not
 * re-implement `mode` handling ad hoc in a page, use this composable instead.
 */
export function useApiFetch<T>(url: string, opts: ApiFetchOptions = {}) {
  const config = useRuntimeConfig();
  const headers = import.meta.server ? useRequestHeaders(["cookie"]) : undefined;
  const withGameMode = opts.withGameMode ?? true;
  const gameModeStore = withGameMode ? useGameModeStore() : undefined;

  const query = computed(() => {
    const base = unref(opts.query) ?? {};
    if (!gameModeStore) return base;
    return { mode: gameModeStore.modeQueryParam, ...base };
  });

  return useFetch<T>(url, {
    baseURL: config.public.apiBase,
    credentials: "include",
    headers,
    query,
  });
}
