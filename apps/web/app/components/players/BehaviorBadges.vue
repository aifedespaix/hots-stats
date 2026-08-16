<script setup lang="ts">
/** FDP/Sympa vote-count pills, extraites de PlayersAnnotationBadges pour être
 * réutilisées telles quelles dans la colonne "Comportement" de la liste des joueurs. */
defineProps<{ fdpCount: number; pgmCount: number }>();
</script>

<template>
  <span
    v-if="fdpCount > 0"
    class="inline-flex items-center gap-0.5 rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger"
    :title="`Marqué FDP par ${fdpCount} joueur(s)`"
  >
    <UIcon name="i-heroicons-face-frown" class="h-3 w-3" />
    FDP · {{ fdpCount }}
  </span>
  <span
    v-if="pgmCount > 0"
    class="inline-flex items-center gap-0.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent"
    :title="`Marqué sympa par ${pgmCount} joueur(s)`"
  >
    <UIcon name="i-heroicons-face-smile" class="h-3 w-3" />
    Sympa · {{ pgmCount }}
  </span>
</template>
