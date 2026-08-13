<script setup lang="ts">
import type { PlayerDetailResponse } from "~/types/analytics";
import type { MatchListResponse } from "~/types/matches";

definePageMeta({ middleware: "auth" });

const route = useRoute();
const battletag = route.params.battletag as string;
const config = useRuntimeConfig();

const { data, error, refresh } = await useApiFetch<PlayerDetailResponse>(
  `/players/${encodeURIComponent(battletag)}`,
);

const playerSeoDescription = computed(
  () => `Statistiques des parties partagées avec ${battletag} sur Heroes of the Storm.`,
);

useSeoMeta({
  title: battletag,
  description: () => playerSeoDescription.value,
  ogTitle: `${battletag} - HotS Analytics`,
  ogDescription: () => playerSeoDescription.value,
  ogImage: "/og/players-[battletag].png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/players-[battletag].png",
  robots: "noindex, follow",
});

const page = ref(1);
const pageSize = 20;

const { data: matchesData, pending } = await useApiFetch<MatchListResponse>("/matches", {
  query: computed(() => ({ opponentBattletag: battletag, page: page.value, pageSize })),
});

const columns = [
  { key: "playedAt", label: "Date" },
  { key: "mapName", label: "Carte" },
  { key: "gameMode", label: "Mode" },
  { key: "heroName", label: "Ton héros" },
  { key: "result", label: "Résultat" },
];

const topHeroes = computed(() => data.value?.heroBreakdown ?? []);
const opponentTopHeroes = computed(() => data.value?.opponentHeroBreakdown ?? []);
const mapBreakdown = computed(() => data.value?.mapBreakdown ?? []);
const hasVsGames = computed(() => (data.value?.player.gamesAsOpponent ?? 0) > 0);

const sendingRequest = ref(false);
const requestError = ref("");

const annotationsStore = usePlayerAnnotationsStore();
const managementForm = reactive({ isFdp: false, isPgm: false, note: "" });
const managementLoaded = ref(false);
const savingManagement = ref(false);
const managementSaved = ref(false);

onMounted(async () => {
  const annotation = await annotationsStore.fetchOne(battletag);
  managementForm.isFdp = annotation.isFdp;
  managementForm.isPgm = annotation.isPgm;
  managementForm.note = annotation.note;
  managementLoaded.value = true;
});

async function saveManagement() {
  savingManagement.value = true;
  managementSaved.value = false;
  try {
    await annotationsStore.save(battletag, { ...managementForm });
    managementSaved.value = true;
  } finally {
    savingManagement.value = false;
  }
}

async function addFriend() {
  if (!data.value?.player.accountUserId) return;
  sendingRequest.value = true;
  requestError.value = "";
  try {
    await $fetch("/friends/requests", {
      method: "POST",
      baseURL: config.public.apiBase,
      credentials: "include",
      body: { userId: data.value.player.accountUserId },
    });
    await refresh();
  } catch (err) {
    requestError.value = (err as { data?: { error?: string } })?.data?.error ?? "Erreur lors de l'envoi";
  } finally {
    sendingRequest.value = false;
  }
}

function goToMatch(row: Record<string, unknown>) {
  navigateTo(`/matches/${row.id}`);
}
</script>

