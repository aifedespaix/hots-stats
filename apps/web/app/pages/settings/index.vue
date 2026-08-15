<script setup lang="ts">
import type { SharedPlayerAnnotation } from "@hots-stats/shared-types";

definePageMeta({ middleware: "auth" });

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
const pseudoField = useSavableField(async (value) => {
  await $fetch("/auth/me", {
    method: "PATCH",
    baseURL: config.public.apiBase,
    credentials: "include",
    body: { displayName: value },
  });
  await refreshAuth();
});
const savingPseudo = pseudoField.loading;
const pseudoError = pseudoField.error;
const savePseudo = () => pseudoField.submit(pseudo.value);

const battletag = ref(authData.value?.user?.battletag ?? "");
const battletagField = useSavableField(async (value) => {
  await $fetch("/auth/me", {
    method: "PATCH",
    baseURL: config.public.apiBase,
    credentials: "include",
    body: { battletag: value },
  });
  await refreshAuth();
});
const savingBattletag = battletagField.loading;
const battletagError = battletagField.error;
const saveBattletag = () => battletagField.submit(battletag.value);

const publicHandle = ref(
  authData.value?.user?.publicHandle || (pseudo.value ? slugify(pseudo.value) : ""),
);
// Once the user types their own handle, stop overwriting it from the pseudo.
const publicHandleTouched = ref(Boolean(authData.value?.user?.publicHandle));

watch(publicHandle, (value) => {
  if (value !== slugify(pseudo.value)) publicHandleTouched.value = true;
});

watch(pseudo, (value) => {
  if (!publicHandleTouched.value) publicHandle.value = value ? slugify(value) : "";
});

const publicHandleField = useSavableField(async (value) => {
  await $fetch("/auth/me", {
    method: "PATCH",
    baseURL: config.public.apiBase,
    credentials: "include",
    body: { publicHandle: value },
  });
  await refreshAuth();
});
const savingPublicHandle = publicHandleField.loading;
const publicHandleError = publicHandleField.error;
const savePublicHandle = () => publicHandleField.submit(publicHandle.value);

// -- "Ce que tes amis pensent de toi" ---------------------------------------
//
// Reuses the same friend-aware aggregation as the players list/draft/player
// detail views (GET /players/me/ratings -> listSharedPlayerAnnotations
// scoped to *your own* battletag), so whatever your friends marked/noted on
// you is visible here without exposing it to non-friends.
const { data: myRatingsData } = await useFetch<{ annotation: SharedPlayerAnnotation | null }>(
  "/players/me/ratings",
  { baseURL: config.public.apiBase, credentials: "include" },
);
const myAnnotation = computed(() => myRatingsData.value?.annotation ?? null);
const myNotes = computed(() => myAnnotation.value?.entries.filter((entry) => !entry.isMine) ?? []);

// -- "Zone dangereuse" : réinitialisation des données -----------------------
//
// Efface toutes les parties uploadées par ce compte (base de données), et
// stampe `dataResetAt` côté serveur pour que le démon (GET /ingest/version)
// sache qu'il doit tout resynchroniser depuis les fichiers .StormReplay
// encore présents sur le disque au prochain démarrage. Confirmation par
// saisie du mot "SUPPRIMER" : action irréversible côté serveur (les parties
// dont le .StormReplay a été supprimé du disque ne pourront pas être
// recréées).
const RESET_CONFIRM_WORD = "SUPPRIMER";
const resetModalOpen = ref(false);
const resetConfirmText = ref("");
const resetting = ref(false);
const resetError = ref("");
const resetResult = ref<{ deletedMatches: number } | null>(null);

const canConfirmReset = computed(
  () => resetConfirmText.value.trim().toUpperCase() === RESET_CONFIRM_WORD,
);

function openResetModal() {
  resetConfirmText.value = "";
  resetError.value = "";
  resetResult.value = null;
  resetModalOpen.value = true;
}

