<script setup lang="ts">
import { useClipboard } from "@vueuse/core";
import { otherTokenIds } from "~/utils/tokenPage";

definePageMeta({ layout: "blank", middleware: "auth" });

useSeoMeta({
  title: "Token pour le daemon",
  robots: "noindex, nofollow",
});

const { tokens, pending, revealed, creating, deletingId, createToken, deleteToken } = useTokens();

const newTokenId = ref<string | null>(null);
const newToken = computed(() => (newTokenId.value ? (revealed.value[newTokenId.value] ?? "") : ""));
const { copy, copied } = useClipboard({ source: newToken, copiedDuring: 5000 });
const copyFailed = ref(false);
// `copied` from useClipboard resets after `copiedDuring`; the banner must stay while the page is open.
const wasCopied = ref(false);
const failure = ref<string | null>(null);

async function copyNow() {
  copyFailed.value = false;
  wasCopied.value = false;
  try {
    await copy(newToken.value);
    if (copied.value) wasCopied.value = true;
    else copyFailed.value = true;
  } catch {
    copyFailed.value = true;
  }
}

async function onGenerate() {
  failure.value = null;
  try {
    newTokenId.value = (await createToken()) ?? null;
    await copyNow();
  } catch {
    failure.value = "Impossible de créer le token. Réessaie dans un instant.";
  }
}

// Same two-click guard as TokenCard: a destructive bulk action shouldn't fire on a misclick.
const confirmingPurge = ref(false);
const purging = ref(false);
let purgeTimer: ReturnType<typeof setTimeout> | null = null;

async function onPurgeOthers() {
  if (!confirmingPurge.value) {
    confirmingPurge.value = true;
    purgeTimer = setTimeout(() => (confirmingPurge.value = false), 3000);
    return;
  }
  if (purgeTimer) clearTimeout(purgeTimer);
  confirmingPurge.value = false;
  purging.value = true;
  try {
    for (const id of otherTokenIds(tokens.value, newTokenId.value)) await deleteToken(id);
  } finally {
    purging.value = false;
  }
}

onUnmounted(() => {
  if (purgeTimer) clearTimeout(purgeTimer);
});

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("fr-FR") : "jamais";
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center p-4 sm:p-8">
    <div class="w-full max-w-lg space-y-5">
      <div class="flex items-center gap-2.5">
        <img src="/favicon.svg" alt="" width="32" height="32" class="h-8 w-8">
        <h1 class="font-heading text-2xl">Token pour le daemon</h1>
      </div>

      <ol class="space-y-1.5 text-sm text-muted">
        <li><span class="text-foreground">1.</span> Génère ton token ci-dessous.</li>
        <li><span class="text-foreground">2.</span> Il est copié automatiquement.</li>
        <li><span class="text-foreground">3.</span> Retourne dans le daemon et colle-le dans le champ prévu.</li>
      </ol>

      <UCard>
        <div class="space-y-4">
          <UButton block size="lg" icon="i-heroicons-key" :loading="creating" @click="onGenerate">
            Générer mon token
          </UButton>

          <p v-if="failure" class="text-sm text-error">{{ failure }}</p>

          <div v-if="newToken" class="space-y-2 rounded-lg border border-brand/40 bg-brand/5 p-3">
            <p v-if="wasCopied" class="flex items-center gap-1.5 text-sm font-medium text-success">
              <UIcon name="i-heroicons-check-circle" class="h-4 w-4" />
              Copié ! Colle-le maintenant dans la fenêtre du daemon.
            </p>
            <p v-else-if="copyFailed" class="text-sm text-warning">
              La copie automatique a été refusée par le navigateur. Copie-le ci-dessous.
            </p>
            <code class="block break-all rounded bg-background/60 p-2 font-mono text-xs text-foreground">{{ newToken }}</code>
            <UButton size="sm" variant="soft" icon="i-heroicons-clipboard" @click="copyNow">Copier à nouveau</UButton>
            <p class="text-xs text-muted">Ce token ne sera plus jamais affiché en clair : garde cette page ouverte jusqu'à l'avoir collé.</p>
          </div>
        </div>
      </UCard>

      <UCard>
        <div class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="font-heading text-sm font-medium">Tes tokens existants</h2>
            <UButton
              v-if="tokens.length > (newTokenId ? 1 : 0)"
              size="xs"
              color="error"
              variant="soft"
              :loading="purging"
              @click="onPurgeOthers"
            >
              {{ confirmingPurge ? "Confirmer la suppression" : newTokenId ? "Tout supprimer sauf celui-ci" : "Tout supprimer" }}
            </UButton>
          </div>

          <p v-if="!pending && tokens.length === 0" class="py-3 text-center text-xs text-muted">Aucun token actif.</p>

          <ul v-else class="space-y-2">
            <li
              v-for="token in tokens"
              :key="token.id"
              class="flex items-center gap-3 rounded-lg border border-border bg-surface p-2.5"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm text-foreground">
                  {{ token.name }}
                  <span v-if="token.id === newTokenId" class="ml-1 text-xs text-brand">(nouveau)</span>
                </p>
                <p class="text-xs text-muted">Dernière utilisation : {{ formatDate(token.lastUsedAt) }}</p>
              </div>
              <UButton
                size="xs"
                color="error"
                variant="ghost"
                icon="i-heroicons-trash"
                :loading="deletingId === token.id"
                aria-label="Supprimer ce token"
                @click="deleteToken(token.id)"
              />
            </li>
          </ul>
        </div>
      </UCard>
    </div>
  </main>
</template>
