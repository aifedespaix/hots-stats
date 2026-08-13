<script setup lang="ts">
import type { TeamThreatEntry } from "@hots-stats/shared-types";

const props = defineProps<{ battletags: string[] }>();
const emit = defineEmits<{ (e: "select", battletag: string): void }>();

const config = useRuntimeConfig();
const threats = ref<TeamThreatEntry[]>([]);
const pending = ref(false);
const errored = ref(false);

watch(
  () => props.battletags,
  async (battletags) => {
    threats.value = [];
    errored.value = false;
    if (battletags.length === 0) return;

    pending.value = true;
    try {
      const res = await $fetch<{ threats: TeamThreatEntry[] }>("/draft/teams/threats", {
        baseURL: config.public.apiBase,
        credentials: "include",
        query: { battletags: battletags.join(",") },
      });
      threats.value = res.threats;
    } catch {
      errored.value = true;
    } finally {
      pending.value = false;
    }
  },
  { immediate: true },
);

const hasPersonalWeakness = computed(() => threats.value.some((threat) => threat.isPersonalWeakness));
</script>

<template>
  <div v-if="battletags.length > 0" class="rounded-lg border border-border bg-surface p-3">
    <div class="mb-2 flex items-center gap-2">
      <UIcon name="i-heroicons-shield-exclamation" class="h-4 w-4 text-muted" />
      <h2 class="text-xs font-medium uppercase tracking-wide text-muted">Menaces adverses</h2>
    </div>

    <div v-if="pending" class="flex items-center justify-center py-3 text-muted">
      <UIcon name="i-heroicons-arrow-path" class="h-5 w-5 animate-spin" />
    </div>
    <p v-else-if="errored" class="py-1 text-xs text-danger">Impossible de charger les menaces adverses.</p>
    <p v-else-if="threats.length === 0" class="py-1 text-xs text-muted">Pas assez de données sur cette équipe.</p>

    <div v-else class="flex flex-wrap gap-2">
      <button
        v-for="threat in threats"
        :key="threat.battletag"
        type="button"
        class="flex min-w-[9.5rem] flex-1 items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors hover:bg-background"
        :class="threat.isPersonalWeakness ? 'border-danger/40 bg-danger/5' : 'border-border'"
        @click="emit('select', threat.battletag)"
      >
        <UIcon
          v-if="threat.isPersonalWeakness"
          name="i-heroicons-exclamation-triangle"
          class="h-4 w-4 shrink-0 text-danger"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{{ threat.heroName }}</p>
          <p class="truncate font-mono text-[11px] text-muted">{{ threat.battletag }}</p>
        </div>
        <div class="shrink-0 text-right">
          <p class="font-mono text-xs" :class="threat.winrate >= 0.5 ? 'text-success' : 'text-danger'">
            {{ formatPercent(threat.winrate) }}
          </p>
          <p class="text-[10px] text-muted">
            {{ threat.gamesPlayed }} partie{{ threat.gamesPlayed > 1 ? "s" : "" }}
          </p>
          <p v-if="threat.smallSample" class="text-[10px] text-muted">échantillon faible</p>
        </div>
      </button>
    </div>

    <p v-if="hasPersonalWeakness" class="mt-2 text-[10px] text-muted">
      <UIcon name="i-heroicons-exclamation-triangle" class="mr-1 inline h-3 w-3 text-danger" />
      Aussi un de tes <NuxtLink to="/analysis" class="text-brand hover:underline">matchups perdants</NuxtLink>.
    </p>
  </div>
</template>
