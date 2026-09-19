type ApiFetchOptions = {
  query?: Record<string, unknown> | ComputedRef<Record<string, unknown>>;
  /**
   * Every stats-bearing endpoint must be scoped by the global game-mode
   * filter (see useGameModeStore). Set to `false` only for routes that are
   * not mode-dependent (auth, tokens, profile identity, ...).
   */
  withGameMode?: boolean;
  /**
   * Every *personal* endpoint must be scoped by the active account selection
   * (see useAccountsStore). Set to `false` for routes that are not
   * account-scoped: auth, tokens, player annotations, admin, spatial
   * calibration.
   */
  withAccounts?: boolean;
  /**
   * Passed straight through to `useFetch`. The command palette is the only
   * caller that needs a deferred call (`lazy: true, immediate: false`) so the
   * three list endpoints are fetched when the palette first opens, never on
   * every page render.
   */
  lazy?: boolean;
  immediate?: boolean;
};

/**
 * Pure assembly of the global query parameters, exported so it can be unit
 * tested without a Nuxt runtime (there is none under vitest -- see
 * vitest.config.ts). `accounts` and `mode` are spread first, so a caller's
 * own `query` still wins if it needs to override one deliberately.
 */
export function buildApiQuery(input: {
  base: Record<string, unknown>;
  mode?: string;
  accounts?: string;
}): Record<string, unknown> {
  return {
    ...(input.accounts ? { accounts: input.accounts } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...input.base,
  };
}

/**
 * Root of every API call from the dashboard: bakes the active game-mode and
 * account selection into the query so no page/component can accidentally
 * bypass them. This is the single injection point required by the global
 * filter architecture - do not re-implement `mode` or `accounts` handling ad
 * hoc in a page, use this composable instead.
 */
export function useApiFetch<T>(url: string, opts: ApiFetchOptions = {}) {
  const config = useRuntimeConfig();
  const headers = import.meta.server ? useRequestHeaders(["cookie"]) : undefined;
  const withGameMode = opts.withGameMode ?? true;
  const withAccounts = opts.withAccounts ?? true;
  const gameModeStore = withGameMode ? useGameModeStore() : undefined;
  const accountsStore = withAccounts ? useAccountsStore() : undefined;
  const { data: authData } = useAuthUser();

  const query = computed(() =>
    buildApiQuery({
      base: (unref(opts.query) ?? {}) as Record<string, unknown>,
      mode: gameModeStore?.modeQueryParam,
      accounts: accountsStore
        ? accountsStore.accountsQueryParam(
            (authData.value?.user?.accounts ?? []).map((account) => account.battletag),
            authData.value?.user?.primaryBattletag ?? authData.value?.user?.battletag ?? null,
          )
        : undefined,
    }),
  );

  return useFetch<T>(url, {
    baseURL: config.public.apiBase,
    credentials: "include",
    headers,
    query,
    lazy: opts.lazy,
    immediate: opts.immediate,
  });
}
