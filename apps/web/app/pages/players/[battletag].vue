<script setup lang="ts">
definePageMeta({ middleware: "auth" });

const route = useRoute();
const battletag = route.params.battletag as string;

const playerSeoDescription = computed(
  () => `Statistiques du joueur ${battletag} sur Heroes of the Storm.`,
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
</script>

<template>
  <div class="space-y-4">
    <UiBackLink to="/players" label="Retour aux joueurs" />
    <PlayersProfileDetail :battletag="battletag" />
  </div>
</template>
