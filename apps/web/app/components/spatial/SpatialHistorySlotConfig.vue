<script setup lang="ts">
import { HISTORY_HERO_ROLES, HISTORY_ROLE_LABELS, type HistoryHeroRole, type HistoryHeroSelector, type HistoryOutcome, type HistoryPlayerMode } from "~/composables/useSpatialHistorySlot";

/** Picker UI for one "Historique" Slot's config -- used by both Slots of `SpatialSlotGroup.vue` whenever either is scoped to "Historique". */
defineProps<{
  heroOptions: { id: string; name: string }[];
  myBattletag?: string | null;
}>();

const playerMode = defineModel<HistoryPlayerMode>("playerMode", { required: true });
const otherBattletag = defineModel<string>("otherBattletag", { required: true });
const heroSelector = defineModel<HistoryHeroSelector>("heroSelector", { required: true });
const selectedHeroId = defineModel<string | undefined>("selectedHeroId", { required: true });
const selectedRole = defineModel<HistoryHeroRole>("selectedRole", { required: true });
const outcome = defineModel<HistoryOutcome>("outcome", { required: true });
</script>

<template>
  <div class="flex flex-wrap items-end gap-3">
    <div class="space-y-1">
      <label class="text-xs text-muted">Portée</label>
      <div class="flex gap-1">
        <UButton size="xs" :variant="playerMode === 'global' ? 'solid' : 'soft'" color="neutral" @click="playerMode = 'global'">
          Moyenne globale
        </UButton>
        <UButton
          v-if="myBattletag"
          size="xs"
          :variant="playerMode === 'me' ? 'solid' : 'soft'"
          color="neutral"
          @click="playerMode = 'me'"
        >
          Moi
        </UButton>
        <UButton size="xs" :variant="playerMode === 'other' ? 'solid' : 'soft'" color="neutral" @click="playerMode = 'other'">
          Un joueur…
        </UButton>
      </div>
    </div>

    <UInput
      v-if="playerMode === 'other'"
      v-model="otherBattletag"
      placeholder="Pseudo#12345"
      size="sm"
      class="w-40 font-mono"
    />

    <div class="space-y-1">
      <label class="text-xs text-muted">Héros / rôle</label>
      <div class="flex gap-1">
        <USelectMenu
          v-if="heroSelector === 'hero'"
          v-model="selectedHeroId"
          value-key="id"
          label-key="name"
          :items="heroOptions"
          size="sm"
          class="w-40"
        />
        <USelectMenu
          v-else
          v-model="selectedRole"
          value-key="value"
          label-key="label"
          :items="HISTORY_HERO_ROLES.map((role) => ({ value: role, label: HISTORY_ROLE_LABELS[role] }))"
          size="sm"
          class="w-40"
        />
        <UButton
          size="xs"
          variant="soft"
          color="neutral"
          :icon="heroSelector === 'hero' ? 'i-heroicons-user-group' : 'i-heroicons-user'"
          @click="heroSelector = heroSelector === 'hero' ? 'role' : 'hero'"
        >
          {{ heroSelector === "hero" ? "Par rôle" : "Par héros" }}
        </UButton>
      </div>
    </div>

    <div class="space-y-1">
      <label class="text-xs text-muted">Issue</label>
      <USelectMenu
        v-model="outcome"
        value-key="value"
        label-key="label"
        :items="[
          { value: 'all', label: 'Toutes' },
          { value: 'win', label: 'Victoires' },
          { value: 'loss', label: 'Défaites' },
        ]"
        size="sm"
        class="w-32"
      />
    </div>
  </div>
</template>
