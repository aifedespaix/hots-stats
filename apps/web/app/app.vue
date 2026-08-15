<script setup lang="ts">
useSeoMeta({
  titleTemplate: "%s - HotS Analytics",
  title: "Dashboard",
  description:
    "HotS Analytics suit tes statistiques Heroes of the Storm : winrate, héros, parties et joueurs croisés, calculés automatiquement à partir de tes replays.",
  ogSiteName: "HotS Analytics",
  ogType: "website",
  ogImage: "/og/index.png",
  ogLocale: "fr_FR",
  twitterCard: "summary_large_image",
  twitterImage: "/og/index.png",
  robots: "index, follow",
});
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
