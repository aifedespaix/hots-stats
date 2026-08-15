<script setup lang="ts">
const { tokens, pending, revealed, creating, renewingId, deletingId, createToken, renewToken, deleteToken } =
  useTokens();
const toast = useToast();

// Briefly highlights the token that was just created/renewed (glow animation
// on TokenCard) so the user's eye is drawn to the secret they need to copy.
const justCreatedId = ref<string | null>(null);
let justCreatedTimer: ReturnType<typeof setTimeout> | null = null;

function flashJustCreated(id: string) {
  if (justCreatedTimer) clearTimeout(justCreatedTimer);
  justCreatedId.value = null;
  // Reset to null first so re-triggering the same id still restarts the CSS animation.
  nextTick(() => {
    justCreatedId.value = id;
    justCreatedTimer = setTimeout(() => (justCreatedId.value = null), 1500);
  });
}

onUnmounted(() => {
  if (justCreatedTimer) clearTimeout(justCreatedTimer);
});

async function onCreate() {
  const id = await createToken();
  if (id) flashJustCreated(id);
  toast.add({
    title: "Token créé",
    description: "Copie-le maintenant : il ne sera plus jamais affiché en clair.",
    icon: "i-heroicons-key",
    color: "success",
  });
}

async function onRenew(id: string) {
  await renewToken(id);
  flashJustCreated(id);
  toast.add({
    title: "Token renouvelé",
    description: "L'ancienne clé ne fonctionne plus. Copie la nouvelle maintenant.",
    icon: "i-heroicons-arrow-path",
    color: "success",
  });
}
</script>

<template>
  <div id="token-manager" class="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="font-heading text-sm font-medium">Tes tokens d'accès</h3>
        <p class="mt-0.5 text-xs text-muted">Utilisés par le daemon pour s'authentifier. Autant que tu veux, un par appareil.</p>
      </div>
      <UButton icon="i-heroicons-plus" :loading="creating" @click="onCreate">Créer un token</UButton>
    </div>

    <div v-if="pending && tokens.length === 0" class="space-y-2">
      <UiSkeletonBlock v-for="i in 2" :key="i" class="h-14 rounded-lg bg-background/60" />
    </div>

    <p v-else-if="tokens.length === 0" class="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted">
      Aucun token actif. Crée-en un pour connecter ton daemon.
    </p>

    <ul v-else class="space-y-2">
      <li v-for="token in tokens" :key="token.id">
        <UploadTokenCard
          :token="token"
          :revealed-value="revealed[token.id]"
          :renewing="renewingId === token.id"
          :deleting="deletingId === token.id"
          :just-created="justCreatedId === token.id"
          @renew="onRenew(token.id)"
          @delete="deleteToken(token.id)"
        />
      </li>
    </ul>
  </div>
</template>
