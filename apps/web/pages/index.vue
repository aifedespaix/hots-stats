<script setup lang="ts">
const config = useRuntimeConfig();
const { data: health } = await useFetch<{ status: string }>("/health", {
  baseURL: config.public.apiBase,
});
const { data: authData } = await useAuthUser();

async function handleLogout() {
  await logout();
  await navigateTo("/login");
}
</script>

<template>
  <main class="p-8">
    <h1 class="text-3xl font-heading font-semibold">HotS Analytics</h1>
    <p class="mt-2 text-muted font-mono text-sm">
      API status: {{ health?.status ?? "unreachable" }}
    </p>

    <div class="mt-6">
      <template v-if="authData?.user">
        <p>
          Connecté en tant que {{ authData.user.displayName }} ({{ authData.user.email }})
        </p>
        <div class="mt-2 flex gap-4">
          <NuxtLink to="/settings" class="text-primary underline">Paramètres</NuxtLink>
          <button type="button" class="text-danger underline" @click="handleLogout">
            Se déconnecter
          </button>
        </div>
      </template>
      <template v-else>
        <NuxtLink to="/login" class="text-primary underline">Se connecter</NuxtLink>
      </template>
    </div>
  </main>
</template>
