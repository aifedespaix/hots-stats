<script setup lang="ts">
import type { MatchListResponse, StatsSummary } from "~/types/matches";
import type { WeaknessesResponse } from "~/types/weaknesses";
import type { NavCardColor } from "~/components/ui/NavCard.vue";

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

const { data: weaknesses } = await useApiFetch<WeaknessesResponse>("/weaknesses");
const topLeak = computed(() => (weaknesses.value ? getTopWeaknesses(weaknesses.value, { limit: 1 })[0] : undefined));
const topStrength = computed(() => (weaknesses.value ? getTopStrengths(weaknesses.value, { limit: 1 })[0] : undefined));

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

    <StatsAccountSummaryStats :summary="summary" />

    <div v-if="topLeak || topStrength" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <UiTeaserLink
        v-if="topStrength"
        to="/analysis"
        icon="i-heroicons-sparkles"
        tone="success"
        eyebrow="Ton point fort du moment"
      >
        {{ topStrength.label }}
      </UiTeaserLink>

      <UiTeaserLink
        v-if="topLeak"
        to="/analysis"
        icon="i-heroicons-exclamation-triangle"
        tone="danger"
        eyebrow="Ton point faible du moment"
      >
        {{ topLeak.label }}
      </UiTeaserLink>
    </div>

    <div class="space-y-6">
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
          <span :class="row.winner ? TONE_TEXT_CLASS.success : TONE_TEXT_CLASS.danger">
            {{ row.winner ? "Victoire" : "Défaite" }}
          </span>
        </template>
      </UiDataTable>
    </div>
  </div>
</template>
