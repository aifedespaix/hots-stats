<script setup lang="ts">
import { useClipboard } from "@vueuse/core";
import type { TokenSummary } from "~/composables/useTokens";

const props = defineProps<{
  token: TokenSummary;
  revealedValue?: string;
  renewing: boolean;
  deleting: boolean;
}>();

const emit = defineEmits<{ (e: "renew"): void; (e: "delete"): void }>();

const { copy, copied } = useClipboard({ source: computed(() => props.revealedValue ?? "") });

// Delete is definitive and instant (no modal) -- but a single misclick on a
// destructive action is still worth guarding against, so the button asks
// for one extra click within a short window instead of firing immediately.
const confirmingDelete = ref(false);
let confirmTimer: ReturnType<typeof setTimeout> | null = null;

function onDeleteClick() {
  if (!confirmingDelete.value) {
    confirmingDelete.value = true;
    confirmTimer = setTimeout(() => (confirmingDelete.value = false), 3000);
    return;
  }
  if (confirmTimer) clearTimeout(confirmTimer);
  confirmingDelete.value = false;
  emit("delete");
}

onUnmounted(() => {
  if (confirmTimer) clearTimeout(confirmTimer);
});

function maskedPreview(value: string): string {
  return value.length > 20 ? `${value.slice(0, 14)}…${value.slice(-4)}` : value;
}
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-3 rounded-lg border p-3 transition-colors sm:flex-nowrap"
    :class="revealedValue ? 'border-brand/40 bg-brand/5' : 'border-border bg-surface'"
  >
    <div
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
      :class="revealedValue ? 'bg-brand/15 text-brand' : 'bg-background text-muted'"
    >
      <UIcon name="i-heroicons-key" class="h-4 w-4" />
    </div>

    <div class="min-w-0 flex-1">
      <p class="truncate font-mono text-xs" :class="revealedValue ? 'text-foreground' : 'text-muted'">
        {{ revealedValue ? maskedPreview(revealedValue) : "Clé secrète (déjà copiée)" }}
      </p>
      <p class="mt-0.5 text-xs text-muted">
        Créé le {{ formatDate(token.createdAt) }}
        <template v-if="token.lastUsedAt"> · dernière utilisation {{ formatDate(token.lastUsedAt) }}</template>
        <template v-else> · jamais utilisé</template>
      </p>
    </div>

    <div class="flex shrink-0 items-center gap-1">
      <UTooltip :text="revealedValue ? (copied ? 'Copié !' : 'Copier') : 'Renouvelle pour obtenir une clé copiable'">
        <UButton
          :icon="copied ? 'i-heroicons-check' : 'i-heroicons-clipboard-document'"
          :color="copied ? 'success' : 'neutral'"
          variant="ghost"
          size="sm"
          :disabled="!revealedValue"
          aria-label="Copier le token"
          @click="copy()"
        />
      </UTooltip>
      <UTooltip text="Renouveler (régénère la clé)">
        <UButton
          icon="i-heroicons-arrow-path"
          variant="ghost"
          color="neutral"
          size="sm"
          :loading="renewing"
          aria-label="Renouveler le token"
          @click="emit('renew')"
        />
      </UTooltip>
      <UTooltip :text="confirmingDelete ? 'Cliquer à nouveau pour confirmer' : 'Supprimer définitivement'">
        <UButton
          :icon="confirmingDelete ? 'i-heroicons-exclamation-triangle' : 'i-heroicons-trash'"
          variant="ghost"
          :color="confirmingDelete ? 'error' : 'neutral'"
          size="sm"
          :loading="deleting"
          aria-label="Supprimer le token"
          @click="onDeleteClick"
        />
      </UTooltip>
    </div>
  </div>
</template>
