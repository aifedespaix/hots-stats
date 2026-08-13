<script setup lang="ts">
import type {
  FriendRequestsResponse,
  FriendSearchResponse,
  FriendSearchResult,
  FriendsListResponse,
} from "~/types/friends";

definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Amis",
  description: "Gère tes amis Heroes of the Storm : demandes, ajout et consultation de leurs statistiques.",
  ogTitle: "Amis - HotS Analytics",
  ogDescription: "Gère tes amis Heroes of the Storm : demandes, ajout et consultation de leurs statistiques.",
  ogImage: "/og/friends-index.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/friends-index.png",
  robots: "noindex, follow",
});

const config = useRuntimeConfig();

const { data: friendsData, refresh: refreshFriends } = await useApiFetch<FriendsListResponse>("/friends");
const { data: requestsData, refresh: refreshRequests } =
  await useApiFetch<FriendRequestsResponse>("/friends/requests");

const search = ref("");
const searchResults = ref<FriendSearchResult[]>([]);
const searching = ref(false);
const actionError = ref("");
let searchTimeout: ReturnType<typeof setTimeout> | undefined;

watch(search, (value) => {
  if (searchTimeout) clearTimeout(searchTimeout);
  const term = value.trim();
  if (term.length < 2) {
    searchResults.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  searchTimeout = setTimeout(async () => {
    try {
      const res = await $fetch<FriendSearchResponse>("/friends/search", {
        baseURL: config.public.apiBase,
        credentials: "include",
        query: { q: term },
      });
      searchResults.value = res.results;
    } finally {
      searching.value = false;
    }
  }, 300);
});

async function refreshAll() {
  await Promise.all([refreshFriends(), refreshRequests()]);
}

function extractError(err: unknown): string {
  return (err as { data?: { error?: string } })?.data?.error ?? "Une erreur est survenue";
}

async function sendRequest(result: FriendSearchResult) {
  actionError.value = "";
  try {
    const res = await $fetch<{ outcome: "requested" | "friends" }>("/friends/requests", {
      method: "POST",
      baseURL: config.public.apiBase,
      credentials: "include",
      body: { userId: result.id },
    });
    result.friendshipStatus = res.outcome === "friends" ? "friends" : "pending_outgoing";
    await refreshAll();
  } catch (err) {
    actionError.value = extractError(err);
  }
}

async function acceptRequest(id: string) {
  actionError.value = "";
  try {
    await $fetch(`/friends/requests/${id}/accept`, {
      method: "POST",
      baseURL: config.public.apiBase,
      credentials: "include",
    });
    await refreshAll();
  } catch (err) {
    actionError.value = extractError(err);
  }
}

async function declineRequest(id: string) {
  actionError.value = "";
  try {
    await $fetch(`/friends/requests/${id}/decline`, {
      method: "POST",
      baseURL: config.public.apiBase,
      credentials: "include",
    });
    await refreshRequests();
  } catch (err) {
    actionError.value = extractError(err);
  }
}

async function cancelRequest(id: string) {
  actionError.value = "";
  try {
    await $fetch(`/friends/requests/${id}`, {
      method: "DELETE",
      baseURL: config.public.apiBase,
      credentials: "include",
    });
    await refreshRequests();
  } catch (err) {
    actionError.value = extractError(err);
  }
}

async function removeFriend(userId: string) {
  actionError.value = "";
  try {
    await $fetch(`/friends/${userId}`, {
      method: "DELETE",
      baseURL: config.public.apiBase,
      credentials: "include",
    });
    await refreshFriends();
  } catch (err) {
    actionError.value = extractError(err);
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-8">
    <div>
      <h1 class="font-heading text-2xl font-semibold">Amis</h1>
      <p class="mt-1 text-sm text-muted">
        Ajoute des joueurs en ami pour consulter leurs statistiques complètes.
      </p>
    </div>

    <p v-if="actionError" class="rounded-md border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
      {{ actionError }}
    </p>

    <section class="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 class="font-heading text-lg">Ajouter un ami</h2>
      <UInput v-model="search" placeholder="Rechercher par BattleTag ou pseudo public" icon="i-lucide-search" />

      <ul v-if="search.trim().length >= 2" class="divide-y divide-border">
        <li v-if="searching" class="py-3 text-sm text-muted">Recherche...</li>
        <li v-else-if="searchResults.length === 0" class="py-3 text-sm text-muted">Aucun joueur trouvé.</li>
        <li
          v-for="result in searchResults"
          :key="result.id"
          class="flex items-center justify-between gap-3 py-3"
        >
          <div class="min-w-0">
            <p class="truncate font-medium">{{ result.displayName }}</p>
            <p v-if="result.battletag" class="truncate font-mono text-xs text-muted">{{ result.battletag }}</p>
          </div>
          <UButton
            v-if="result.friendshipStatus === 'none'"
            size="sm"
            icon="i-heroicons-user-plus"
            @click="sendRequest(result)"
          >
            Ajouter
          </UButton>
          <span v-else-if="result.friendshipStatus === 'friends'" class="shrink-0 text-sm text-success">
            Déjà ami
          </span>
          <span v-else-if="result.friendshipStatus === 'pending_outgoing'" class="shrink-0 text-sm text-muted">
            Demande envoyée
          </span>
          <span v-else-if="result.friendshipStatus === 'pending_incoming'" class="shrink-0 text-sm text-brand">
            T'a demandé en ami
          </span>
        </li>
      </ul>
    </section>

    <section
      v-if="(requestsData?.incoming.length ?? 0) > 0"
      class="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-6"
    >
      <h2 class="font-heading text-lg">Demandes reçues</h2>
      <ul class="divide-y divide-border">
        <li
          v-for="request in requestsData?.incoming"
          :key="request.id"
          class="flex items-center justify-between gap-3 py-3"
        >
          <div class="min-w-0">
            <p class="truncate font-medium">{{ request.user.displayName }}</p>
            <p v-if="request.user.battletag" class="truncate font-mono text-xs text-muted">
              {{ request.user.battletag }}
            </p>
          </div>
          <div class="flex shrink-0 gap-2">
            <UButton size="sm" color="green" icon="i-heroicons-check" @click="acceptRequest(request.id)">
              Accepter
            </UButton>
            <UButton
              size="sm"
              color="red"
              variant="ghost"
              icon="i-heroicons-x-mark"
              @click="declineRequest(request.id)"
            >
              Refuser
            </UButton>
          </div>
        </li>
      </ul>
    </section>

    <section
      v-if="(requestsData?.outgoing.length ?? 0) > 0"
      class="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-6"
    >
      <h2 class="font-heading text-lg">Demandes envoyées</h2>
      <ul class="divide-y divide-border">
        <li
          v-for="request in requestsData?.outgoing"
          :key="request.id"
          class="flex items-center justify-between gap-3 py-3"
        >
          <div class="min-w-0">
            <p class="truncate font-medium">{{ request.user.displayName }}</p>
            <p v-if="request.user.battletag" class="truncate font-mono text-xs text-muted">
              {{ request.user.battletag }}
            </p>
          </div>
          <UButton size="sm" variant="ghost" color="red" @click="cancelRequest(request.id)">Annuler</UButton>
        </li>
      </ul>
    </section>

    <section class="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 class="font-heading text-lg">Mes amis</h2>
      <ul v-if="(friendsData?.friends.length ?? 0) > 0" class="divide-y divide-border">
        <li
          v-for="friend in friendsData?.friends"
          :key="friend.id"
          class="flex items-center justify-between gap-3 py-3"
        >
          <NuxtLink
            :to="friend.battletag ? `/players/${encodeURIComponent(friend.battletag)}` : `/friends/${friend.id}`"
            class="min-w-0 flex-1 hover:text-brand"
          >
            <p class="truncate font-medium">{{ friend.displayName }}</p>
            <p v-if="friend.battletag" class="truncate font-mono text-xs text-muted">{{ friend.battletag }}</p>
          </NuxtLink>
          <div class="flex shrink-0 items-center gap-2">
            <UButton
              :to="friend.battletag ? `/players/${encodeURIComponent(friend.battletag)}` : `/friends/${friend.id}`"
              size="sm"
              variant="soft"
              icon="i-heroicons-user-circle"
            >
              Profil
            </UButton>
            <UButton
              v-if="friend.battletag"
              :to="`/face-a-face/${encodeURIComponent(friend.battletag)}`"
              size="sm"
              icon="i-lucide-swords"
            >
              Face-à-Face
            </UButton>
            <UButton size="sm" variant="ghost" color="red" icon="i-heroicons-user-minus" @click="removeFriend(friend.id)" />
          </div>
        </li>
      </ul>
      <p v-else class="py-4 text-center text-sm text-muted">Aucun ami pour le moment.</p>
    </section>
  </div>
</template>
