<script setup lang="ts">
import type { FaceAFaceResponse } from "~/types/face-a-face";

definePageMeta({ middleware: "auth" });

const route = useRoute();
const friendId = route.params.userId as string;

const { data, error } = await useApiFetch<FaceAFaceResponse>(`/friends/${friendId}/face-a-face`);

const friendName = computed(() => data.value?.friend.displayName ?? "Ami");

useSeoMeta({
  title: () => `Face-à-Face · ${friendName.value}`,
  description: () =>
    `Comparaison complète face à ${friendName.value} sur Heroes of the Storm : stats, playstyle, héros signatures et synergie en duo.`,
  robots: "noindex, follow",
});
</script>

<template>
  <div v-if="error" class="rounded-lg border border-border bg-surface p-8 text-center text-muted">
    <p v-if="error.statusCode === 403">Vous n'êtes pas ami avec ce joueur.</p>
    <p v-else>Impossible de charger le Face-à-Face.</p>
    <NuxtLink to="/friends" class="mt-3 inline-block text-sm text-brand hover:underline">
      &larr; Retour à mes amis
    </NuxtLink>
  </div>

  <div v-else-if="data" class="space-y-8">
    <div>
      <NuxtLink :to="`/friends/${data.friend.userId}`" class="text-sm text-brand hover:underline">
        &larr; Retour aux stats de {{ data.friend.displayName }}
      </NuxtLink>
      <h1 class="mt-2 font-heading text-2xl font-semibold">Face-à-Face</h1>
    </div>

    <FaceAFaceVersusHeader :me="data.me" :friend="data.friend" />

    <div>
      <h2 class="mb-3 font-heading text-lg font-medium">Tale of the Tape</h2>
      <FaceAFaceTaleOfTheTape
        :me="data.me.overview"
        :friend="data.friend.overview"
        :me-name="data.me.displayName"
        :friend-name="data.friend.displayName"
      />
    </div>

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <h2 class="mb-3 font-heading text-lg font-medium">Choc des playstyles</h2>
        <FaceAFacePlaystyleRadar
          :me="data.me.overview"
          :friend="data.friend.overview"
          :me-name="data.me.displayName"
          :friend-name="data.friend.displayName"
        />
      </div>
      <div>
        <h2 class="mb-3 font-heading text-lg font-medium">Répartition des rôles</h2>
        <FaceAFaceRoleDistributionBars
          :me="data.me.roleDistribution"
          :friend="data.friend.roleDistribution"
          :me-name="data.me.displayName"
          :friend-name="data.friend.displayName"
        />
      </div>
    </div>

    <div>
      <h2 class="mb-3 font-heading text-lg font-medium">Héros signatures</h2>
      <FaceAFaceSignatureHeroes
        :me="data.me.signatureHeroes"
        :friend="data.friend.signatureHeroes"
        :me-name="data.me.displayName"
        :friend-name="data.friend.displayName"
      />
    </div>

    <div>
      <h2 class="mb-3 font-heading text-lg font-medium">La synergie</h2>
      <FaceAFaceSynergyPanel :synergy="data.synergy" :friend-battletag="data.friend.battletag" />
    </div>
  </div>
</template>
