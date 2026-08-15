<script setup lang="ts">
const features = [
  {
    icon: "i-heroicons-bolt",
    title: "Upload automatique",
    desc: "Chaque partie terminée part toute seule, sans jamais y penser.",
  },
  {
    icon: "i-heroicons-cpu-chip",
    title: "Zéro lag",
    desc: "Tourne en arrière-plan, aucun impact sur le jeu ni le FPS.",
  },
  {
    icon: "i-heroicons-signal",
    title: "Détection instantanée",
    desc: "Surveille ton dossier de replays en continu, dès la fin d'une game.",
  },
  {
    icon: "i-heroicons-eye",
    title: "Live Draft",
    desc: "Un raccourci clavier affiche vos stats sur les héros en cours de pick/ban, en direct pendant la draft.",
  },
];
</script>

<template>
  <div class="space-y-4 rounded-lg border border-border bg-gradient-to-br from-brand/10 via-surface to-surface p-4 sm:p-5">
    <div class="flex items-center gap-2">
      <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-brand">
        2
      </span>
      <h2 class="font-heading text-lg font-medium">Synchronisation automatique</h2>
    </div>
    <p class="text-sm text-muted">
      Le daemon Windows tourne en fond et envoie tes parties tout seul dès la fin de chaque game.
      Installe-le une fois, oublie-le ensuite.
    </p>

    <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <li v-for="feature in features" :key="feature.title" class="flex gap-2.5 rounded-lg bg-background/60 p-3">
        <UIcon :name="feature.icon" class="h-5 w-5 shrink-0 text-brand" />
        <div class="min-w-0">
          <p class="text-sm font-medium">{{ feature.title }}</p>
          <p class="mt-0.5 text-xs leading-relaxed text-muted">{{ feature.desc }}</p>
        </div>
      </li>
    </ul>

    <UButton
      to="https://github.com/aifedespaix/hots-stats/releases/latest"
      external
      target="_blank"
      block
      size="lg"
      icon="i-heroicons-arrow-down-tray"
    >
      Télécharger le daemon (Windows)
    </UButton>
  </div>
</template>
