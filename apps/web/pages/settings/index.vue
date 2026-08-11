<script setup lang="ts">
definePageMeta({ middleware: "auth" });

interface PatSummary {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

useSeoMeta({
  title: "Paramètres",
  description:
    "Gère ton BattleTag, ton profil public et tes tokens d'accès personnels pour HotS Analytics.",
  ogTitle: "Paramètres - HotS Analytics",
  ogDescription:
    "Gère ton BattleTag, ton profil public et tes tokens d'accès personnels pour HotS Analytics.",
  ogImage: "/og/settings-index.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/settings-index.png",
  robots: "noindex, follow",
});

const config = useRuntimeConfig();
const { data: authData, refresh: refreshAuth } = await useAuthUser();

const pseudo = ref(authData.value?.user?.displayName ?? "");
const savingPseudo = ref(false);
const pseudoError = ref("");

async function savePseudo() {
  savingPseudo.value = true;
  pseudoError.value = "";
  try {
    await $fetch("/auth/me", {
      method: "PATCH",
      baseURL: config.public.apiBase,
      credentials: "include",
      body: { displayName: pseudo.value },
    });
    await refreshAuth();
  } catch (err) {
    pseudoError.value =
      (err as { data?: { error?: string } })?.data?.error ?? "Erreur lors de la mise à jour";
  } finally {
    savingPseudo.value = false;
  }
}

const battletag = ref(authData.value?.user?.battletag ?? "");
const savingBattletag = ref(false);
const battletagError = ref("");

async function saveBattletag() {
  savingBattletag.value = true;
  battletagError.value = "";
  try {
    await $fetch("/auth/me", {
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

const publicHandle = ref(
  authData.value?.user?.publicHandle || (pseudo.value ? slugify(pseudo.value) : ""),
);
const savingPublicHandle = ref(false);
const publicHandleError = ref("");
// Once the user types their own handle, stop overwriting it from the pseudo.
const publicHandleTouched = ref(Boolean(authData.value?.user?.publicHandle));

watch(publicHandle, (value) => {
  if (value !== slugify(pseudo.value)) publicHandleTouched.value = true;
});

watch(pseudo, (value) => {
  if (!publicHandleTouched.value) publicHandle.value = value ? slugify(value) : "";
});

async function savePublicHandle() {
  savingPublicHandle.value = true;
  publicHandleError.value = "";
  try {
    await $fetch("/auth/me", {
      method: "PATCH",
      baseURL: config.public.apiBase,
      credentials: "include",
      body: { publicHandle: publicHandle.value },
    });
    await refreshAuth();
  } catch (err) {
    publicHandleError.value =
      (err as { data?: { error?: string } })?.data?.error ?? "Erreur lors de la mise à jour";
  } finally {
    savingPublicHandle.value = false;
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
  <div class="mx-auto max-w-2xl space-y-6 sm:space-y-8">
    <h1 class="font-heading text-2xl font-semibold">Paramètres</h1>

    <section class="space-y-4 rounded-lg border border-border p-4 sm:p-6">
      <h2 class="font-heading text-lg">Pseudo</h2>
      <p class="text-sm text-muted">
        Le nom affiché sur le site. Ce n'est pas ton nom Google - choisis ce que tu veux.
      </p>
      <div class="flex flex-col gap-2 sm:flex-row">
        <UInput v-model="pseudo" placeholder="Mon pseudo" class="flex-1" />
        <UButton :loading="savingPseudo" block class="sm:w-auto" @click="savePseudo">Enregistrer</UButton>
      </div>
      <p v-if="pseudoError" class="text-sm text-danger">{{ pseudoError }}</p>
    </section>

    <section class="space-y-4 rounded-lg border border-border p-4 sm:p-6">
      <h2 class="font-heading text-lg">BattleTag</h2>
      <div class="flex flex-col gap-2 sm:flex-row">
        <UInput v-model="battletag" placeholder="Pseudo#12345" class="flex-1 font-mono" />
        <UButton :loading="savingBattletag" block class="sm:w-auto" @click="saveBattletag">
          Enregistrer
        </UButton>
      </div>
      <p v-if="battletagError" class="text-sm text-danger">{{ battletagError }}</p>
    </section>

    <section class="space-y-4 rounded-lg border border-border p-4 sm:p-6">
      <h2 class="font-heading text-lg">Profil public</h2>
      <p class="text-sm text-muted">
        Défini, ton profil devient consultable sans connexion sur
        <code class="break-all font-mono text-xs">/u/{{ publicHandle || "..." }}</code>
        - pratique pour le partager sur Discord. Généré depuis ton pseudo, modifiable si besoin.
      </p>
      <div class="flex flex-col gap-2 sm:flex-row">
        <UInput v-model="publicHandle" placeholder="mon-pseudo" class="flex-1 font-mono" />
        <UButton :loading="savingPublicHandle" block class="sm:w-auto" @click="savePublicHandle">
          Enregistrer
        </UButton>
      </div>
      <p v-if="publicHandleError" class="text-sm text-danger">{{ publicHandleError }}</p>
      <NuxtLink
        v-if="authData?.user?.publicHandle"
        :to="`/u/${authData.user.publicHandle}`"
        target="_blank"
        class="inline-block text-sm text-brand hover:underline"
      >
        Voir mon profil public &rarr;
      </NuxtLink>
    </section>

    <section class="space-y-4 rounded-lg border border-border p-4 sm:p-6">
      <h2 class="font-heading text-lg">Personal Access Tokens</h2>
      <p class="text-sm text-muted">
        Utilisé par le daemon Windows pour envoyer tes statistiques de partie.
      </p>

      <div v-if="createdToken" class="rounded-md border border-brand bg-surface p-4">
        <p class="mb-2 text-sm">Copie ce token maintenant, il ne sera plus jamais affiché :</p>
        <code class="break-all font-mono text-sm">{{ createdToken }}</code>
      </div>

      <ul class="divide-y divide-border">
        <li
          v-for="token in tokensData?.tokens ?? []"
          :key="token.id"
          class="flex items-center justify-between gap-3 py-3"
        >
          <div class="min-w-0">
            <p class="truncate font-medium">{{ token.name }}</p>
            <p class="text-xs text-muted font-mono">
              {{ token.revokedAt ? "Révoqué" : "Actif" }} · créé le
              {{ new Date(token.createdAt).toLocaleDateString() }}
            </p>
          </div>
          <UButton
            v-if="!token.revokedAt"
            color="red"
            variant="ghost"
            size="sm"
            class="shrink-0"
            @click="revokeToken(token.id)"
          >
            Révoquer
          </UButton>
        </li>
      </ul>

      <div class="flex flex-col gap-2 sm:flex-row">
        <UInput v-model="newTokenName" placeholder="Nom du token (ex: PC principal)" class="flex-1" />
        <UButton block class="sm:w-auto" @click="createToken">Générer</UButton>
      </div>
    </section>
  </div>
</template>
