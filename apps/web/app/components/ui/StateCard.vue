<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    state: "loading" | "empty" | "error";
    message?: string;
    /** "md" (défaut) = carte bordée pleine largeur. "sm" = pas de bordure/fond, padding
     * réduit, icône plus petite -- pour un état imbriqué dans un panneau/modale déjà encadré. */
    size?: "md" | "sm";
  }>(),
  { size: "md" },
);

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
  <div
    class="flex flex-col items-center gap-3 text-center text-muted"
    :class="size === 'md' ? 'rounded-lg border border-border bg-surface p-8' : 'p-3'"
  >
    <UIcon
      :name="stateIcon[state]"
      :class="[stateToneClass[state], state === 'loading' ? 'animate-spin' : '', size === 'md' ? 'h-8 w-8' : 'h-5 w-5']"
    />
    <p :class="[state === 'error' ? 'text-danger' : '', size === 'sm' ? 'text-sm' : '']">{{ text }}</p>
  </div>
</template>
