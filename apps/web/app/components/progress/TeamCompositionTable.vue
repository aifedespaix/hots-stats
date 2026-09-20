<script setup lang="ts">
import type { ContextBreakdown, ContextBucket } from "@hots-stats/shared-types";

const props = withDefaults(
  defineProps<{
    /** The "teamComposition" dimension, or undefined while it is missing. */
    breakdown?: ContextBreakdown | null;
    /** What one row counts: a personal match ("Parties"), or one team globally ("Équipes"). */
    unitLabel?: string;
  }>(),
  { breakdown: null, unitLabel: "Parties" },
);

const columns = computed(() => [
  { key: "label", label: "Composition" },
  { key: "gamesPlayed", label: props.unitLabel, numeric: true },
  { key: "winrate", label: "Winrate", numeric: true },
]);

const rows = computed(() =>
  (props.breakdown?.buckets ?? []).map((bucket: ContextBucket) => ({
    key: bucket.key,
    label: bucket.label,
    gamesPlayed: bucket.gamesPlayed,
    winrate: formatPercent(bucket.winrate),
  })),
);
</script>

<template>
  <UiDataTable
    :columns="columns"
    :rows="rows"
    row-key="key"
    mobile-primary-key="label"
    mobile-badge-key="winrate"
  />
</template>
