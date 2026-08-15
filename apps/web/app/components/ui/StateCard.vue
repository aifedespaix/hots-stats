<script setup lang="ts">
const props = defineProps<{
  state: "loading" | "empty" | "error";
  message?: string;
}>();

const defaultMessage: Record<"loading" | "empty" | "error", string> = {
  loading: "Chargement…",
  empty: "Aucune donnée",
  error: "Une erreur est survenue",
};

const text = computed(() => props.message ?? defaultMessage[props.state]);
</script>

<template>
  <div class="rounded-lg border border-border bg-surface p-8 text-center text-muted">
    <p :class="state === 'error' ? 'text-danger' : ''">{{ text }}</p>
  </div>
</template>
