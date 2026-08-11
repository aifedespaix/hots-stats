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

const title = `${profile.displayName} — HotS Analytics`;
const description = `${profile.displayName} a joué ${summary.gamesPlayed} parties (${formatPercent(summary.winrate)} de victoires) sur Heroes of the Storm.`;

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  ogType: "profile",
  twitterCard: "summary",
  ...(profile.avatarUrl ? { ogImage: profile.avatarUrl, twitterImage: profile.avatarUrl } : {}),
});
</script>

<template>
  <div v-if="data" class="space-y-8">
    <div class="flex items-center gap-4">
      <img
        v-if="profile.avatarUrl"
        :src="profile.avatarUrl"
        :alt="profile.displayName"
        class="h-16 w-16 rounded-full border border-border"
      >
      <div>
        <h1 class="font-heading text-2xl font-semibold">{{ profile.displayName }}</h1>
        <p v-if="profile.battletag" class="font-mono text-sm text-muted">{{ profile.battletag }}</p>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <UiStatTile
        label="Winrate"
        :value="formatPercent(summary.winrate)"
        :tone="summary.winrate >= 0.5 ? 'success' : 'danger'"
      />
      <UiStatTile label="Parties jouées" :value="String(summary.gamesPlayed)" />
      <UiStatTile label="Victoires" :value="String(summary.wins)" />
      <UiStatTile label="Durée moyenne" :value="formatDuration(summary.avgDurationSeconds)" />
    </div>

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
          <span class="font-mono text-sm" :class="hero.winrate >= 0.5 ? 'text-success' : 'text-danger'">
            {{ formatPercent(hero.winrate) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
