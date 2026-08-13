// Runs once per app mount (client-only, mirrors the pinia-persistedstate.client.ts
// precedent for "app-wide, run-once, client-only" concerns rather than bolting
// this onto layouts/default.vue, which is otherwise pure presentation).
// useBattletagSuggestion() itself no-ops when the user is unauthenticated or
// already has a battletag, so no extra route guard is needed here.
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook("app:mounted", () => {
    useBattletagSuggestion().promptIfApplicable();
  });
});
