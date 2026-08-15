/**
 * "Is this you?" onboarding nudge for an account that never set a battletag
 * but already has upload history: detect it, offer to save it in one click,
 * then chain an offer to create a public profile from the pseudo. Composables
 * used across the async chain (toast, config, router, the shared auth-user
 * fetch) are all captured once up front rather than re-invoked after an
 * `await`, since this composable itself only ever runs client-side (see
 * plugins/battletag-suggestion.client.ts).
 */
export function useBattletagSuggestion() {
  const config = useRuntimeConfig();
  const toast = useToast();
  const router = useRouter();
  const { data: authData, refresh: refreshAuth } = useAuthUser();

  async function createHandleWithRetry(baseName: string, maxAttempts = 5): Promise<string | null> {
    const base = slugify(baseName);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
      const candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`;
      try {
        await $fetch("/auth/me", {
          method: "PATCH",
          baseURL: config.public.apiBase,
          credentials: "include",
          body: { publicHandle: candidate },
        });
        return candidate;
      } catch (err) {
        if ((err as { statusCode?: number })?.statusCode !== 409) throw err;
      }
    }
    return null;
  }

  async function offerPublicProfile() {
    const displayName = authData.value?.user?.displayName ?? "";

    toast.add({
      title: "Créer ton profil public ?",
      description: "Une page consultable sans connexion, simple à partager sur Discord — juste ton pseudo, pas ton BattleTag.",
      icon: "i-heroicons-identification",
      duration: 12000,
      actions: [
        {
          label: "Créer mon profil",
          onClick: async () => {
            const handle = await createHandleWithRetry(displayName);
            await refreshAuth();
            if (handle) {
              toast.add({
                title: "Profil public créé !",
                description: `Consultable sur /u/${handle}`,
                icon: "i-heroicons-check-circle",
                color: "success",
              });
            } else {
              toast.add({
                title: "Impossible de choisir un nom automatiquement",
                description: "Choisis un profil public depuis les Paramètres.",
                icon: "i-heroicons-exclamation-triangle",
                actions: [{ label: "Aller aux Paramètres", onClick: () => router.push("/settings") }],
              });
            }
          },
        },
      ],
    });
  }

  async function saveSuggestedBattletag(battletag: string) {
    await $fetch("/auth/me", {
      method: "PATCH",
      baseURL: config.public.apiBase,
      credentials: "include",
      body: { battletag },
    });
    await refreshAuth();
    toast.add({
      title: "BattleTag enregistré !",
      description: `${battletag} est maintenant lié à ton compte, avec tout ton historique déjà uploadé.`,
      icon: "i-heroicons-check-circle",
      color: "success",
    });
    // A deliberate pause, not just pacing: Nuxt UI's useToast() ids new
    // notifications from Date.now() and silently drops one whose id collides
    // with an existing entry, so firing this immediately after the toast
    // above (same millisecond) can make it vanish before it's ever shown.
    await new Promise((resolve) => setTimeout(resolve, 600));
    await offerPublicProfile();
  }

  async function promptIfApplicable() {
    const user = authData.value?.user;
    if (!user || user.battletag) return;

    try {
      const res = await $fetch<{ suggestion: string | null }>("/auth/me/battletag-suggestion", {
        baseURL: config.public.apiBase,
        credentials: "include",
      });
      if (!res.suggestion) return;

      const battletag = res.suggestion;
      toast.add({
        title: `On dirait que c'est toi : ${battletag}`,
        description: "Détecté depuis les parties que tu as uploadées. L'enregistrer sur ton compte ?",
        icon: "i-heroicons-sparkles",
        duration: 20000,
        actions: [{ label: "Enregistrer", onClick: () => saveSuggestedBattletag(battletag) }],
      });
    } catch {
      // Best-effort nudge the user never asked for -- a failed check must stay silent, not surface an error toast.
    }
  }

  return { promptIfApplicable };
}
