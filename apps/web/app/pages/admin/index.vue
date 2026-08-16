<script setup lang="ts">
definePageMeta({ middleware: "admin" });

useSeoMeta({ title: "Administration", robots: "noindex, nofollow" });

interface AdminFeature {
  to: string;
  icon: string;
  eyebrow: string;
  label: string;
  tone?: "brand" | "success" | "danger";
}

// One entry per admin-only tool -- add here as the admin surface grows.
const adminFeatures: AdminFeature[] = [
  {
    to: "/admin/calibrate",
    icon: "i-heroicons-viewfinder-circle",
    eyebrow: "Données spatiales",
    label: "Calibration des cartes",
    tone: "brand",
  },
];
</script>

<template>
  <div class="space-y-6">
    <h1 class="font-heading text-2xl font-semibold">Administration</h1>
    <p class="max-w-2xl text-sm text-muted">Outils réservés aux comptes admin.</p>

    <div class="grid gap-3 sm:grid-cols-2">
      <UiTeaserLink
        v-for="feature in adminFeatures"
        :key="feature.to"
        :to="feature.to"
        :icon="feature.icon"
        :eyebrow="feature.eyebrow"
        :tone="feature.tone"
      >
        {{ feature.label }}
      </UiTeaserLink>
    </div>
  </div>
</template>
