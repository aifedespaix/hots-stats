<script setup lang="ts">
defineProps<{ to: string }>();
</script>

<template>
  <NuxtLink :to="to" class="inline-flex items-center gap-1 text-sm text-brand hover:underline">
    <slot />
    &rarr;
  </NuxtLink>
</template>
