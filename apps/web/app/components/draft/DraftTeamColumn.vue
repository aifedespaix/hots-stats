<script setup lang="ts">
import type { DraftPlayerSlot } from "@hots-stats/shared-types";

const props = defineProps<{
  title: string;
  slots: DraftPlayerSlot[];
  selectedBattletag: string | null;
  ownBattletag: string | null;
}>();

const emit = defineEmits<{
  (e: "select", slot: DraftPlayerSlot): void;
  (e: "disambiguate", slot: DraftPlayerSlot, battletag: string): void;
}>();

function isSelected(slot: DraftPlayerSlot) {
  return Boolean(slot.effectiveBattletag) && slot.effectiveBattletag === props.selectedBattletag;
}

function isSelf(slot: DraftPlayerSlot) {
  return Boolean(slot.effectiveBattletag) && slot.effectiveBattletag === props.ownBattletag;
}
</script>

<template>
  <div class="flex h-full flex-col rounded-lg border border-border bg-surface">
    <h2 class="shrink-0 border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted">
      {{ title }}
    </h2>
    <ul class="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
      <li
        v-for="slot in slots"
        :key="slot.slot"
        class="flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors"
        :class="[
          slot.effectiveBattletag ? 'cursor-pointer hover:bg-background' : '',
          isSelected(slot) ? 'bg-brand/15 ring-1 ring-inset ring-brand/40' : '',
        ]"
        @click="slot.effectiveBattletag && emit('select', slot)"
      >
        <span
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-mono text-muted"
        >
          {{ slot.slot }}
        </span>

        <div class="min-w-0 flex-1">
          <template v-if="slot.status === 'unreadable' || !slot.rawName">
            <p class="flex items-center gap-1.5 text-sm italic text-muted">
              <UIcon name="i-heroicons-eye-slash" class="h-3.5 w-3.5" />
              Illisible
            </p>
          </template>
          <template v-else>
            <p class="flex items-center gap-1.5 truncate text-sm font-medium" :class="isSelected(slot) ? 'text-brand' : ''">
              <span class="truncate">{{ slot.rawName }}</span>
              <span v-if="isSelf(slot)" class="text-[10px] font-normal uppercase tracking-wide text-muted">(toi)</span>
              <PlayersAnnotationBadges v-if="slot.effectiveBattletag" :battletag="slot.effectiveBattletag" />
            </p>
            <p v-if="slot.candidates.length === 0" class="text-[11px] text-muted">Joueur inconnu</p>
            <select
              v-else-if="!slot.effectiveBattletag"
              class="mt-1 w-full max-w-[180px] rounded border border-border bg-background px-1.5 py-1 text-[11px] text-foreground"
              @click.stop
              @change="
                (event) => emit('disambiguate', slot, (event.target as HTMLSelectElement).value)
              "
            >
              <option value="" disabled selected>Quel battletag ?</option>
              <option v-for="candidate in slot.candidates" :key="candidate" :value="candidate">
                {{ candidate }}
              </option>
            </select>
          </template>
        </div>

        <UIcon v-if="isSelected(slot)" name="i-heroicons-chevron-right" class="h-4 w-4 shrink-0 text-brand" />
      </li>
    </ul>
  </div>
</template>
