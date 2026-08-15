<script setup lang="ts">
const props = defineProps<{
  statusCode?: number;
  message?: string;
  backTo?: string;
  backLabel?: string;
}>();

const defaultMessage = computed(() => {
  if (props.statusCode === 404) return "Introuvable";
  if (props.statusCode === 403) return "Accès refusé";
  return "Une erreur est survenue";
});

/** Icon/tone vary by status: 404/403 are expected navigation dead-ends (neutral),
 * anything else (500, network...) is a real failure worth the danger tint. */
const icon = computed(() => {
  if (props.statusCode === 404) return "i-heroicons-magnifying-glass";
  if (props.statusCode === 403) return "i-heroicons-lock-closed";
  return "i-heroicons-exclamation-triangle";
});

const iconToneClass = computed(() =>
  props.statusCode === 404 || props.statusCode === 403 ? "text-muted" : "text-danger",
);
</script>

<template>
  <div class="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-8 text-center text-muted">
    <UIcon :name="icon" class="h-8 w-8" :class="iconToneClass" />
    <p>{{ message ?? defaultMessage }}</p>
    <NuxtLink v-if="backTo" :to="backTo" class="mt-1 inline-flex items-center gap-1 text-sm text-brand hover:underline">
      <UIcon name="i-heroicons-arrow-left" class="h-4 w-4" />
      {{ backLabel ?? "Retour" }}
    </NuxtLink>
  </div>
</template>
