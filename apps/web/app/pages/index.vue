<script setup lang="ts">
import type { DriversResponse, SessionRecapResponse, TrendResponse } from "@hots-stats/shared-types";
import type { MatchListResponse, StatsSummary } from "~/types/matches";
import type { NavCardColor } from "~/components/ui/NavCard.vue";
import { selectWorkAxes } from "~/composables/useProgression";
import { useSessionRecap } from "~/composables/useSessionRecap";

definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Dashboard",
  description:
    "Vue d'ensemble de tes statistiques Heroes of the Storm : winrate, parties récentes et accès rapide à ton historique.",
  ogTitle: "Dashboard - HotS Analytics",
  ogDescription:
    "Vue d'ensemble de tes statistiques Heroes of the Storm : winrate, parties récentes et accès rapide à ton historique.",
  ogImage: "/og/index.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/index.png",
  robots: "noindex, follow",
});

const { data: authData } = await useAuthUser();

const engagement = useEngagementStore();
const { snapshot: draftSnapshot } = useDraftStream();
const isLiveDraftActive = computed(() => !isDraftSnapshotEmpty(draftSnapshot.value));

interface NavCardConfig {
  to: string;
  icon: string;
  title: string;
  description: string;
  color: NavCardColor;
  chip?: { show: boolean; text?: string };
}

const quickActionCards: NavCardConfig[] = [
  {
    to: "/upload",
    icon: "i-heroicons-cloud-arrow-up",
    title: "Envoyer une partie",
    description: "Ajoute tes derniers replays pour mettre à jour tes statistiques.",
    color: "brand",
  },
  {
    to: "/draft",
    icon: "i-heroicons-bolt",
    title: "Live Draft",
    description: "Suis un draft en direct et reçois des conseils de pick en temps réel.",
    color: "danger",
  },
];

const statsCards = computed<NavCardConfig[]>(() => [
  {
    to: "/matches",
    icon: "i-heroicons-clock",
    title: "Historique",
    description: "Retrouve et filtre toutes tes parties enregistrées.",
    color: "info",
    chip: {
      show: engagement.newMatchesSinceVisit > 0,
      text: engagement.newMatchesSinceVisit > 99 ? "99+" : String(engagement.newMatchesSinceVisit),
    },
  },
  {
    to: "/heroes",
    icon: "i-heroicons-fire",
    title: "Héros",
    description: "Consulte les statistiques et builds de chaque héros.",
    color: "role-melee",
  },
  {
    to: "/maps",
    icon: "i-heroicons-map",
    title: "Cartes",
    description: "Compare les win rates et stratégies par carte.",
    color: "role-tank",
  },
  {
    to: "/talents",
    icon: "i-heroicons-sparkles",
    title: "Talents",
    description: "Explore les taux de sélection et de victoire des talents.",
    color: "accent",
  },
  {
    to: "/players",
    icon: "i-heroicons-user-group",
    title: "Joueurs",
    description: "Recherche un joueur et analyse son profil.",
    color: "role-support",
  },
]);

const progressCards = computed<NavCardConfig[]>(() => [
  {
    to: "/progress",
    icon: "i-heroicons-arrow-trending-up",
    title: "Progression",
    description: "Tendance, patterns récurrents et axes de travail sur tes parties.",
    color: "accent",
  },
  {
    to: "/session",
    icon: "i-heroicons-clipboard-document-list",
    title: "Récap session",
    description: "Ton dernier bilan de session et son écart à ta moyenne.",
    color: "accent",
  },
  {
    to: "/analysis",
    icon: "i-heroicons-chart-bar",
    title: "Diagnostic",
    description: "Identifie tes points forts et tes axes de progression.",
    color: "role-healer",
  },
  {
    to: "/friends",
    icon: "i-heroicons-users",
    title: "Amis",
    description: "Gère ta liste d'amis et les demandes en attente.",
    color: "role-bruiser",
    chip: {
      show: engagement.pendingFriendRequestCount > 0,
      text: engagement.pendingFriendRequestCount > 99 ? "99+" : String(engagement.pendingFriendRequestCount),
    },
  },
]);

const accountCards: NavCardConfig[] = [
  {
    to: "/settings",
    icon: "i-heroicons-cog-6-tooth",
    title: "Paramètres",
    description: "Personnalise ton compte et tes préférences.",
    color: "role-ranged",
  },
];

// Always personal: this page has no scope toggle, so it must never inherit
// `heroStatsScope` (the account-wide personal/global preference set on the
// Heroes/Talents/Friends pages) -- otherwise "Parties jouées" here silently
// switches to counting every match ever recorded by the app, across every
// player, the moment the user has toggled "Toute l'app" anywhere else.
const { data: summary } = await useApiFetch<StatsSummary>("/stats/summary", { query: { scope: "personal" } });

const { data: recentMatches } = await useApiFetch<MatchListResponse>("/matches", {
  query: { page: 1, pageSize: 8 },
});

