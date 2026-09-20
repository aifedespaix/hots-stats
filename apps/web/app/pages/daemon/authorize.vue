<script setup lang="ts">
import { buildCancelUrl, readAuthorizeParams } from "~/utils/daemonAuthorization";

definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Autoriser le daemon",
  robots: "noindex, nofollow",
});

const route = useRoute();
const { authorizing, authorize } = useDaemonAuthorization();
const failure = ref<string | null>(null);

const parsed = computed(() => readAuthorizeParams(route.query as Record<string, unknown>));

async function onApprove() {
  if (!parsed.value.ok) return;
  failure.value = null;
  try {
    const redirectUrl = await authorize(parsed.value.params);
    window.location.href = redirectUrl;
  } catch {
    failure.value =
      "L'autorisation a échoué. Retourne dans le daemon et relance la connexion.";
  }
}

function onCancel() {
  if (!parsed.value.ok) return;
  window.location.href = buildCancelUrl(parsed.value.params.redirectUri, parsed.value.params.state);
}
</script>

<template>
  <div class="mx-auto max-w-lg space-y-4 rounded-lg border border-border bg-surface p-5">
    <div class="flex items-center gap-2">
      <span class="flex h-8 w-8 items-center justify-center rounded-full bg-brand/15 text-brand">
        <UIcon name="i-heroicons-shield-check" class="h-4 w-4" />
      </span>
      <h1 class="font-heading text-lg font-medium">Autoriser un daemon sur cet ordinateur</h1>
    </div>

    <template v-if="parsed.ok">
      <p class="text-sm text-muted">
        Une application locale (<span class="text-foreground">{{ parsed.params.deviceName }}</span>) demande à
        envoyer tes replays Heroes of the Storm à ton compte HotS Analytics.
      </p>

      <div class="rounded-lg bg-background/60 p-3 text-xs text-muted">
        <p>
          Destination :
          <span class="font-mono text-foreground">{{ parsed.params.redirectUri }}</span>
        </p>
        <p class="mt-1">
          N'autorise que si tu viens de cliquer sur « Connecter ce PC » dans ce daemon.
        </p>
      </div>

      <p v-if="failure" class="text-sm text-error">{{ failure }}</p>

      <div class="flex flex-col gap-2 sm:flex-row">
        <UButton block size="lg" :loading="authorizing" @click="onApprove">Autoriser ce PC</UButton>
        <UButton block size="lg" variant="soft" color="neutral" :disabled="authorizing" @click="onCancel">
          Annuler
        </UButton>
      </div>

      <p class="text-xs text-muted">
        Tu peux révoquer cet accès à tout moment depuis la liste des tokens, plus bas sur la page Upload.
      </p>
    </template>

    <template v-else>
      <p class="text-sm text-error">{{ parsed.reason }}</p>
      <p class="text-sm text-muted">
        Relance la connexion depuis le daemon : le lien qu'il ouvre n'est valable que quelques minutes.
      </p>
    </template>
  </div>
</template>
