<script setup lang="ts">
import { PROGRESSION_MIN_MATCHES, type HeroStatsScope } from "@hots-stats/shared-types";
import type { PillTabOption } from "~/components/ui/PillTabs.vue";
import { useProgression } from "~/composables/useProgression";

definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Progression",
  description:
    "Ton hub de progression Heroes of the Storm : tendance glissante, axes de travail, patterns récurrents et contexte de session.",
  ogTitle: "Progression - HotS Analytics",
  ogDescription:
    "Ton hub de progression Heroes of the Storm : tendance glissante, axes de travail, patterns récurrents et contexte de session.",
  ogImage: "/og/index.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/index.png",
  robots: "noindex, follow",
});

// The progression endpoints are all personal-only (see GET /stats/patterns,
// /trend, /drivers and /context): a hub has no coherent community subject. The
// toggle is therefore an honest gate, not a data switch -- picking "Toute l'app"
// explains why the page is personal instead of firing four 400s.
const scope = ref<HeroStatsScope>("personal");
const isGlobal = computed(() => scope.value === "global");

type Period = "all" | "30" | "90";
const period = ref<Period>("all");
const periodOptions: PillTabOption<Period>[] = [
  { value: "all", label: "Tout" },
  { value: "30", label: "30 jours" },
  { value: "90", label: "90 jours" },
];

// Optional A/B boundary inside the selected period (GET /stats/trend compareTo).
const compareTo = ref("");

// SSR must not infer the viewer's timezone from the server's clock: start at
// UTC, then correct on the client -- the reactive query refetches once the real
// offset arrives.
const tzOffsetMinutes = ref(0);
onMounted(() => {
  tzOffsetMinutes.value = -new Date().getTimezoneOffset();
});

const from = computed<string | null>(() => {
  if (period.value === "all") return null;
  const days = period.value === "30" ? 30 : 90;
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
});

const query = computed<Record<string, unknown>>(() => {
  const base: Record<string, unknown> = { tzOffsetMinutes: tzOffsetMinutes.value };
  if (from.value) base.from = from.value;
  if (compareTo.value) base.compareTo = new Date(compareTo.value).toISOString();
  return base;
});

const { trend, patterns, drivers, context } = useProgression(query, scope);
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
      <div class="min-w-0">
        <h1 class="font-heading text-2xl font-semibold">Progression</h1>
        <p class="mt-1 text-sm text-muted">
          Où tu en es et sur quoi travailler : tendance, axes de travail, patterns récurrents et contexte.
        </p>
      </div>

      <UiPillTabs v-model="period" :options="periodOptions" />
    </div>

    <UiStatsScopeToggle v-model="scope" />

    <template v-if="isGlobal">
      <ProgressGlobalTeamCompositionPanel
        :context="context.data.value"
        :loading="context.pending.value"
        :error="Boolean(context.error.value)"
        :scrollable="false"
      />

      <UiStateCard
        state="empty"
        message="Le reste de l'analyse de progression est personnel : bascule sur « Mes parties » pour voir ta tendance, tes axes de travail, tes patterns et ton contexte."
      />
    </template>

    <template v-else>
      <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p class="min-w-0 text-sm text-muted">
          Comparer deux périodes (la courbe reste sur la période choisie ci-dessus).
        </p>
        <UInput v-model="compareTo" type="date" size="sm" class="w-full shrink-0 sm:w-44" />
      </div>

      <!-- The hub is a single reading flow: `scrollable: false` keeps each panel
      at its natural height so the page has exactly one scrollbar, instead of one
      nested scroll region per panel (which also clipped the charts). -->
      <ProgressTrendChart
        :trend="trend.data.value"
        :loading="trend.pending.value"
        :error="Boolean(trend.error.value)"
        :scrollable="false"
      />

      <ProgressWorkAxesCard
        :drivers="drivers.data.value?.drivers ?? []"
        :matches="drivers.data.value?.matches ?? 0"
        :insufficient-sample="(drivers.data.value?.matches ?? 0) < PROGRESSION_MIN_MATCHES"
        :loading="drivers.pending.value"
        :error="Boolean(drivers.error.value)"
        :scrollable="false"
      />

      <ProgressPatternTable
        :aggregate="patterns.data.value?.aggregate ?? null"
        :loading="patterns.pending.value"
        :error="Boolean(patterns.error.value)"
        :scrollable="false"
      />

      <ProgressContextBreakdown
        :context="context.data.value ?? null"
        :loading="context.pending.value"
        :error="Boolean(context.error.value)"
        :scrollable="false"
      />

      <div class="flex flex-wrap gap-3">
        <UiArrowLink to="/analysis">Approfondir dans le Diagnostic</UiArrowLink>
        <UiArrowLink to="/matches">Voir l'historique filtré</UiArrowLink>
      </div>
    </template>
  </div>
</template>
