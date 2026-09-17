<script setup lang="ts">
import type { DraftPlayerSlot } from "@hots-stats/shared-types";

const props = defineProps<{
  title: string;
  slots: DraftPlayerSlot[];
  selectedBattletag: string | null;
  /** Every BattleTag the viewer owns -- a Set, since accounts can be merged. */
  ownBattletags: Set<string>;
}>();

const emit = defineEmits<{
  (e: "select", slot: DraftPlayerSlot): void;
  (e: "disambiguate", slot: DraftPlayerSlot, battletag: string): void;
}>();

function isSelected(slot: DraftPlayerSlot) {
  return Boolean(slot.effectiveBattletag) && slot.effectiveBattletag === props.selectedBattletag;
}

function isSelf(slot: DraftPlayerSlot) {
  return isMine(slot.effectiveBattletag, props.ownBattletags);
}

// A slot shows the correction combobox only while it is still *unresolved*:
// no candidate at all (OCR matched nothing) or several (the pseudo is
// ambiguous). As soon as an `effectiveBattletag` exists -- the single
// candidate, or the viewer's remembered preference among several -- the slot
// is solved, so it links straight to that player's account instead of
// offering a search field. A correctly-resolved pseudo therefore never
// invites a correction.
function needsPicking(slot: DraftPlayerSlot) {
  return !slot.effectiveBattletag;
}

function playerAccountUrl(battletag: string) {
  return `/players/${encodeURIComponent(battletag)}`;
}

function onPick(slot: DraftPlayerSlot, battletag: string) {
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
              <NuxtLink
                v-if="slot.effectiveBattletag"
                :to="playerAccountUrl(slot.effectiveBattletag)"
                class="shrink-0 text-muted transition-colors hover:text-brand"
                title="Ouvrir le compte de ce joueur"
                @click.stop
                @keydown.enter.stop
              >
                <UIcon name="i-heroicons-user-circle" class="h-3.5 w-3.5" />
              </NuxtLink>
            </p>
            <p v-if="needsPicking(slot) && slot.candidates.length === 0" class="text-[11px] text-muted">
              Joueur inconnu
            </p>
            <div v-if="needsPicking(slot)" class="mt-1 flex max-w-[180px] items-center gap-1">
              <DraftPseudoCombobox
                :seed-candidates="slot.candidates"
                placeholder="Quel battletag ?"
                @pick="onPick(slot, $event)"
              />
            </div>
          </template>
        </div>

        <UIcon v-if="isSelected(slot)" name="i-heroicons-chevron-right" class="h-4 w-4 shrink-0 text-brand" />
      </li>
    </ul>
  </div>
</template>
