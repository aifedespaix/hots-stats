type ApiFetchOptions = {
  query?: Record<string, unknown> | ComputedRef<Record<string, unknown>>;
};

export function useApiFetch<T>(url: string, opts: ApiFetchOptions = {}) {
  const config = useRuntimeConfig();
  const headers = import.meta.server ? useRequestHeaders(["cookie"]) : undefined;

  return useFetch<T>(url, {
    baseURL: config.public.apiBase,
    credentials: "include",
    headers,
    query: opts.query,
  });
}
