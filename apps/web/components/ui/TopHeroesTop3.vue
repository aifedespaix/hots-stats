<script setup lang="ts">
export interface TopHeroEntry {
  heroId: string;
  heroName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
}

const props = defineProps<{ heroes: TopHeroEntry[] }>();

interface Category {
  key: "played" | "won" | "lost";
  title: string;
  icon: string;
  tone: "default" | "success" | "danger";
  metric: (hero: TopHeroEntry) => number;
  metricLabel: (hero: TopHeroEntry) => string;
}

const categories: Category[] = [
  {
    key: "played",
    title: "Top joués",
    icon: "i-heroicons-fire",
    tone: "default",
    metric: (h) => h.gamesPlayed,
    metricLabel: (h) => `${h.gamesPlayed} partie${h.gamesPlayed > 1 ? "s" : ""}`,
  },
  {
    key: "won",
    title: "Top victoires",
    icon: "i-heroicons-trophy",
    tone: "success",
    metric: (h) => h.wins,
    metricLabel: (h) => `${h.wins} victoire${h.wins > 1 ? "s" : ""}`,
  },
  {
    key: "lost",
    title: "Top défaites",
    icon: "i-heroicons-face-frown",
    tone: "danger",
    metric: (h) => h.losses,
    metricLabel: (h) => `${h.losses} défaite${h.losses > 1 ? "s" : ""}`,
  },
];

const medals = ["🥇", "🥈", "🥉"];

const rankings = computed(() =>
  categories.map((category) => ({
    ...category,
    top: [...props.heroes]
      .filter((hero) => category.metric(hero) > 0)
      .sort((a, b) => category.metric(b) - category.metric(a))
      .slice(0, 3),
  })),
);
</script>

<template>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
    <div v-for="category in rankings" :key="category.key" class="rounded-lg border border-border bg-surface p-4">
      <div class="mb-3 flex items-center gap-2">
        <UIcon
          :name="category.icon"
          class="h-4 w-4"
          :class="{
            'text-success': category.tone === 'success',
            'text-danger': category.tone === 'danger',
            'text-muted': category.tone === 'default',
          }"
        />
        <h3 class="text-xs font-medium uppercase tracking-wide text-muted">{{ category.title }}</h3>
      </div>

      <ol v-if="category.top.length > 0" class="space-y-2">
        <li
          v-for="(hero, index) in category.top"
          :key="hero.heroId"
          class="flex items-center gap-3 rounded-md px-2 py-1.5"
          :class="index === 0 ? 'bg-background' : ''"
        >
          <span class="w-5 shrink-0 text-center text-sm">{{ medals[index] }}</span>
          <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ hero.heroName }}</span>
          <span
            class="shrink-0 font-mono text-xs"
            :class="{
              'text-success': category.tone === 'success',
              'text-danger': category.tone === 'danger',
              'text-muted': category.tone === 'default',
            }"
          >
            {{ category.metricLabel(hero) }}
          </span>
        </li>
      </ol>
      <p v-else class="py-2 text-sm text-muted">-</p>
    </div>
  </div>
</template>
