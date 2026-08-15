<script setup lang="ts">
const plannedFeatures = [
  { icon: "i-heroicons-fire", label: "Heatmap des morts (les tiennes et celles de la partie)" },
  { icon: "i-heroicons-shield-exclamation", label: "Heatmap des dégâts subis / infligés par zone" },
  { icon: "i-heroicons-arrow-trending-up", label: "Trajectoires de rotation entre objectifs" },
];
</script>

<template>
  <UCard>
    <div class="flex flex-col items-center gap-4 py-10 text-center">
      <div class="flex h-16 w-16 items-center justify-center rounded-full bg-brand/10 text-brand">
        <UIcon name="i-heroicons-viewfinder-circle" class="h-8 w-8" />
      </div>

      <div>
        <div class="flex flex-wrap items-center justify-center gap-2">
          <h2 class="font-heading text-lg font-semibold">Heatmaps & Placement</h2>
          <UBadge color="primary" variant="subtle" size="sm">Bientôt disponible</UBadge>
        </div>
        <p class="mx-auto mt-2 max-w-md text-sm text-muted">
          Visualise tes positions, tes morts et tes trajectoires sur la carte pour repérer les schémas de placement
          qui te coûtent des fights.
        </p>
      </div>

      <ul class="grid w-full max-w-md gap-2 text-left">
        <li
          v-for="feature in plannedFeatures"
          :key="feature.label"
          class="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted"
        >
          <UIcon :name="feature.icon" class="h-4 w-4 shrink-0" />
          {{ feature.label }}
        </li>
      </ul>

      <p class="max-w-md text-[11px] text-muted">
        Nécessite les positions périodiques du replay (tracker event <code>SUnitPositionsEvent</code>), pas encore
        extraites par le pipeline d'ingestion -- voir la critique de l'Onglet 2 pour le même constat sur les
        timestamps de mort et de niveau.
      </p>
    </div>
  </UCard>
</template>
