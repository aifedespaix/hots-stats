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

// Slots (by number) currently showing the correction combobox instead of
// their label -- a resolved or unknown pseudo starts collapsed behind an
// edit button so the common case (nothing to fix) stays uncluttered; an
// ambiguous pseudo (candidates but no effectiveBattletag yet) always needs
// picking one, so it's never collapsed.
const editingSlots = reactive(new Set<number>());

function isEditing(slot: DraftPlayerSlot) {
  return editingSlots.has(slot.slot) || (slot.candidates.length > 1 && !slot.effectiveBattletag);
}

function startEditing(slotNumber: number) {
  editingSlots.add(slotNumber);
}

function onPick(slot: DraftPlayerSlot, battletag: string) {
  editingSlots.delete(slot.slot);
  emit("disambiguate", slot, battletag);
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
        class="flex items-center gap-2.5 rounded-md px-2.5 py-2 outline-none transition-colors"
        :class="[
          slot.effectiveBattletag
            ? 'cursor-pointer hover:bg-background focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand'
            : '',
          isSelected(slot) ? 'bg-brand/15 ring-1 ring-inset ring-brand/40' : '',
        ]"
        :tabindex="slot.effectiveBattletag ? 0 : undefined"
        :role="slot.effectiveBattletag ? 'button' : undefined"
        @click="slot.effectiveBattletag && emit('select', slot)"
        @keydown.enter="slot.effectiveBattletag && emit('select', slot)"
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
              <UButton
                v-if="!isEditing(slot)"
                icon="i-heroicons-pencil-square"
                size="xs"
                variant="ghost"
                color="neutral"
                :padded="false"
                class="shrink-0 text-muted"
                @click.stop="startEditing(slot.slot)"
              />
            </p>
            <p
              v-if="slot.candidates.length === 0 && !slot.effectiveBattletag && !isEditing(slot)"
              class="text-[11px] text-muted"
            >
              Joueur inconnu
            </p>
            <div v-else-if="isEditing(slot)" class="mt-1 flex max-w-[180px] items-center gap-1">
              <DraftPseudoCombobox
                :seed-candidates="slot.candidates"
                placeholder="Quel battletag ?"
                @pick="onPick(slot, $event)"
              />
              <UButton
                v-if="!(slot.candidates.length > 1 && !slot.effectiveBattletag)"
                icon="i-heroicons-x-mark"
                size="xs"
                variant="ghost"
                color="neutral"
                :padded="false"
                @click.stop="editingSlots.delete(slot.slot)"
              />
            </div>
          </template>
        </div>

        <UIcon v-if="isSelected(slot)" name="i-heroicons-chevron-right" class="h-4 w-4 shrink-0 text-brand" />
      </li>
    </ul>
  </div>
</template>
