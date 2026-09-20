<script setup lang="ts">
import {
  GOAL_SUGGESTION_WINDOW_DAYS,
  PROGRESSION_MIN_MATCHES,
  type GoalInput,
  type GoalMetricOption,
  type GoalSuggestion,
  type GoalSuggestionGroup,
  type MapHubEntry,
  type PlayerGoal,
} from "@hots-stats/shared-types";
import { formatDate } from "~/composables/useFormat";
import {
  formatGoalTarget,
  formatGoalValue,
  goalPercent,
  goalTone,
  hasGoalTarget,
  parseGoalTarget,
} from "~/utils/goalDisplay";
import { formatDriverMetric } from "~/utils/driverDisplay";
import { useGoalMutations, useGoals, useGoalSuggestions } from "~/composables/useGoals";
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
// Not awaited: the suggestions panel renders its own loading state, and the
// form below must stay usable even while the calculation runs.
const { data: suggestionsData, pending: suggestionsPending } = useGoalSuggestions();

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

// Defensive: a suggestions payload that is not an array (an error envelope, a
// shape change) must degrade to "no suggestion", never throw in .filter below
// and blank the page.
const suggestions = computed<GoalSuggestion[]>(() => {
  const raw = suggestionsData.value?.suggestions;
  return Array.isArray(raw) ? raw : [];
});
const suggestionWindowDays = computed(
  () => suggestionsData.value?.windowDays ?? GOAL_SUGGESTION_WINDOW_DAYS,
);

const SUGGESTION_GROUP_ORDER: GoalSuggestionGroup[] = ["global", "topHero", "secondHero"];

function suggestionGroupLabel(group: GoalSuggestionGroup, heroName: string | null): string {
  if (group === "global") return "Tous tes héros";
  const base = group === "topHero" ? "Perso le plus joué" : "2ᵉ perso le plus joué";
  return heroName ? `${base} : ${heroName}` : base;
}

const suggestionGroups = computed(() =>
  SUGGESTION_GROUP_ORDER.map((group) => {
    const items = suggestions.value.filter((suggestion) => suggestion.group === group);
    return items.length === 0
      ? null
      : { key: group, label: suggestionGroupLabel(group, items[0]?.heroName ?? null), items };
  }).filter((group): group is NonNullable<typeof group> => group !== null),
);

const metricKey = ref("");
const direction = ref<"atLeast" | "atMost">("atLeast");
// Declared as a string to match UInput's model, but type="number" makes Nuxt
// UI write an actual number here as soon as the field parses -- hence the
// coercion in hasGoalTarget/parseGoalTarget rather than a string method.
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
  () => metricKey.value !== "" && hasGoalTarget(targetValue.value) && !submitting.value,
);

async function submit() {
  formError.value = null;
  const target = parseGoalTarget(targetValue.value);
  if (target === null) {
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

/** Pre-fills the form from a suggestion so the player can adjust the target
 * before creating the goal -- a suggestion never creates anything by itself. */
function applySuggestion(suggestion: GoalSuggestion) {
  metricKey.value = suggestion.metricKey;
  direction.value = suggestion.direction;
  targetValue.value = String(suggestion.targetValue);
  scopeHeroId.value = suggestion.heroId ?? "";
  scopeMapId.value = "";
  dueAt.value = "";
  formError.value = null;
  void nextTick(() => {
    document.getElementById("nouvel-objectif")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/** Stable identity of one suggestion card, shared by the v-for key and the
 * direct-create loading state. */
function suggestionKey(suggestion: GoalSuggestion): string {
  return `${suggestion.group}-${suggestion.metricKey}`;
}

const creatingKey = ref<string | null>(null);
const suggestionError = ref<string | null>(null);

/** Accepts a pre-configured objective in one click: the suggestion already
 * carries its metric, direction, target and hero scope, so it can be saved
 * without going through the form. The form path (applySuggestion) stays
 * available for adjusting the target first. */
async function createFromSuggestion(suggestion: GoalSuggestion) {
  suggestionError.value = null;
  creatingKey.value = suggestionKey(suggestion);
  try {
    await createGoal({
      metricKey: suggestion.metricKey,
      targetValue: suggestion.targetValue,
      direction: suggestion.direction,
      scopeHeroId: suggestion.heroId ?? null,
      scopeMapId: null,
      dueAt: null,
    });
    await refresh();
  } catch {
    suggestionError.value = "Impossible d'enregistrer l'objectif.";
  } finally {
    creatingKey.value = null;
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

    <UiPanel title="Objectifs suggérés" :count="suggestions.length" :scrollable="false">
      <p class="text-sm text-muted">
        Jusqu'à 6 objectifs pré-configurés à partir de tes parties des
        {{ suggestionWindowDays }} derniers jours : 2 sur l'ensemble de tes héros, 2 sur ton héros le
        plus joué, puis 2 sur le deuxième. Clique sur « Créer » pour l'ajouter directement, ou « Ajuster » pour pré-remplir le formulaire.
      </p>

      <p v-if="suggestionError" class="mt-2 text-sm text-danger">{{ suggestionError }}</p>

      <div class="mt-3">
        <UiStateCard v-if="suggestionsPending" state="loading" message="Calcul de tes axes de travail…" />
        <p v-else-if="suggestions.length === 0" class="text-sm text-muted">
          Pas encore assez de parties sur les {{ suggestionWindowDays }} derniers jours pour proposer des
          objectifs adaptés.
        </p>

        <div v-else class="flex flex-col gap-4">
          <section v-for="group in suggestionGroups" :key="group.key" class="flex flex-col gap-2">
            <h3 class="text-xs font-medium uppercase tracking-wide text-muted">{{ group.label }}</h3>
            <div class="grid gap-3 sm:grid-cols-2">
              <article
                v-for="suggestion in group.items"
                :key="`${group.key}-${suggestion.metricKey}`"
                class="flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
              >
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <p class="font-medium">
                    {{ suggestion.metricLabel }}
                    <span class="text-muted">{{ directionLabel[suggestion.direction] }}</span>
                    {{ formatDriverMetric(suggestion.metricKey, suggestion.targetValue) }}
                  </p>
                  <span
                    v-if="!suggestion.reliable"
                    class="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted"
                  >
                    Indicatif
                  </span>
                </div>
                <p class="text-xs text-muted">{{ suggestion.rationale }}</p>
                <p class="text-xs text-muted">
                  Moyenne actuelle :
                  {{
                    suggestion.baselineValue === null
                      ? "—"
                      : formatDriverMetric(suggestion.metricKey, suggestion.baselineValue)
                  }}
                  · {{ suggestion.sampleSize }} partie(s) mesurée(s)
                </p>
                <div class="flex flex-wrap items-center gap-2">
                  <UButton
                    size="xs"
                    color="primary"
                    :loading="creatingKey === suggestionKey(suggestion)"
                    @click="createFromSuggestion(suggestion)"
                  >
                    Créer
                  </UButton>
                  <UButton
                    size="xs"
                    color="primary"
                    variant="soft"
                    @click="applySuggestion(suggestion)"
                  >
                    Ajuster
                  </UButton>
                </div>
              </article>
            </div>
          </section>
        </div>
      </div>
    </UiPanel>

    <UiPanel id="nouvel-objectif" title="Nouvel objectif" :scrollable="false">
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
