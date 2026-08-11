<script setup lang="ts">
definePageMeta({ middleware: "auth" });

interface PatSummary {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

const config = useRuntimeConfig();
const { data: authData, refresh: refreshAuth } = await useAuthUser();

const battletag = ref(authData.value?.user?.battletag ?? "");
const savingBattletag = ref(false);
const battletagError = ref("");

async function saveBattletag() {
  savingBattletag.value = true;
  battletagError.value = "";
  try {
    await $fetch("/me", {
      method: "PATCH",
      baseURL: config.public.apiBase,
      credentials: "include",
      body: { battletag: battletag.value },
    });
    await refreshAuth();
  } catch (err) {
    battletagError.value =
      (err as { data?: { error?: string } })?.data?.error ?? "Erreur lors de la mise à jour";
  } finally {
    savingBattletag.value = false;
  }
}

const { data: tokensData, refresh: refreshTokens } = await useFetch<{ tokens: PatSummary[] }>(
  "/tokens",
  {
    baseURL: config.public.apiBase,
    credentials: "include",
  },
);

const newTokenName = ref("");
const createdToken = ref<string | null>(null);

async function createToken() {
  if (!newTokenName.value) return;
  const res = await $fetch<{ token: string }>("/tokens", {
    method: "POST",
    baseURL: config.public.apiBase,
    credentials: "include",
    body: { name: newTokenName.value },
  });
  createdToken.value = res.token;
  newTokenName.value = "";
  await refreshTokens();
}

async function revokeToken(id: string) {
  await $fetch(`/tokens/${id}`, {
    method: "DELETE",
    baseURL: config.public.apiBase,
    credentials: "include",
  });
  await refreshTokens();
}
</script>

<template>
  <main class="p-8 max-w-2xl mx-auto space-y-8">
    <h1 class="font-heading text-2xl">Paramètres</h1>

    <section class="border border-border rounded-lg p-6 space-y-4">
      <h2 class="font-heading text-lg">BattleTag</h2>
      <div class="flex gap-2">
        <UInput v-model="battletag" placeholder="Pseudo#12345" class="font-mono flex-1" />
        <UButton :loading="savingBattletag" @click="saveBattletag">Enregistrer</UButton>
      </div>
      <p v-if="battletagError" class="text-danger text-sm">{{ battletagError }}</p>
    </section>

    <section class="border border-border rounded-lg p-6 space-y-4">
      <h2 class="font-heading text-lg">Personal Access Tokens</h2>
      <p class="text-muted text-sm">
        Utilisé par le daemon Windows pour envoyer tes statistiques de partie.
      </p>

      <div v-if="createdToken" class="bg-surface border border-primary rounded-md p-4">
        <p class="text-sm mb-2">Copie ce token maintenant, il ne sera plus jamais affiché :</p>
        <code class="font-mono text-sm break-all">{{ createdToken }}</code>
      </div>

      <ul class="divide-y divide-border">
        <li
          v-for="token in tokensData?.tokens ?? []"
          :key="token.id"
          class="flex items-center justify-between py-3"
        >
          <div>
            <p class="font-medium">{{ token.name }}</p>
            <p class="text-muted text-xs font-mono">
              {{ token.revokedAt ? "Révoqué" : "Actif" }} · créé le
              {{ new Date(token.createdAt).toLocaleDateString() }}
            </p>
          </div>
          <UButton
            v-if="!token.revokedAt"
            color="red"
            variant="ghost"
            size="sm"
            @click="revokeToken(token.id)"
          >
            Révoquer
          </UButton>
        </li>
      </ul>

      <div class="flex gap-2">
        <UInput v-model="newTokenName" placeholder="Nom du token (ex: PC principal)" class="flex-1" />
        <UButton @click="createToken">Générer</UButton>
      </div>
    </section>
  </main>
</template>
