<script setup lang="ts">
import {
  PROGRESSION_MIN_MATCHES,
  type GoalInput,
  type GoalMetricOption,
  type MapHubEntry,
  type PlayerGoal,
} from "@hots-stats/shared-types";
import { formatDate } from "~/composables/useFormat";
import { formatGoalTarget, formatGoalValue, goalPercent, goalTone } from "~/utils/goalDisplay";
import { useGoalMutations, useGoals } from "~/composables/useGoals";
import type { HeroListResponse } from "~/types/analytics";

definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Objectifs",
  description: "Fixe-toi des objectifs mesurables et suis leur progression sur tes parties.",
  ogTitle: "Objectifs - HotS Analytics",
  ogDescription: "Fixe-toi des objectifs mesurables et suis leur progression sur tes parties.",
  ogImage: "/og/index.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/index.png",
  robots: "noindex, follow",
});

const { data, pending, error, refresh } = await useGoals();
const { createGoal, deleteGoal } = useGoalMutations();

const { data: heroesData } = await useApiFetch<HeroListResponse>("/heroes", {
  query: { scope: "personal" },
});
const { data: mapsData } = await useApiFetch<{ maps: MapHubEntry[] }>("/maps");

const goals = computed(() => data.value?.goals ?? []);
const metrics = computed<GoalMetricOption[]>(() => data.value?.availableMetrics ?? []);
const metricItems = computed(() => metrics.value.map((metric) => ({ value: metric.key, label: metric.label })));
const heroItems = computed(() =>
  (heroesData.value?.heroes ?? []).map((hero) => ({ value: hero.heroId, label: hero.heroName })),
);
const mapItems = computed(() =>
  (mapsData.value?.maps ?? []).map((map) => ({ value: map.mapId, label: map.mapName })),
);

const metricKey = ref("");
const direction = ref<"atLeast" | "atMost">("atLeast");
const targetValue = ref("");
const scopeHeroId = ref("");
const scopeMapId = ref("");
const dueAt = ref("");
const submitting = ref(false);
const formError = ref<string | null>(null);

const directionLabel: Record<"atLeast" | "atMost", string> = {
  atLeast: "au moins",
  atMost: "au plus",
};

// A metric knows which side is good, so pre-select the matching direction --
// the user can still override it.
watch(
  () => metrics.value.find((metric) => metric.key === metricKey.value) ?? null,
  (metric) => {
    if (metric) direction.value = metric.betterWhen === "higher" ? "atLeast" : "atMost";
  },
);

const canSubmit = computed(
  () => metricKey.value !== "" && targetValue.value.trim() !== "" && !submitting.value,
);

async function submit() {
  formError.value = null;
  const target = Number(targetValue.value.replace(",", "."));
  if (!Number.isFinite(target)) {
    formError.value = "Cible invalide : entre un nombre.";
    return;
  }
  const input: GoalInput = {
    metricKey: metricKey.value,
    targetValue: target,
    direction: direction.value,
    scopeHeroId: scopeHeroId.value || null,
    scopeMapId: scopeMapId.value || null,
    dueAt: dueAt.value ? new Date(dueAt.value).toISOString() : null,
  };
  submitting.value = true;
  try {
    await createGoal(input);
    targetValue.value = "";
    scopeHeroId.value = "";
    scopeMapId.value = "";
    dueAt.value = "";
    await refresh();
  } catch {
    formError.value = "Impossible d'enregistrer l'objectif.";
  } finally {
    submitting.value = false;
  }
}

const deletingId = ref<string | null>(null);

async function remove(goal: PlayerGoal) {
  if (!window.confirm("Supprimer cet objectif ?")) return;
  deletingId.value = goal.id;
  try {
    await deleteGoal(goal.id);
    await refresh();
  } finally {
    deletingId.value = null;
  }
}

