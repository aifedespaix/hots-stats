import { nextTick, watch } from "vue";
import type { LocationQueryRaw } from "vue-router";
import type { UrlFilterSpec, UrlFilterValue } from "~/utils/urlFilters";
import { createUrlFilterSync } from "~/utils/urlFilters";

export interface UseUrlFilterSyncOptions {
  specs: readonly UrlFilterSpec[];
  defaults: Record<string, unknown>;
  read: () => Record<string, unknown>;
  write: (values: Record<string, UrlFilterValue>) => void;
}

/**
 * Projects a page existing filter stores into the query string and back.
 * The stores stay the source of truth; the URL is only a projection.
 *
 * URL wins over the persisted stores on load. On the server the values are
 * applied during setup (before the first useApiFetch), so SSR honours the URL.
 * On the client, pinia-plugin-persistedstate restores localStorage at
 * app:suspense:resolve, which would overwrite the URL values, so the URL is
 * re-applied in that same hook. A client-side navigation, where the stores are
 * already hydrated, applies it during setup and needs no hook.
 *
 * Pagination is re-applied after nextTick because the pages existing
 * "filter changed -> page = 1" watchers fire after a re-hydration.
 */
export function useUrlFilterSync(options: UseUrlFilterSyncOptions) {
  const route = useRoute();
  const router = useRouter();
  const sync = createUrlFilterSync({
    specs: options.specs,
    defaults: options.defaults,
    read: options.read,
    write: options.write,
    readQuery: () => route.query,
    writeQuery: (query) => {
      void router.replace({ query: query as LocationQueryRaw });
    },
  });

  // URL -> stores, synchronously: SSR (and the first client render) fetch with
  // the URL filters, never the persisted/server defaults.
  sync.hydrate();

  if (import.meta.server) return sync;

  const nuxtApp = useNuxtApp();
  sync.start();

  function rehydrate() {
    const rehydrated = sync.hydrate();
    void nextTick(() => {
      sync.apply(rehydrated);
      sync.project();
    });
  }

  if (nuxtApp.isHydrating) {
    nuxtApp.hook("app:suspense:resolve", rehydrate);
  } else {
    rehydrate();
  }

  // An external query change on the already-mounted page (a pasted URL, a link
  // carrying another query) must still drive the stores. Our own project()
  // replaces are a no-op here because hydrate() only writes actual differences.
  watch(
    () => route.query,
    () => rehydrate(),
    { deep: true },
  );

  return sync;
}
