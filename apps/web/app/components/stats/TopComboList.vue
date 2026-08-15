<script setup lang="ts">
export interface ComboItem {
  id: string;
  left: string;
  right: string;
  winrate: number;
  gamesPlayed: number;
}

withDefaults(
  defineProps<{
    items: ComboItem[];
    separator?: "vs" | "+";
    /** "auto" colore chaque ligne selon son propre winrate; sinon toutes les lignes partagent le même tone. */
    tone?: "success" | "danger" | "default" | "auto";
    leftColorClass?: string;
    rightColorClass?: string;
    emptyText?: string;
  }>(),
  {
    separator: "vs",
    tone: "default",
    leftColorClass: "text-brand",
    rightColorClass: "text-accent",
    emptyText: "-",
  },
);
</script>

<template>
  <ol v-if="items.length > 0" class="space-y-2">
    <li
      v-for="(combo, index) in items"
      :key="combo.id"
      class="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
    >
      <span class="w-5 shrink-0 text-center text-sm">{{ rankMedal(index) }}</span>
      <span class="min-w-0 flex-1 truncate text-sm">
        <span class="font-medium" :class="leftColorClass">{{ combo.left }}</span>
        <span class="mx-1 text-muted">{{ separator }}</span>
        <span class="font-medium" :class="rightColorClass">{{ combo.right }}</span>
      </span>
      <span
        class="shrink-0 font-mono text-xs"
        :class="tone === 'auto' ? TONE_TEXT_CLASS[winrateTone(combo.winrate)] : TONE_TEXT_CLASS[tone]"
      >
        {{ formatPercent(combo.winrate) }} · {{ combo.gamesPlayed }} partie{{ combo.gamesPlayed > 1 ? "s" : "" }}
      </span>
    </li>
  </ol>
  <p v-else class="rounded-lg border border-border bg-surface p-4 text-center text-sm text-muted">{{ emptyText }}</p>
</template>
