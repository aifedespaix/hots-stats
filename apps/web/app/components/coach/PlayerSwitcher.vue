<script setup lang="ts">
import type { ScoreboardRow } from "~/types/coach";

defineProps<{
  players: ScoreboardRow[];
  modelValue: string;
}>();

defineEmits<{ (e: "update:modelValue", battletag: string): void }>();
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <span class="mr-1 text-xs font-medium text-muted">Analyser :</span>
    <button
      v-for="player in players"
      :key="player.id"
      type="button"
      class="flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors"
      :class="
        modelValue === player.battletag
          ? player.isAlly
            ? 'border-info bg-info/15 text-info'
            : 'border-danger bg-danger/15 text-danger'
          : 'border-border text-muted hover:text-foreground'
      "
      :aria-pressed="modelValue === player.battletag"
      @click="$emit('update:modelValue', player.battletag)"
    >
      <span
        class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
        :class="player.isAlly ? 'bg-info/20 text-info' : 'bg-danger/20 text-danger'"
      >
        {{ initials(player.battletag) }}
      </span>
      <span class="max-w-[6rem] truncate">{{ player.heroName }}</span>
      <span v-if="player.isMe" class="text-[10px] font-semibold text-brand">(toi)</span>
    </button>
  </div>
</template>
