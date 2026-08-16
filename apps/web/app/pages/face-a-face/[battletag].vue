<script setup lang="ts">
import type { FaceAFaceResponse } from "~/types/face-a-face";

definePageMeta({ middleware: "auth" });

const route = useRoute();
const battletag = route.params.battletag as string;

const { data, error } = await useApiFetch<FaceAFaceResponse>(`/compare/${encodeURIComponent(battletag)}`);

const opponentName = computed(() => data.value?.opponent.displayName ?? battletag);

useSeoMeta({
  title: () => `Face-à-Face · ${opponentName.value}`,
  description: () =>
    `Comparaison complète face à ${opponentName.value} sur Heroes of the Storm : stats, playstyle, héros signatures, synergie en duo et contres.`,
  robots: "noindex, follow",
});

const hasSynergyGames = computed(() => (data.value?.synergy.gamesPlayed ?? 0) > 0);
const hasMatchupGames = computed(() => (data.value?.matchups.gamesPlayed ?? 0) > 0);
</script>

<template>
  <UiErrorState
    v-if="error"
    :status-code="error.statusCode"
    :message="
      error.statusCode === 404
        ? 'Aucune partie trouvée pour ce joueur.'
        : error.statusCode === 400
          ? 'Impossible de te comparer à toi-même.'
          : 'Impossible de charger le Face-à-Face.'
    "
    back-to="/players"
    back-label="Retour aux joueurs"
  />

  <div v-else-if="data" class="space-y-8">
    <div>
      <UiBackLink
        :to="`/players/${encodeURIComponent(data.opponent.battletag ?? battletag)}`"
        :label="`Retour au profil de ${data.opponent.displayName}`"
      />
      <h1 class="mt-2 font-heading text-2xl font-semibold">Face-à-Face</h1>
    </div>

    <FaceAFaceVersusHeader :me="data.me" :friend="data.opponent" />

    <div>
      <h2 class="mb-3 font-heading text-lg font-medium">Tale of the Tape</h2>
      <FaceAFaceTaleOfTheTape
        :me="data.me.overview"
        :friend="data.opponent.overview"
        :me-name="data.me.displayName"
        :friend-name="data.opponent.displayName"
      />
    </div>

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <h2 class="mb-3 font-heading text-lg font-medium">Choc des playstyles</h2>
        <FaceAFacePlaystyleRadar
          :me="data.me.overview"
          :friend="data.opponent.overview"
          :me-name="data.me.displayName"
          :friend-name="data.opponent.displayName"
        />
      </div>
      <div>
        <h2 class="mb-3 font-heading text-lg font-medium">Répartition des rôles</h2>
        <FaceAFaceRoleDistributionBars
          :me="data.me.roleDistribution"
          :friend="data.opponent.roleDistribution"
          :me-name="data.me.displayName"
          :friend-name="data.opponent.displayName"
        />
      </div>
    </div>

    <div>
      <h2 class="mb-3 font-heading text-lg font-medium">Héros signatures</h2>
      <FaceAFaceSignatureHeroes
        :me="data.me.signatureHeroes"
        :friend="data.opponent.signatureHeroes"
        :me-name="data.me.displayName"
        :friend-name="data.opponent.displayName"
      />
    </div>

    <div v-if="hasSynergyGames">
      <h2 class="mb-3 font-heading text-lg font-medium">La synergie</h2>
      <FaceAFaceSynergyPanel :synergy="data.synergy" :friend-battletag="data.opponent.battletag" />
    </div>

    <div v-if="hasMatchupGames">
      <h2 class="mb-3 font-heading text-lg font-medium">Face à face en tant qu'ennemis</h2>
      <FaceAFaceMatchupPanel :matchups="data.matchups" :opponent-battletag="data.opponent.battletag" />
    </div>

    <p v-if="!hasSynergyGames && !hasMatchupGames" class="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
      Vous n'avez encore jamais été dans la même partie -- la synergie et le face-à-face ne sont calculables qu'à partir de parties jouées ensemble.
    </p>
  </div>
</template>
