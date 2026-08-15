<script setup lang="ts">
import type { CoachInsightResult, ScoreboardRow } from "~/types/coach";

const props = defineProps<{
  modelValue: boolean;
  players: ScoreboardRow[];
  selectedBattletag: string | null;
  insights: CoachInsightResult[];
}>();

defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "update:selectedBattletag", battletag: string): void;
}>();

const selectedPlayer = computed(() => props.players.find((p) => p.battletag === props.selectedBattletag) ?? null);
const title = computed(() => (selectedPlayer.value ? `Le Coach -- ${selectedPlayer.value.heroName}` : "Le Coach"));
</script>

<template>
  <UModal
    :open="modelValue"
    :title="title"
    :description="selectedPlayer?.battletag"
    :ui="{ content: 'sm:max-w-3xl', body: 'max-h-[75vh] overflow-y-auto' }"
    @update:open="(value: boolean) => $emit('update:modelValue', value)"
  >
    <template #body>
      <div class="space-y-4">
        <CoachPlayerSwitcher
          v-if="selectedBattletag"
          :players="players"
          :model-value="selectedBattletag"
          @update:model-value="$emit('update:selectedBattletag', $event)"
        />

        <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <CoachInsightCard v-for="insight in insights" :key="insight.pillar" :insight="insight" />
        </div>
      </div>
    </template>
  </UModal>
</template>