// Both additive B2 calls are personal for the same reason as `summary` above:
// the Dashboard must never inherit the global `heroStatsScope` preference.
// Neither is awaited, so the base load stays the single
// `/stats/summary` + `/matches?pageSize=8` round-trip it was before B2.
// `/stats/trend` is fetched once and shared by the sparkline tile and the
// last-session card; `/stats/drivers` powers the #1 work-axis card.
const { data: trend, pending: trendPending, error: trendError } = useApiFetch<TrendResponse>(
  "/stats/trend",
  { query: { scope: "personal" } },
);
const { data: drivers, pending: driversPending, error: driversError } = useApiFetch<DriversResponse>(
  "/stats/drivers",
  { query: { scope: "personal" } },
);

// The "Dernière session" card now reads the E1 endpoint (GET /stats/session)
// instead of re-clustering the trend points client-side: one source of truth
// for the 90-minute rule. Not awaited, like the other additive B2 calls.
const {
  data: sessionRecap,
  pending: sessionPending,
  error: sessionError,
} = useSessionRecap({ scope: "personal" });

const topAxis = computed(() =>
  drivers.value ? (selectWorkAxes(drivers.value.drivers)[0] ?? null) : null,
);

const columns = [
  { key: "playedAt", label: "Date" },
  { key: "mapName", label: "Carte" },
  { key: "gameMode", label: "Mode" },
  { key: "heroName", label: "Héros" },
  { key: "durationSeconds", label: "Durée", numeric: true },
  { key: "result", label: "Résultat" },
];

function goToMatch(row: Record<string, unknown>) {
  navigateTo(`/matches/${row.id}`);
}
</script>

<template>
  <div class="space-y-8">
    <div>
      <h1 class="font-heading text-2xl font-semibold">Dashboard</h1>
      <p class="mt-1 text-sm text-muted">
        Bienvenue {{ authData?.user?.displayName }}, voici un aperçu de tes statistiques.
      </p>
    </div>

    <UiTeaserLink to="/upload" icon="i-heroicons-cloud-arrow-up" eyebrow="Tes parties uploadées">
      {{ summary ? summary.gamesPlayed : "…" }} partie{{ (summary?.gamesPlayed ?? 0) > 1 ? "s" : "" }} sur ton
      compte — envoie les prochaines
    </UiTeaserLink>

    <StatsAccountSummaryStats :summary="summary">
      <ProgressSparklineTile
        :trend="trend"
        :loading="trendPending"
        :error="Boolean(trendError)"
      />
    </StatsAccountSummaryStats>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <UiStateCard
        v-if="driversPending && !topAxis"
        state="loading"
        size="sm"
      />
      <UiStateCard
        v-else-if="driversError"
        state="error"
        size="sm"
        message="Impossible de charger ton chantier n°1."
      />
      <UiTeaserLink
        v-else
        to="/progress"
        icon="i-heroicons-arrow-trending-up"
        eyebrow="Ton chantier n°1"
      >
        {{ topAxis ? topAxis.label : "Pas encore assez de parties — découvre la page Progression" }}
      </UiTeaserLink>

      <ProgressSessionSummaryCard
        :recap="sessionRecap"
        :loading="sessionPending"
        :error="Boolean(sessionError)"
      />
    </div>

    <div class="space-y-6 lg:hidden">
      <div>
        <h2 class="font-heading text-lg font-medium">Navigation</h2>
        <p class="mt-1 text-sm text-muted">Accède rapidement à toutes les pages de l'application.</p>
      </div>

      <div>
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Actions rapides</h3>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UiNavCard
            v-for="card in quickActionCards"
            :key="card.to"
            :to="card.to"
            :icon="card.icon"
            :title="card.title"
            :description="card.description"
            :color="card.color"
            :chip="card.to === '/draft' ? { show: isLiveDraftActive } : null"
          />
        </div>
      </div>

      <div>
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Statistiques</h3>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <UiNavCard
            v-for="card in statsCards"
            :key="card.to"
            :to="card.to"
            :icon="card.icon"
            :title="card.title"
            :description="card.description"
            :color="card.color"
            :chip="card.chip"
          />
        </div>
      </div>

      <div>
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Progression &amp; social</h3>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UiNavCard
            v-for="card in progressCards"
            :key="card.to"
            :to="card.to"
            :icon="card.icon"
            :title="card.title"
            :description="card.description"
            :color="card.color"
            :chip="card.chip"
          />
        </div>
      </div>

      <div>
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Compte</h3>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UiNavCard
            v-for="card in accountCards"
            :key="card.to"
            :to="card.to"
            :icon="card.icon"
            :title="card.title"
            :description="card.description"
            :color="card.color"
          />
        </div>
      </div>
    </div>

    <div>
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-heading text-lg font-medium">Dernières parties</h2>
        <UiArrowLink to="/matches">Voir tout l'historique</UiArrowLink>
      </div>

      <UiDataTable
        :columns="columns"
        :rows="recentMatches?.matches ?? []"
        clickable
        mobile-primary-key="mapName"
        mobile-secondary-key="playedAt"
        mobile-badge-key="result"
        @row-click="goToMatch"
      >
        <template #cell-playedAt="{ row }">{{ formatDate(row.playedAt as string) }}</template>
        <template #cell-gameMode="{ row }">{{ formatGameMode(row.gameMode as never) }}</template>
        <template #cell-durationSeconds="{ row }">{{ formatDuration(row.durationSeconds as number) }}</template>
        <template #cell-result="{ row }">
          <UiResultBadge :won="Boolean(row.winner)" />
        </template>
      </UiDataTable>
    </div>
  </div>
</template>
