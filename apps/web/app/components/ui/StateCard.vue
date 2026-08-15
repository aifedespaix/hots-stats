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

const stateIcon: Record<"loading" | "empty" | "error", string> = {
  loading: "i-heroicons-arrow-path",
  empty: "i-heroicons-inbox",
  error: "i-heroicons-exclamation-triangle",
};

const stateToneClass: Record<"loading" | "empty" | "error", string> = {
  loading: "text-muted",
  empty: "text-muted",
  error: "text-danger",
};

const text = computed(() => props.message ?? defaultMessage[props.state]);
</script>

<template>
  <div class="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-8 text-center text-muted">
    <UIcon
      :name="stateIcon[state]"
      class="h-8 w-8"
      :class="[stateToneClass[state], state === 'loading' ? 'animate-spin' : '']"
    />
    <p :class="state === 'error' ? 'text-danger' : ''">{{ text }}</p>
  </div>
</template>
