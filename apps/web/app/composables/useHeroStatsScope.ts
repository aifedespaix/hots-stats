import type { HeroStatsScope } from "@hots-stats/shared-types";

/** Persisted on the user's account, shared by every page that shows hero stats. */
export function useHeroStatsScope() {
  const config = useRuntimeConfig();
  const { data: authData, refresh: refreshAuth } = useAuthUser();

  const scope = computed<HeroStatsScope>(() => authData.value?.user?.heroStatsScope ?? "personal");
  const saving = ref(false);

  async function setScope(value: HeroStatsScope) {
    if (value === scope.value) return;
    saving.value = true;
    try {
      await $fetch("/auth/me", {
        method: "PATCH",
        baseURL: config.public.apiBase,
        credentials: "include",
        body: { heroStatsScope: value },
      });
      await refreshAuth();
    } finally {
      saving.value = false;
    }
  }

  return { scope, saving, setScope };
}
