<script setup lang="ts">
const props = defineProps<{
  /** Whether this match's map has been calibrated by an admin (see /admin/calibrate). */
  calibrated: boolean;
}>();

const icon = computed(() => (props.calibrated ? "i-heroicons-map" : "i-heroicons-viewfinder-circle"));
const title = computed(() => (props.calibrated ? "Aucune donnée pour cette partie" : "Carte pas encore calibrée"));
const badgeLabel = computed(() => (props.calibrated ? "Aucune donnée" : "Calibration requise"));
const description = computed(() =>
  props.calibrated
    ? "Cette carte est calibrée, mais cette partie précise n'a pas de données de positionnement -- probablement analysée par une version du daemon antérieure à cette fonctionnalité. Relance une synchronisation avec la dernière version du daemon (le fichier de replay doit encore être présent en local) pour la mettre à jour."
    : "Cette carte n'a pas encore été calibrée : un admin doit d'abord définir ses repères via l'outil de calibration (/admin/calibrate) avant que les heatmaps ne puissent s'afficher pour elle.",
);
</script>

<template>
  <UCard>
    <div class="flex flex-col items-center gap-4 py-10 text-center">
      <div class="flex h-16 w-16 items-center justify-center rounded-full bg-brand/10 text-brand">
        <UIcon :name="icon" class="h-8 w-8" />
      </div>

      <div>
        <div class="flex flex-wrap items-center justify-center gap-2">
          <h2 class="font-heading text-lg font-semibold">Heatmaps & Placement</h2>
          <UBadge color="primary" variant="subtle" size="sm">{{ badgeLabel }}</UBadge>
        </div>
        <p class="mx-auto mt-2 max-w-md text-sm text-muted">{{ description }}</p>
      </div>
    </div>
  </UCard>
</template>
