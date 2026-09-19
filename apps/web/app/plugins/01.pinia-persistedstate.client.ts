import { createPersistedState, type StorageLike } from "pinia-plugin-persistedstate";
import type { Pinia } from "pinia";

// Client-only: persistence reads/writes localStorage, which doesn't exist
// during SSR. Stores render with their default state on the server.
//
// The restore, however, must not happen *while Vue is hydrating* the server
// HTML. Several persisted stores (game-mode, accounts, ...) feed every
// useApiFetch query, so restoring them mid-hydration changes the request key,
// makes Nuxt drop the SSR payload and re-render each panel into its "loading"
// state while Vue is still patching the server markup. Vue can't recover from
// that patch: it throws `insertBefore` / "Cannot read properties of null
// (reading 'emitsOptions')" and the page stays broken (no navigation) until a
// client-side route change. Reading from storage is therefore suppressed until
// hydration is over (`app:suspense:resolve`), at which point every persisted
// store is hydrated explicitly; the stores then update reactively like any
// other post-hydration state change.
let readsEnabled = false;

const deferredStorage: StorageLike = {
  getItem: (key) => (readsEnabled ? localStorage.getItem(key) : null),
  setItem: (key, value) => localStorage.setItem(key, value),
};

export default defineNuxtPlugin((nuxtApp) => {
  const deferredHydration: { $hydrate: () => void }[] = [];
  const persist = createPersistedState({ storage: deferredStorage });

  (nuxtApp.$pinia as Pinia).use((context) => {
    persist(context);
    const store = context.store as unknown as { $hydrate?: () => void };
    if (typeof store.$hydrate === "function") {
      deferredHydration.push(store as { $hydrate: () => void });
    }
  });

  // `app:suspense:resolve` (not `app:mounted`) is the first hook that runs
  // once the page's async component tree has finished hydrating -- restoring
  // at `app:mounted` still fires while <Suspense> is resolving the page on
  // the initial load, which is exactly the mid-hydration window we must avoid.
  nuxtApp.hook("app:suspense:resolve", () => {
    if (readsEnabled) return;
    readsEnabled = true;
    for (const store of deferredHydration) {
      store.$hydrate();
    }
  });
});
