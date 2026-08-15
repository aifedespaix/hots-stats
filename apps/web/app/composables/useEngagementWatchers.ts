import { useIntervalFn } from "@vueuse/core";
import type { FriendRequestsResponse } from "~/types/friends";
import type { MatchListResponse } from "~/types/matches";
import { isDraftSnapshotEmpty, useDraftStream } from "~/composables/useDraftStream";

const MATCHES_POLL_MS = 20_000;
const FRIENDS_POLL_MS = 25_000;

/**
 * Single entry point for the three "engagement" background signals (new
 * synced games, live draft, incoming friend requests): polls/watches each
 * source, updates `useEngagementStore` so nav chips stay reactive, and
 * fires the matching toast. Meant to be called exactly once, from the
 * always-mounted default layout -- calling it from individual pages would
 * duplicate the polling intervals.
 */
export function useEngagementWatchers() {
  const toast = useToast();
  const router = useRouter();
  const route = useRoute();
  const config = useRuntimeConfig();
  const engagement = useEngagementStore();
  const { data: authData } = useAuthUser();

  function isLoggedIn() {
    return !!authData.value?.user;
  }

  // --- Games sync -----------------------------------------------------
  async function pollMatches() {
    if (!isLoggedIn()) return;
    try {
      const gameModeStore = useGameModeStore();
      const res = await $fetch<MatchListResponse>("/matches", {
        baseURL: config.public.apiBase,
        credentials: "include",
        query: { page: 1, pageSize: 1, sortBy: "playedAt", sortDir: "desc", mode: gameModeStore.modeQueryParam },
      });

      const wasInitialized = engagement.matchesBaselineSet;
      engagement.reportMatchesTotal(res.total);
      if (!wasInitialized) return;

      const delta = engagement.unnotifiedNewMatches;
      if (delta <= 0) return;

      const latest = res.matches[0];
      if (delta === 1 && latest) {
        toast.add({
          title: "Nouvelle partie synchronisée",
          description: `${latest.heroName} sur ${latest.mapName} — ${latest.winner ? "Victoire" : "Défaite"}`,
          icon: latest.winner ? "i-heroicons-trophy" : "i-heroicons-cloud-arrow-down",
          color: latest.winner ? "success" : "neutral",
          duration: 10_000,
          actions: [{ label: "Voir le récap", onClick: () => router.push(`/matches/${latest.id}`) }],
        });
      } else {
        toast.add({
          title: `${delta} nouvelles parties synchronisées`,
          description: "Ton historique vient d'être mis à jour.",
          icon: "i-heroicons-cloud-arrow-down",
          duration: 8_000,
          actions: [{ label: "Voir l'historique", onClick: () => router.push("/matches") }],
        });
      }
      engagement.markMatchesNotified();
    } catch {
      // Best-effort background signal -- a failed poll must stay silent.
    }
  }

  // `immediate` only starts the timer right away -- it does *not* run the
  // callback before the first tick, that's `immediateCallback`. Without it
  // `matchesTotal` stays stuck at its default (0) for a full poll interval
  // after every page load, which is exactly when markMatchesVisited() (see
  // pages/matches/index.vue) or a stray toast could read a stale value.
  useIntervalFn(pollMatches, MATCHES_POLL_MS, { immediate: true, immediateCallback: true });

  // --- Friend requests --------------------------------------------------
  async function pollFriendRequests() {
    if (!isLoggedIn()) return;
    try {
      const res = await $fetch<FriendRequestsResponse>("/friends/requests", {
        baseURL: config.public.apiBase,
        credentials: "include",
      });
      const newRequests = engagement.reportFriendRequestIds(res.incoming.map((r) => r.id));
      if (newRequests.length === 0) return;

      for (const request of res.incoming.filter((r) => newRequests.includes(r.id))) {
        toast.add({
          title: "Nouvelle demande d'ami",
          description: `${request.user.displayName} souhaite t'ajouter en ami.`,
          icon: "i-heroicons-user-plus",
          color: "primary",
          duration: 12_000,
          actions: [{ label: "Voir la demande", onClick: () => router.push("/friends") }],
        });
      }
      engagement.markFriendRequestsNotified(newRequests);
    } catch {
      // Best-effort background signal -- a failed poll must stay silent.
    }
  }

  useIntervalFn(pollFriendRequests, FRIENDS_POLL_MS, { immediate: true, immediateCallback: true });

  // --- Live draft ---------------------------------------------------------
  const { snapshot: draftSnapshot } = useDraftStream();

  watch(draftSnapshot, (snap) => {
    if (!isLoggedIn() || !snap || isDraftSnapshotEmpty(snap)) return;
    if (route.path.startsWith("/draft")) return;
    if (engagement.lastToastedDraftId === snap.id) return;

    engagement.lastToastedDraftId = snap.id;
    toast.add({
      title: "Draft en direct détectée",
      description: "Une nouvelle partie a été repérée -- suis les compos en temps réel.",
      icon: "i-heroicons-bolt",
      color: "primary",
      duration: 15_000,
      actions: [{ label: "Ouvrir la Live Draft", onClick: () => router.push("/draft") }],
    });
  });

  return { pendingFriendRequestCount: computed(() => engagement.pendingFriendRequestCount) };
}
