<script setup lang="ts">
const colorMode = useColorMode();

const themes = [
  { value: "dark", label: "Sombre", icon: "i-heroicons-moon" },
  { value: "light", label: "Clair", icon: "i-heroicons-sun" },
  { value: "contrasted", label: "Contraste", icon: "i-heroicons-eye" },
] as const;
</script>

<template>
  <div class="flex items-center gap-1 rounded-md border border-border bg-surface p-1">
    <button
      v-for="theme in themes"
      :key="theme.value"
      type="button"
      class="rounded p-1.5 text-muted transition-colors"
      :class="colorMode.preference === theme.value ? 'bg-primary/20 text-primary' : 'hover:text-foreground'"
      :title="theme.label"
      :aria-pressed="colorMode.preference === theme.value"
      @click="colorMode.preference = theme.value"
    >
      <UIcon :name="theme.icon" class="h-4 w-4" />
    </button>
  </div>
</template>
