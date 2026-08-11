<script setup lang="ts">
import type { MatchDetailResponse } from "~/types/matches";

definePageMeta({ middleware: "auth" });

const route = useRoute();

const { data, error } = await useApiFetch<MatchDetailResponse>(`/matches/${route.params.id}`);

const talentTiers = [1, 4, 7, 10, 13, 16, 20] as const;

const matchTitle = computed(() => data.value?.match.mapName ?? "Détails de la partie");
const matchSeoDescription = computed(() =>
  data.value
    ? `Détails de la partie sur ${data.value.match.mapName} : composition des équipes, KDA et talents joués.`
    : "Détails d'une partie Heroes of the Storm : composition des équipes, KDA et talents joués.",
);

useSeoMeta({
  title: () => matchTitle.value,
  description: () => matchSeoDescription.value,
  ogTitle: () => `${matchTitle.value} - HotS Analytics`,
  ogDescription: () => matchSeoDescription.value,
  ogImage: "/og/matches-[id].png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/matches-[id].png",
  robots: "noindex, follow",
});
</script>

<template>
  <div v-if="error" class="rounded-lg border border-border bg-surface p-8 text-center text-muted">
    Partie introuvable.
  </div>

  <div v-else-if="data" class="space-y-8">
    <div>
      <NuxtLink to="/matches" class="text-sm text-brand hover:underline">
        &larr; Retour à l'historique
      </NuxtLink>
      <h1 class="mt-2 font-heading text-2xl font-semibold">{{ data.match.mapName }}</h1>
      <p class="mt-1 text-sm text-muted">
        {{ formatGameMode(data.match.gameMode) }} · {{ formatDate(data.match.playedAt) }} ·
        {{ formatDuration(data.match.durationSeconds) }} · {{ data.match.region }}
      </p>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <div v-for="team in data.teams" :key="team.team" class="space-y-4">
        <h2
          class="font-heading text-lg font-medium"
          :class="team.players[0]?.winner ? 'text-success' : 'text-danger'"
        >
          Équipe {{ team.team + 1 }} - {{ team.players[0]?.winner ? "Victoire" : "Défaite" }}
        </h2>

        <div
          v-for="player in team.players"
          :key="player.id"
          class="rounded-lg border border-border bg-surface p-4"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p class="font-medium">{{ player.heroName }}</p>
              <p class="text-xs text-muted">{{ player.battletag }} · {{ player.heroRole }}</p>
            </div>
            <div class="font-mono text-sm">
              <span>{{ player.kills }}</span> / <span class="text-danger">{{ player.deaths }}</span> /
              <span>{{ player.assists }}</span>
            </div>
          </div>

          <div class="mt-3 grid grid-cols-2 gap-2 font-mono text-xs text-muted sm:grid-cols-4">
            <div>Dégâts héros: <span class="text-foreground">{{ player.heroDamage.toLocaleString() }}</span></div>
            <div>Dégâts siège: <span class="text-foreground">{{ player.siegeDamage.toLocaleString() }}</span></div>
            <div>Soin: <span class="text-foreground">{{ player.healing.toLocaleString() }}</span></div>
            <div>Dégâts subis: <span class="text-foreground">{{ player.damageTaken.toLocaleString() }}</span></div>
          </div>

          <div v-if="player.talents.length > 0" class="mt-3 flex flex-wrap gap-2">
            <div
              v-for="tier in talentTiers"
              :key="tier"
              class="rounded border border-border px-2 py-1 text-xs"
            >
              <span class="text-muted">{{ tier }}:</span>
              {{ player.talents.find((t) => t.tier === tier)?.talentName ?? "-" }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
