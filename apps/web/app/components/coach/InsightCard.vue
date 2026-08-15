<script setup lang="ts">
import type { CoachInsightResult, CoachVerdict } from "~/types/coach";

const props = defineProps<{ insight: CoachInsightResult }>();

// Inline literal type (not the shared `Tone` type) to match how the rest of
// the app keys into TONE_TEXT_CLASS/TONE_TILE_CLASS (see MiniStat.vue, RankBadgeList.vue).
const VERDICT_TONE: Record<CoachVerdict, "success" | "danger" | "info"> = {
  positive: "success",
  negative: "danger",
  neutral: "info",
};
const VERDICT_LABEL: Record<CoachVerdict, string> = { positive: "Positif", negative: "Négatif", neutral: "Neutre" };
const VERDICT_ICON: Record<CoachVerdict, string> = {
  positive: "i-heroicons-check-circle",
  negative: "i-heroicons-exclamation-triangle",
  neutral: "i-heroicons-information-circle",
};
/** Deliberately hand-rolled rather than `<UBadge color="success|error">`:
 * `app.config.ts` only aliases Nuxt UI's `primary`/`info` colors to this
 * app's OKLCH tokens, so a UBadge `success`/`error` color would render Nuxt
 * UI's stock palette instead of this app's `--color-success`/`--color-danger`. */
const VERDICT_PILL_CLASS: Record<CoachVerdict, string> = {
  positive: "bg-success/15 text-success",
  negative: "bg-danger/15 text-danger",
  neutral: "bg-info/15 text-info",
};

const readyInsight = computed(() => (props.insight.status === "ready" ? props.insight : null));
const unavailableInsight = computed(() => (props.insight.status === "unavailable" ? props.insight : null));

const visibleOccurrences = computed(() => (readyInsight.value?.occurrences ?? []).slice(0, 3));
const hiddenOccurrenceCount = computed(() =>
  Math.max(0, (readyInsight.value?.occurrences?.length ?? 0) - visibleOccurrences.value.length),
);
</script>

<template>
  <div
    class="flex flex-col gap-3 rounded-lg border p-4"
    :class="readyInsight ? TONE_TILE_CLASS[VERDICT_TONE[readyInsight.verdict]] : 'border-dashed border-border bg-surface/50'"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="flex items-center gap-2">
        <UIcon
          :name="insight.icon"
          class="h-5 w-5 shrink-0"
          :class="readyInsight ? TONE_TEXT_CLASS[VERDICT_TONE[readyInsight.verdict]] : 'text-muted'"
        />
        <h3 class="font-heading text-sm font-semibold">{{ insight.title }}</h3>
      </div>
      <span
        class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
        :class="readyInsight ? VERDICT_PILL_CLASS[readyInsight.verdict] : 'bg-border/40 text-muted'"
      >
        <UIcon :name="readyInsight ? VERDICT_ICON[readyInsight.verdict] : 'i-heroicons-clock'" class="h-3 w-3" />
        {{ readyInsight ? VERDICT_LABEL[readyInsight.verdict] : "Bientôt" }}
      </span>
    </div>

    <template v-if="readyInsight">
      <p class="text-sm leading-snug">{{ readyInsight.summary }}</p>

      <div v-if="readyInsight.metricValue" class="flex items-baseline gap-1.5">
        <span class="font-mono text-lg font-bold leading-none" :class="TONE_TEXT_CLASS[VERDICT_TONE[readyInsight.verdict]]">
          {{ readyInsight.metricValue }}
        </span>
        <span v-if="readyInsight.metricLabel" class="text-xs text-muted">{{ readyInsight.metricLabel }}</span>
      </div>

      <ul v-if="visibleOccurrences.length > 0" class="space-y-1 border-t border-border/60 pt-2">
        <li v-for="(occ, index) in visibleOccurrences" :key="index" class="flex items-start gap-2 text-xs text-muted">
          <span v-if="occ.atLabel" class="shrink-0 font-mono text-foreground">{{ occ.atLabel }}</span>
          <span>{{ occ.detail }}</span>
        </li>
        <li v-if="hiddenOccurrenceCount > 0" class="text-xs text-muted">+{{ hiddenOccurrenceCount }} autre(s)</li>
      </ul>
    </template>
    <p v-else-if="unavailableInsight" class="text-sm text-muted">{{ unavailableInsight.reason }}</p>

    <details class="mt-auto text-xs text-muted">
      <summary class="cursor-pointer select-none hover:text-foreground">Comment c'est calculé ?</summary>
      <p class="mt-1.5 leading-snug">{{ insight.methodology }}</p>
    </details>
  </div>
</template>
