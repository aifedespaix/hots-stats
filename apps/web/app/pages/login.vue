<script setup lang="ts">
definePageMeta({ layout: "blank" });

const { data } = await useAuthUser();
if (data.value?.user) {
  await navigateTo("/");
}

const { data: providers } = await useAuthProviders();

useSeoMeta({
  title: "Connexion",
  description: "Connecte-toi pour accéder à tes statistiques Heroes of the Storm sur HotS Analytics.",
  ogTitle: "Connexion - HotS Analytics",
  ogDescription: "Connecte-toi pour accéder à tes statistiques Heroes of the Storm sur HotS Analytics.",
  ogImage: "/og/login.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/login.png",
  robots: "index, follow",
});
</script>

<template>
  <main class="flex min-h-screen items-center justify-center p-4 sm:p-8">
    <UCard class="w-full max-w-sm">
      <div class="mb-1 flex items-center gap-2.5">
        <img src="/favicon.svg" alt="" width="32" height="32" class="h-8 w-8">
        <h1 class="font-heading text-2xl">HotS Analytics</h1>
      </div>
      <p class="text-muted text-sm mb-6">Connecte-toi pour accéder à tes statistiques.</p>
      <div class="flex flex-col gap-3">
        <UButton
          :to="googleLoginUrl()"
          external
          block
          color="primary"
          size="lg"
          icon="i-simple-icons-google"
        >
          Se connecter avec Google
        </UButton>
        <UButton
          v-if="providers?.battlenet"
          :to="battlenetLoginUrl()"
          external
          block
          color="info"
          size="lg"
          icon="i-simple-icons-battledotnet"
        >
          Se connecter avec Battle.net
        </UButton>
      </div>
    </UCard>
  </main>
</template>
