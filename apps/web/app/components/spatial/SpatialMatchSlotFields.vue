<script setup lang="ts">
import type { useMatchSpatialSlot } from "~/composables/useMatchSpatialSlot";
import type { MatchSlotHero } from "~/types/spatial";

/** Hero-selection chips + "Par héros/Par équipe" toggle for one "Cette partie" Slot -- used by both Slots of `SpatialSlotGroup.vue` whenever either is scoped to "Cette partie". */
const props = defineProps<{
  heroes: MatchSlotHero[];
  slot: ReturnType<typeof useMatchSpatialSlot>;
  /** Hides the view-mode toggle -- irrelevant inside a 2-Slot comparison, where a forced single color per Slot overrides it regardless of the setting. */
  compact?: boolean;
}>();
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <span class="mr-1 text-xs font-medium text-muted">Héros :</span>
      <button
        v-for="hero in heroes"
        :key="hero.matchPlayerId"
        type="button"
        class="rounded-full border px-2 py-1 text-xs transition-colors"
        :class="
          slot.selected.value.has(hero.matchPlayerId)
            ? hero.isAlly
              ? 'border-info bg-info/15 text-info'
              : 'border-danger bg-danger/15 text-danger'
            : 'border-border text-muted hover:text-foreground'
        "
        :aria-pressed="slot.selected.value.has(hero.matchPlayerId)"
        @click="slot.toggle(hero.matchPlayerId)"
      >
        {{ hero.heroName }}
      </button>
      <span class="mx-1 h-4 w-px bg-border" />
      <UButton size="xs" variant="soft" color="neutral" @click="slot.selectAllies">Mon équipe</UButton>
      <UButton size="xs" variant="soft" color="neutral" @click="slot.selectEnemies">Adversaires</UButton>
      <UButton size="xs" variant="soft" color="neutral" @click="slot.selectAll">Tout</UButton>
    </div>

    <div v-if="!compact" class="flex items-center gap-1.5 text-xs text-muted">
      <span>Vue :</span>
      <UButton size="xs" :variant="slot.viewMode.value === 'hero' ? 'solid' : 'soft'" color="neutral" @click="slot.viewMode.value = 'hero'">Par héros</UButton>
      <UButton size="xs" :variant="slot.viewMode.value === 'team' ? 'solid' : 'soft'" color="neutral" @click="slot.viewMode.value = 'team'">Par équipe</UButton>
    </div>
  </div>
</template>
