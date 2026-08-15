import type { WatchSource } from "vue";

interface UseAsyncResourceOptions<T> {
  fetcher: () => Promise<T>;
  watch?: WatchSource | WatchSource[];
  immediate?: boolean; // default true
}

interface UseAsyncResourceReturn<T> {
  data: Ref<T | undefined>;
  pending: Ref<boolean>;
  errored: Ref<boolean>;
  notFound: Ref<boolean>;
  refresh: () => Promise<void>;
}

/**
 * Generic replacement for the repeated `pending/errored(/notFound)` +
 * `try/catch/finally` + `watch` pattern used to fetch a single resource
 * (draft threats, matchup search, profile detail, ...).
 */
export function useAsyncResource<T>(options: UseAsyncResourceOptions<T>): UseAsyncResourceReturn<T> {
  const data = ref<T>() as Ref<T | undefined>;
  const pending = ref(false);
  const errored = ref(false);
  const notFound = ref(false);

  async function refresh() {
    pending.value = true;
    errored.value = false;
    notFound.value = false;
    try {
      data.value = await options.fetcher();
    } catch (err) {
      if ((err as { statusCode?: number })?.statusCode === 404) {
        notFound.value = true;
      } else {
        errored.value = true;
      }
    } finally {
      pending.value = false;
    }
  }

  if (options.watch) {
    watch(options.watch, refresh);
  }

  if (options.immediate !== false) {
    refresh();
  }

  return { data, pending, errored, notFound, refresh };
}
