<script setup lang="ts">
const { data } = await useAuthUser();
if (data.value?.user) {
  await navigateTo("/");
}
</script>

<template>
  <main class="min-h-screen flex items-center justify-center p-8">
    <UCard class="max-w-sm w-full">
      <h1 class="font-heading text-2xl mb-1">HotS Analytics</h1>
      <p class="text-muted text-sm mb-6">Connecte-toi pour accéder à tes statistiques.</p>
      <UButton :to="googleLoginUrl()" external block color="primary" size="lg">
        Se connecter avec Google
      </UButton>
    </UCard>
  </main>
</template>
