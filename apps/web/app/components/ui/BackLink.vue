<script setup lang="ts">
withDefaults(
  defineProps<{
    to: string;
    label?: string;
    /** "inverted" = texte blanc, pour un lien posé sur une image (bannière carte). */
    tone?: "brand" | "inverted";
  }>(),
  { label: "Retour", tone: "brand" },
);
</script>

<template>
  <NuxtLink
    :to="to"
    class="inline-flex items-center gap-1 text-sm hover:underline"
    :class="tone === 'inverted' ? 'text-white/80 hover:text-white' : 'text-brand'"
  >
    <UIcon name="i-heroicons-arrow-left" class="h-4 w-4" />
    {{ label }}
  </NuxtLink>
</template>
