<script setup lang="ts">
import type { PublicProfileResponse } from "~/types/analytics";

definePageMeta({ layout: "public-profile" });

const route = useRoute();
const handle = route.params.handle as string;

const { data, error } = await useApiFetch<PublicProfileResponse>(`/public/u/${handle}`);

if (error.value) {
  throw createError({ statusCode: 404, statusMessage: "Profil introuvable", fatal: true });
}

const profile = data.value!.profile;
const summary = data.value!.summary;

const description = `${profile.displayName} a joué ${summary.gamesPlayed} parties (${formatPercent(summary.winrate)} de victoires) sur Heroes of the Storm.`;

useSeoMeta({
  title: profile.displayName,
  description,
  ogTitle: `${profile.displayName} - HotS Analytics`,
  ogDescription: description,
  ogType: "profile",
  twitterCard: "summary",
  ogImage: profile.avatarUrl ?? "/og/u-[handle].png",
  twitterImage: profile.avatarUrl ?? "/og/u-[handle].png",
  robots: "index, follow",
});
</script>

<template>
  <div v-if="data" class="space-y-8">
    <div class="flex items-center gap-4">
      <img
        v-if="profile.avatarUrl"
        :src="profile.avatarUrl"
        :alt="profile.displayName"
        class="h-16 w-16 shrink-0 rounded-full border border-border"
      >
      <div class="min-w-0">
        <h1 class="break-words font-heading text-2xl font-semibold">{{ profile.displayName }}</h1>
        <p v-if="profile.battletag" class="break-all font-mono text-sm text-muted">{{ profile.battletag }}</p>
      </div>
    </div>

    <StatsAccountSummaryStats :summary="summary" />

    <div v-if="data.topHeroes.length > 0">
      <h2 class="mb-3 font-heading text-lg font-medium">Héros les plus joués</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <div
          v-for="hero in data.topHeroes"
          :key="hero.heroId"
          class="flex items-center justify-between rounded-lg border border-border bg-surface p-4"
        >
          <div>
            <p class="font-medium">{{ hero.heroName }}</p>
            <p class="text-xs text-muted">{{ hero.gamesPlayed }} parties</p>
          </div>
          <span class="font-mono text-sm" :class="TONE_TEXT_CLASS[winrateTone(hero.winrate)]">
            {{ formatPercent(hero.winrate) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
