<script setup lang="ts">
definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Upload & Synchronisation",
  description:
    "Envoie tes replays Heroes of the Storm à la main par glisser-déposer, ou synchronise-les automatiquement avec le daemon local.",
  ogTitle: "Upload & Synchronisation - HotS Analytics",
  ogDescription:
    "Envoie tes replays Heroes of the Storm à la main par glisser-déposer, ou synchronise-les automatiquement avec le daemon local.",
  ogImage: "/og/upload.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/upload.png",
  robots: "noindex, follow",
});
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="font-heading text-2xl font-semibold">Upload &amp; Synchronisation</h1>
      <p class="mt-1 text-sm text-muted">
        Le glisser-déposer envoie une partie ponctuelle, mais sans le daemon installé et lancé, tes
        nouvelles parties ne remonteront jamais toutes seules dans tes stats.
      </p>
    </div>

    <div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <UploadDropzone />

      <div class="space-y-6">
        <UploadDaemonOnboarding />
        <UploadTokenManager />
      </div>
    </div>
  </div>
</template>