<template>
  <div v-if="error" class="rounded-lg border border-border bg-surface p-8 text-center text-muted">
    Aucune partie en commun avec ce joueur.
  </div>

  <div v-else-if="data" class="space-y-8">
    <div>
      <NuxtLink to="/players" class="text-sm text-brand hover:underline">&larr; Retour aux joueurs</NuxtLink>
      <div class="mt-2 flex flex-wrap items-center gap-3">
        <h1 class="break-all font-heading text-2xl font-semibold font-mono">{{ data.player.battletag }}</h1>
        <PlayersAnnotationBadges :battletag="data.player.battletag" />

        <NuxtLink
          v-if="data.player.friendshipStatus === 'friends'"
          :to="`/friends/${data.player.accountUserId}`"
          class="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success"
        >
          <UIcon name="i-heroicons-check-badge" class="h-4 w-4" />
          Ami · voir ses stats
        </NuxtLink>
        <span
          v-else-if="data.player.friendshipStatus === 'pending_outgoing'"
          class="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-xs text-muted"
        >
          Demande envoyée
        </span>
        <NuxtLink
          v-else-if="data.player.friendshipStatus === 'pending_incoming'"
          to="/friends"
          class="inline-flex items-center gap-1.5 rounded-full bg-brand/15 px-3 py-1 text-xs font-medium text-brand"
        >
          T'a demandé en ami · répondre
        </NuxtLink>
        <UButton
          v-else-if="data.player.accountUserId"
          size="xs"
          icon="i-heroicons-user-plus"
          :loading="sendingRequest"
          @click="addFriend"
        >
          Ajouter en ami
        </UButton>
      </div>
      <p v-if="requestError" class="mt-2 text-sm text-danger">{{ requestError }}</p>
    </div>

    <div class="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 class="font-heading text-lg font-medium">Gestion</h2>
      <div class="flex flex-wrap gap-6">
        <UCheckbox v-model="managementForm.isFdp" label="Marquer comme FDP" />
        <UCheckbox v-model="managementForm.isPgm" label="Marquer comme PGM" />
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">Note</label>
        <UTextarea
          v-model="managementForm.note"
          :rows="4"
          placeholder="Notes libres sur ce joueur (comportement, contexte, etc.)"
        />
      </div>
      <div class="flex items-center gap-3">
        <UButton :disabled="!managementLoaded" :loading="savingManagement" @click="saveManagement">
          Enregistrer
        </UButton>
        <span v-if="managementSaved" class="text-xs text-success">Enregistré.</span>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <UiStatTile label="Parties ensemble" :value="String(data.player.gamesTogether)" />
      <UiStatTile
        label="En tant qu'alliés"
        :value="`${data.player.winsAsAlly} V / ${data.player.gamesAsAlly - data.player.winsAsAlly} D`"
        :sublabel="`${data.player.gamesAsAlly} parties`"
      />
      <UiStatTile
        label="En tant qu'adversaires"
        :value="`${data.player.winsAsOpponent} V / ${data.player.gamesAsOpponent - data.player.winsAsOpponent} D`"
        :sublabel="`${data.player.gamesAsOpponent} parties`"
      />
      <UiStatTile
        label="Victoires totales"
        :value="String(data.player.winsAsAlly + data.player.winsAsOpponent)"
        tone="success"
      />
    </div>

    <div v-if="!hasVsGames" class="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
      Aucune partie en tant qu'adversaire avec ce joueur — impossible de calculer une confrontation directe.
    </div>

    <template v-else>
      <div v-if="topHeroes.length > 0">
        <h2 class="mb-3 font-heading text-lg font-medium">Tes héros face à ce joueur</h2>
        <UiTopHeroesTop3 :heroes="topHeroes" />
      </div>

      <div v-if="opponentTopHeroes.length > 0">
        <h2 class="mb-3 font-heading text-lg font-medium">Ses héros face à toi</h2>
        <UiTopHeroesTop3 :heroes="opponentTopHeroes" />
      </div>

      <div v-if="mapBreakdown.length > 0">
        <h2 class="mb-3 font-heading text-lg font-medium">Cartes jouées contre lui</h2>
        <UiMapWinrateList :maps="mapBreakdown" />
      </div>
    </template>

    <div>
      <h2 class="mb-3 font-heading text-lg font-medium">Historique des parties partagées</h2>

      <UiDataTable
        :columns="columns"
        :rows="matchesData?.matches ?? []"
        clickable
        mobile-primary-key="mapName"
        mobile-secondary-key="playedAt"
        mobile-badge-key="result"
        @row-click="goToMatch"
      >
        <template #cell-playedAt="{ row }">{{ formatDate(row.playedAt as string) }}</template>
        <template #cell-gameMode="{ row }">{{ formatGameMode(row.gameMode as never) }}</template>
        <template #cell-result="{ row }">
          <span :class="row.winner ? 'text-success' : 'text-danger'">
            {{ row.winner ? "Victoire" : "Défaite" }}
          </span>
        </template>
      </UiDataTable>

      <div class="mt-4 flex justify-center">
        <UPagination
          v-model="page"
          :page-count="pageSize"
          :total="matchesData?.total ?? 0"
          :disabled="pending"
        />
      </div>
    </div>
  </div>
</template>
