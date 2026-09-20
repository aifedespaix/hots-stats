<script setup lang="ts">
import type { PillTabOption } from "~/components/ui/PillTabs.vue";

export type TimelineLaneMode = "me" | "all";

const props = defineProps<{
    laneMode: TimelineLaneMode;
    playing: boolean;
    speed: number;
    isZoomed: boolean;
    scrubSeconds: number;
    durationSeconds: number;
    /** False when the match has no structured events, so the step buttons are disabled rather than no-ops. */
    hasEvents: boolean;
  }>();

const emit = defineEmits<{
  "update:laneMode": [mode: TimelineLaneMode];
  "toggle-play": [];
  "cycle-speed": [];
  step: [direction: -1 | 1];
  "reset-zoom": [];
  "update:scrubSeconds": [seconds: number];
}>();

const laneModeOptions: PillTabOption<TimelineLaneMode>[] = [
  { value: "me", label: "Moi", icon: "i-heroicons-user" },
  { value: "all", label: "Les 10 joueurs", icon: "i-heroicons-user-group" },
];

const sliderMax = computed(() => Math.max(0, Math.floor(props.durationSeconds)));

function onScrub(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  emit("update:scrubSeconds", Number.isFinite(value) ? value : 0);
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
    <UiPillTabs
      :model-value="laneMode"
      :options="laneModeOptions"
      @update:model-value="emit('update:laneMode', $event)"
    />

    <div class="flex items-center gap-1">
      <button
        type="button"
        class="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-foreground"
        :aria-label="playing ? 'Mettre en pause' : 'Dérouler la partie'"
        :title="playing ? 'Pause' : 'Dérouler la partie'"
        @click="emit('toggle-play')"
      >
        <UIcon :name="playing ? 'i-heroicons-pause' : 'i-heroicons-play'" class="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        class="rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-foreground"
        aria-label="Changer la vitesse de lecture"
        title="Vitesse de lecture"
        @click="emit('cycle-speed')"
      >
        {{ speed }}×
      </button>
    </div>

    <div class="flex items-center gap-1">
      <button
        type="button"
        class="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-40"
        :disabled="!hasEvents"
        title="Événement précédent"
        @click="emit('step', -1)"
      >
        <UIcon name="i-heroicons-backward" class="h-3.5 w-3.5" />
        Événement
      </button>
      <button
        type="button"
        class="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-40"
        :disabled="!hasEvents"
        title="Événement suivant"
        @click="emit('step', 1)"
      >
        Événement
        <UIcon name="i-heroicons-forward" class="h-3.5 w-3.5" />
      </button>
    </div>

    <button
      v-if="isZoomed"
      type="button"
      class="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-foreground"
      title="Revenir à la partie entière"
      @click="emit('reset-zoom')"
    >
      <UIcon name="i-heroicons-arrows-pointing-in" class="h-3.5 w-3.5" />
      Vue complète
    </button>

    <label class="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted">
      <span>Position : {{ formatDuration(scrubSeconds) }}</span>
      <input
        type="range"
        min="0"
        :max="sliderMax"
        step="1"
        :value="scrubSeconds"
        aria-label="Position dans la chronologie de la partie"
        @input="onScrub"
      />
    </label>
  </div>
</template>
