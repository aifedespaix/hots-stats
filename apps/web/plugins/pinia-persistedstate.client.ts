import { createPersistedState } from "pinia-plugin-persistedstate";

// Client-only: persistence reads/writes localStorage, which doesn't exist
// during SSR. Stores render with their default state on the server and pick
// up whatever was saved locally once this plugin runs on the client.
export default defineNuxtPlugin(({ $pinia }) => {
  ($pinia as import("pinia").Pinia).use(createPersistedState({ storage: localStorage }));
});
