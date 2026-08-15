<script setup lang="ts">
const props = defineProps<{
  statusCode?: number;
  message?: string;
  backTo?: string;
  backLabel?: string;
}>();

const defaultMessage = computed(() => {
  if (props.statusCode === 404) return "Introuvable";
  return "Une erreur est survenue";
});
</script>

<template>
  <div class="rounded-lg border border-border bg-surface p-8 text-center text-muted">
    <p>{{ message ?? defaultMessage }}</p>
    <NuxtLink v-if="backTo" :to="backTo" class="mt-3 inline-block text-sm text-brand hover:underline">
      {{ backLabel ?? "← Retour" }}
    </NuxtLink>
  </div>
</template>
