<script setup lang="ts">
const colorMode = useColorMode();

const themes = [
  { value: "dark", label: "Sombre", icon: "i-heroicons-moon" },
  { value: "light", label: "Clair", icon: "i-heroicons-sun" },
  { value: "contrasted", label: "Contraste", icon: "i-heroicons-eye" },
] as const;
</script>

<template>
  <UiPillTabs
    :model-value="colorMode.preference"
    :options="[...themes]"
    shape="rounded"
    icon-only
    @update:model-value="(value) => (colorMode.preference = value)"
  />
</template>
