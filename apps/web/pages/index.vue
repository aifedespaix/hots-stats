<script setup lang="ts">
const config = useRuntimeConfig();
const { data: health } = await useFetch<{ status: string }>("/health", {
  baseURL: config.public.apiBase,
});
</script>

<template>
  <main class="p-8">
    <h1 class="text-3xl font-heading font-semibold">HotS Analytics</h1>
    <p class="mt-2 text-muted font-mono text-sm">
      API status: {{ health?.status ?? "unreachable" }}
    </p>
  </main>
</template>