function metricLabel(goal: PlayerGoal): string {
  return metrics.value.find((metric) => metric.key === goal.metricKey)?.label ?? goal.metricKey;
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <div class="min-w-0">
      <h1 class="font-heading text-2xl font-semibold">Objectifs</h1>
      <p class="mt-1 text-sm text-muted">
        Fixe-toi une cible sur une statistique de jeu et suis ta progression partie après partie.
      </p>
    </div>

    <UiPanel title="Nouvel objectif" :scrollable="false">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div class="flex flex-col gap-1">
          <label class="text-xs uppercase tracking-wide text-muted">Statistique</label>
          <USelectMenu
            v-model="metricKey"
            value-key="value"
            :items="metricItems"
            placeholder="Choisir une statistique…"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs uppercase tracking-wide text-muted">Objectif</label>
          <USelectMenu
            v-model="direction"
            value-key="value"
            :items="[
              { value: 'atLeast', label: 'Au moins' },
              { value: 'atMost', label: 'Au plus' },
            ]"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs uppercase tracking-wide text-muted">Cible</label>
          <UInput v-model="targetValue" type="number" step="any" placeholder="Ex. 450" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs uppercase tracking-wide text-muted">Héros (optionnel)</label>
          <USelectMenu
            v-model="scopeHeroId"
            value-key="value"
            :items="heroItems"
            placeholder="Tous mes héros"
            clear
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs uppercase tracking-wide text-muted">Carte (optionnel)</label>
          <USelectMenu
            v-model="scopeMapId"
            value-key="value"
            :items="mapItems"
            placeholder="Toutes les cartes"
            clear
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs uppercase tracking-wide text-muted">Échéance (optionnel)</label>
          <UInput v-model="dueAt" type="datetime-local" />
        </div>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <UButton :disabled="!canSubmit" :loading="submitting" @click="submit">Créer l'objectif</UButton>
        <p v-if="formError" class="text-sm text-danger">{{ formError }}</p>
      </div>
    </UiPanel>

    <UiStateCard v-if="pending" state="loading" message="Chargement de tes objectifs…" />
    <UiStateCard v-else-if="error" state="error" message="Impossible de charger tes objectifs." />
    <UiStateCard
      v-else-if="goals.length === 0"
      state="empty"
      message="Aucun objectif pour l'instant. Crée ton premier objectif ci-dessus."
    />

    <UiPanel v-else title="Mes objectifs" :count="goals.length" :scrollable="false">
      <ul class="flex flex-col divide-y divide-border">
        <li v-for="goal in goals" :key="goal.id" class="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-medium">
                {{ metricLabel(goal) }}
                <span class="text-muted">{{ directionLabel[goal.direction] }}</span>
                {{ formatGoalTarget(goal) }}
              </p>
              <p class="mt-0.5 text-xs text-muted">
                {{ formatGoalValue(goal) }} sur {{ goal.progress.sampleSize }} partie(s) mesurée(s)
                depuis le {{ formatDate(goal.createdAt) }}
                <template v-if="goal.dueAt"> · échéance le {{ formatDate(goal.dueAt) }}</template>
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <span
                v-if="goal.progress.achieved"
                class="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success"
              >
                Atteint{{ goal.achievedAt ? " le " + formatDate(goal.achievedAt) : "" }}
              </span>
              <UButton
                color="error"
                variant="ghost"
                size="xs"
                :loading="deletingId === goal.id"
                @click="remove(goal)"
              >
                Supprimer
              </UButton>
            </div>
          </div>

          <div class="h-2 w-full overflow-hidden rounded-full bg-background">
            <div
              v-if="goalPercent(goal.progress) !== null"
              class="h-full rounded-full"
              :class="goalTone(goal) === 'success' ? 'bg-success' : 'bg-brand'"
              :style="{ width: goalPercent(goal.progress) + '%' }"
            />
          </div>
          <p v-if="!goal.progress.reliable" class="text-xs text-muted">
            Échantillon en dessous de {{ PROGRESSION_MIN_MATCHES }} parties : la valeur est
            indicative, seul le compte fait foi.
          </p>
          <p v-if="goal.progress.currentValue === null" class="text-xs text-muted">
            Aucune partie mesurable depuis la création de cet objectif.
          </p>
        </li>
      </ul>
    </UiPanel>
  </div>
</template>