async function confirmReset() {
  if (!canConfirmReset.value) return;
  resetting.value = true;
  resetError.value = "";
  try {
    const res = await $fetch<{ deletedMatches: number; dataResetAt: string }>("/auth/me/reset-data", {
      method: "POST",
      baseURL: config.public.apiBase,
      credentials: "include",
    });
    resetResult.value = { deletedMatches: res.deletedMatches };
    resetModalOpen.value = false;
  } catch (err) {
    resetError.value =
      (err as { data?: { error?: string } })?.data?.error ?? "Erreur lors de la réinitialisation";
  } finally {
    resetting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6 sm:space-y-8">
    <h1 class="font-heading text-2xl font-semibold">Paramètres</h1>

    <section class="space-y-4 rounded-lg border border-border p-4 sm:p-6">
      <h2 class="font-heading text-lg">Apparence</h2>
      <p class="text-sm text-muted">Choisis le thème de l'interface.</p>
      <UiThemeSwitcher />
    </section>

    <section class="space-y-4 rounded-lg border border-border p-4 sm:p-6">
      <h2 class="font-heading text-lg">Pseudo</h2>
      <p class="text-sm text-muted">
        Le nom affiché sur le site. Choisis ce que tu veux, indépendamment de ton compte de connexion.
      </p>
      <div class="flex flex-col gap-2 sm:flex-row">
        <UInput v-model="pseudo" placeholder="Mon pseudo" class="flex-1" />
        <UButton :loading="savingPseudo" icon="i-heroicons-check" block class="sm:w-auto" @click="savePseudo">
          Enregistrer
        </UButton>
      </div>
      <p v-if="pseudoError" class="text-sm text-danger">{{ pseudoError }}</p>
    </section>

    <section class="space-y-4 rounded-lg border border-border p-4 sm:p-6">
      <h2 class="font-heading text-lg">BattleTag</h2>
      <div class="flex flex-col gap-2 sm:flex-row">
        <UInput v-model="battletag" placeholder="Pseudo#12345" class="flex-1 font-mono" />
        <UButton :loading="savingBattletag" icon="i-heroicons-check" block class="sm:w-auto" @click="saveBattletag">
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
        <UButton
          :loading="savingPublicHandle"
          icon="i-heroicons-check"
          block
          class="sm:w-auto"
          @click="savePublicHandle"
        >
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
      <h2 class="font-heading text-lg">Ce que tes amis pensent de toi</h2>
      <p class="text-sm text-muted">
        Le marquage FDP/sympa, la note et les commentaires que tes amis laissent sur ton BattleTag --
        seuls tes amis y contribuent, et toi seul peux voir le détail ici.
      </p>

      <div v-if="!authData?.user?.battletag" class="text-sm text-muted">
        Renseigne ton BattleTag ci-dessus pour que tes amis puissent te noter.
      </div>
      <div
        v-else-if="!myAnnotation || (myAnnotation.fdpCount === 0 && myAnnotation.pgmCount === 0 && myAnnotation.ratingCount === 0)"
        class="text-sm text-muted"
      >
        Aucun ami ne t'a encore marqué ou noté.
      </div>
      <template v-else>
        <div class="flex flex-wrap items-center gap-4">
          <div v-if="myAnnotation.ratingCount > 0" class="flex items-center gap-2">
            <UiStarRating :model-value="Math.round(myAnnotation.ratingAverage ?? 0)" size="h-5 w-5" />
            <span class="text-sm text-muted">{{ myAnnotation.ratingAverage }} / 5 ({{ myAnnotation.ratingCount }})</span>
          </div>
          <span v-if="myAnnotation.fdpCount > 0" class="text-sm text-danger">FDP · {{ myAnnotation.fdpCount }}</span>
          <span v-if="myAnnotation.pgmCount > 0" class="text-sm text-accent">Sympa · {{ myAnnotation.pgmCount }}</span>
        </div>

        <ul v-if="myNotes.length > 0" class="space-y-3">
          <li v-for="entry in myNotes" :key="entry.authorId" class="rounded-md border border-border bg-surface p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">{{ entry.authorName }}</p>
              <UiStarRating v-if="entry.rating" :model-value="entry.rating" size="h-3.5 w-3.5" />
            </div>
            <p class="mt-1 whitespace-pre-wrap text-sm text-foreground">{{ entry.note }}</p>
          </li>
        </ul>
      </template>
    </section>

    <NuxtLink
      to="/upload"
      class="flex items-center gap-3 rounded-lg border border-brand/30 bg-brand/5 p-4 transition-colors hover:bg-brand/10"
    >
      <UIcon name="i-heroicons-key" class="h-5 w-5 shrink-0 text-brand" />
      <div class="min-w-0 flex-1">
        <p class="text-xs uppercase tracking-wide text-muted">Tokens d'accès &amp; daemon</p>
        <p class="truncate text-sm font-medium">Gère tes tokens et connecte le daemon depuis la page Upload</p>
      </div>
      <UIcon name="i-heroicons-chevron-right" class="h-4 w-4 shrink-0 text-muted" />
    </NuxtLink>

    <section class="space-y-4 rounded-lg border border-danger p-4 sm:p-6">
      <h2 class="font-heading text-lg text-danger">Zone dangereuse</h2>
      <p class="text-sm text-muted">
        Des parties mal enregistrées (mauvais héros, mode de jeu incorrect...) ? En général c'est un bug
        du parser déjà corrigé côté démon - il suffit de le relancer pour qu'il resynchronise tout. Si
        certaines parties restent incohérentes, tu peux repartir de zéro : ça supprime toutes les parties
        que <strong>tu as uploadées</strong> (pas celles de tes amis) et demande à ton démon de tout
        renvoyer depuis les fichiers <code class="font-mono text-xs">.StormReplay</code> encore présents
        sur ton disque.
      </p>
      <p class="text-sm text-muted">
        <strong>Important :</strong> seules les parties dont le fichier replay existe encore localement
        peuvent être recréées. Le démon ne resynchronise qu'à son prochain démarrage - quitte-le puis
        relance-le après confirmation.
      </p>

      <div v-if="resetResult" class="rounded-md border border-border bg-surface p-4 text-sm">
        {{ resetResult.deletedMatches }} partie(s) supprimée(s). Relance le démon (icône dans la zone de
        notification &rarr; Quitter, puis relance-le) pour qu'il resynchronise tes parties.
      </div>
      <p v-if="resetError" class="text-sm text-danger">{{ resetError }}</p>

      <UButton color="error" variant="outline" icon="i-heroicons-arrow-path" @click="openResetModal">
        Réinitialiser mes données
      </UButton>
    </section>

    <UModal v-model:open="resetModalOpen" title="Réinitialiser mes données">
      <template #body>
        <p class="text-sm text-muted">
          Cette action supprime définitivement toutes les parties que tu as uploadées. Les parties dont le
          fichier <code class="font-mono text-xs">.StormReplay</code> n'existe plus sur ton disque seront
          perdues pour de bon.
        </p>
        <p class="mt-4 text-sm">
          Tape <strong>{{ RESET_CONFIRM_WORD }}</strong> pour confirmer :
        </p>
        <UInput v-model="resetConfirmText" class="mt-2" placeholder="SUPPRIMER" />
        <div class="mt-6 flex justify-end gap-2">
          <UButton variant="ghost" icon="i-heroicons-x-mark" @click="resetModalOpen = false">Annuler</UButton>
          <UButton
            color="error"
            icon="i-heroicons-trash"
            :disabled="!canConfirmReset"
            :loading="resetting"
            @click="confirmReset"
          >
            Confirmer la suppression
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
