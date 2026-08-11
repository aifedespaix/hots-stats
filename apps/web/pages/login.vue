<script setup lang="ts">
definePageMeta({ layout: "blank" });

const { data } = await useAuthUser();
if (data.value?.user) {
  await navigateTo("/");
}

useSeoMeta({
  title: "Connexion",
  description:
    "Connecte-toi avec Google pour accéder à tes statistiques Heroes of the Storm sur HotS Analytics.",
  ogTitle: "Connexion - HotS Analytics",
  ogDescription:
    "Connecte-toi avec Google pour accéder à tes statistiques Heroes of the Storm sur HotS Analytics.",
  ogImage: "/og/login.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/login.png",
  robots: "index, follow",
});
</script>

<template>
  <main class="min-h-screen flex items-center justify-center p-8">
    <UCard class="max-w-sm w-full">
      <div class="mb-1 flex items-center gap-2.5">
        <img src="/favicon.svg" alt="" width="32" height="32" class="h-8 w-8">
        <h1 class="font-heading text-2xl">HotS Analytics</h1>
      </div>
      <p class="text-muted text-sm mb-6">Connecte-toi pour accéder à tes statistiques.</p>
      <UButton :to="googleLoginUrl()" external block color="primary" size="lg">
        Se connecter avec Google
      </UButton>
    </UCard>
  </main>
</template>
