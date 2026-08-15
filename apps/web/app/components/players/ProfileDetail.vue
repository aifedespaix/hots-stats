<script setup lang="ts">
import type { PlayerDetailResponse } from "~/types/analytics";
import type { MatchListResponse } from "~/types/matches";

/**
 * The full player profile: the target's own real stats (when shared with a
 * friend), plus everything shared between them and the connected viewer.
 * Fetches its own data via `$fetch` (rather than `useApiFetch`) so it works
 * identically as a standalone page and mounted on demand inside a modal
 * (e.g. from the live draft).
 */
const props = defineProps<{ battletag: string }>();

const config = useRuntimeConfig();
const { data: authData } = await useAuthUser();
const ownBattletag = computed(() => authData.value?.user?.battletag ?? null);
const isSelf = computed(() => Boolean(ownBattletag.value) && ownBattletag.value === props.battletag);

const {
  data,
  pending,
  errored,
  notFound,
  refresh: loadProfile,
} = useAsyncResource<PlayerDetailResponse>({
  fetcher: () =>
    $fetch<PlayerDetailResponse>(`/players/${encodeURIComponent(props.battletag)}`, {
      baseURL: config.public.apiBase,
      credentials: "include",
    }),
  immediate: false,
});

const page = ref(1);
const pageSize = 20;
const {
  data: matchesData,
  pending: matchesPending,
  refresh: loadMatches,
} = useAsyncResource<MatchListResponse>({
  fetcher: () =>
    $fetch<MatchListResponse>("/matches", {
      baseURL: config.public.apiBase,
      credentials: "include",
      query: { opponentBattletag: props.battletag, page: page.value, pageSize },
    }),
  immediate: false,
});

watch(
  () => props.battletag,
  () => {
    page.value = 1;
    loadProfile();
    loadMatches();
  },
  { immediate: true },
);
watch(page, loadMatches);

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
const ownStats = computed(() => data.value?.ownStats ?? null);

const sendingRequest = ref(false);
const requestError = ref("");

const annotationsStore = usePlayerAnnotationsStore();
const managementForm = reactive<{ isFdp: boolean; isPgm: boolean; rating: number | null; note: string }>({
  isFdp: false,
  isPgm: false,
  rating: null,
  note: "",
});
const managementLoaded = ref(false);
const savingManagement = ref(false);
const managementSaved = ref(false);

watch(
  () => props.battletag,
  async (battletag) => {
    managementLoaded.value = false;
    const [annotation] = await Promise.all([
      annotationsStore.fetchMine(battletag),
      annotationsStore.fetchMany([battletag]),
    ]);
    managementForm.isFdp = annotation.isFdp;
    managementForm.isPgm = annotation.isPgm;
    managementForm.rating = annotation.rating;
    managementForm.note = annotation.note;
    managementLoaded.value = true;
  },
  { immediate: true },
);

async function saveManagement() {
  savingManagement.value = true;
  managementSaved.value = false;
  try {
    await annotationsStore.save(props.battletag, { ...managementForm });
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
    await loadProfile();
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
  <div v-if="pending" class="flex items-center justify-center py-16 text-muted">
    <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin" />
  </div>

  <UiErrorState v-else-if="notFound" :status-code="404" message="Aucune partie en commun avec ce joueur." />

  <div v-else-if="errored" class="space-y-3 rounded-lg border border-border bg-surface p-8 text-center text-muted">
    <p>Erreur lors du chargement des données de ce joueur. Réessaie dans un instant.</p>
    <UButton size="xs" variant="soft" icon="i-heroicons-arrow-path" @click="loadProfile">Réessayer</UButton>
  </div>

  <div v-else-if="data" class="space-y-8">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="break-all font-heading text-2xl font-semibold font-mono">{{ data.player.battletag }}</h1>
          <PlayersAnnotationBadges :battletag="data.player.battletag" />

          <span
            v-if="data.player.friendshipStatus === 'friends'"
            class="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success"
          >
            <UIcon name="i-heroicons-check-badge" class="h-4 w-4" />
            Ami
          </span>
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

      <UButton
        v-if="!isSelf"
        :to="`/face-a-face/${encodeURIComponent(data.player.battletag)}`"
        icon="i-lucide-swords"
      >
        Comparer nos stats
      </UButton>
    </div>

    <div v-if="ownStats" class="space-y-3">
      <h2 class="font-heading text-lg font-medium">Ses statistiques</h2>
      <StatsAccountSummaryStats :summary="ownStats.summary" />
      <div v-if="ownStats.topHeroes.length > 0">
        <h3 class="mb-2 text-sm font-medium text-muted">Ses héros les plus joués</h3>
        <UiTopHeroesTop3
          :heroes="ownStats.topHeroes.map((h) => ({ ...h, losses: h.gamesPlayed - h.wins }))"
        />
      </div>
    </div>
    <div v-else class="rounded-lg border border-dashed border-border bg-surface p-4 text-sm text-muted">
      Ajoute ce joueur en ami pour voir l'ensemble de ses statistiques (winrate, héros favoris, historique complet).
    </div>

    <div class="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 class="font-heading text-lg font-medium">Gestion</h2>
      <p class="text-xs text-muted">
        Ton marquage et ta note sont visibles par tes amis (et inversement) sur ce joueur.
      </p>
      <div class="flex flex-wrap gap-6">
        <UCheckbox v-model="managementForm.isFdp" label="Marquer comme FDP" />
        <UCheckbox v-model="managementForm.isPgm" label="Marquer comme sympa" />
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">Évaluation (1 à 5 étoiles)</label>
        <UiStarRating v-model="managementForm.rating" :readonly="false" size="h-5 w-5" />
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

    <div>
      <h2 class="mb-3 font-heading text-lg font-medium">Vos parties ensemble</h2>
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
          <span :class="row.winner ? TONE_TEXT_CLASS.success : TONE_TEXT_CLASS.danger">
            {{ row.winner ? "Victoire" : "Défaite" }}
          </span>
        </template>
      </UiDataTable>

      <div class="mt-4 flex justify-center">
        <UPagination
          v-model="page"
          :page-count="pageSize"
          :total="matchesData?.total ?? 0"
          :disabled="matchesPending"
        />
      </div>
    </div>
  </div>
</template>
