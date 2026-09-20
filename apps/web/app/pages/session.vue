<script setup lang="ts">
import { PROGRESSION_MIN_MATCHES } from "@hots-stats/shared-types";
import { useSessionRecap } from "~/composables/useSessionRecap";
import {
  deltaTone,
  formatSessionOption,
  formatSignedNumber,
  selectableSessions,
} from "~/utils/sessionDisplay";

definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Récap de session",
  description:
    "Le bilan d'une de tes sessions Heroes of the Storm : record, écart à ta moyenne et détail des parties.",
  ogTitle: "Récap de session - HotS Analytics",
  ogDescription:
    "Le bilan d'une de tes sessions Heroes of the Storm : record, écart à ta moyenne et détail des parties.",
  ogImage: "/og/index.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/index.png",
  robots: "noindex, follow",
});

const route = useRoute();
const router = useRouter();

/** `?at=<ISO>` picks the session to recap; absent means the latest one. A value
 * is only trusted when it parses: the API answers 400 on a malformed datetime,
 * which would replace the whole page with an error card. */
function readAt(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && !Number.isNaN(Date.parse(raw)) ? raw : "";
}

const at = ref(readAt(route.query.at));

const { data, pending, error } = await useSessionRecap(
  computed<Record<string, unknown>>(() => (at.value ? { at: at.value } : {})),
);

const session = computed(() => data.value?.session ?? null);
const stats = computed(() => session.value?.stats ?? null);
const baseline = computed(() => data.value?.baseline ?? null);
const delta = computed(() => data.value?.baselineDelta ?? null);

/** The picker stays on the picked session until the matching recap lands, so
 * the control never snaps back to the previous session mid-fetch. */
const pickedAt = ref<string | null>(null);
watch([session, () => error.value], () => {
  pickedAt.value = null;
});

const selectedStartedAt = computed(() => pickedAt.value ?? session.value?.startedAt ?? "");

const sessionItems = computed(() =>
  selectableSessions(data.value?.sessions ?? [], session.value?.startedAt ?? null, Date.now()).map(
    (entry) => ({ value: entry.startedAt, label: formatSessionOption(entry) }),
  ),
);

function pickSession(startedAt?: string) {
  if (!startedAt || startedAt === at.value) return;
  pickedAt.value = startedAt;
  at.value = startedAt;
}

// The URL is a projection of the selection: a shared or reloaded link reopens
// the same session. Unmanaged query params are kept.
watch(at, (value) => {
  const query = { ...route.query };
  if (value) query.at = value;
  else delete query.at;
  void router.replace({ query });
});

const record = computed(() =>
  stats.value ? stats.value.wins + " V · " + stats.value.losses + " D" : "—",
);
const insufficientMessage = computed(() => {
  const sessionGames = stats.value?.gamesPlayed ?? 0;
  const baselineGames = baseline.value?.gamesPlayed ?? 0;
  return (
    "Échantillon insuffisant pour comparer : " +
    sessionGames +
    " partie(s) dans la session, " +
    baselineGames +
    " dans ta moyenne — au moins " +
    PROGRESSION_MIN_MATCHES +
    " sont nécessaires des deux côtés."
  );
});
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <div class="min-w-0">
      <h1 class="font-heading text-2xl font-semibold">Récap de session</h1>
      <p class="mt-1 text-sm text-muted">
        Le bilan d'une de tes sessions : choisis celle à analyser parmi les 30 derniers jours.
      </p>
    </div>

    <div v-if="sessionItems.length > 0 && !error" class="flex min-w-0 flex-col gap-1 sm:max-w-md">
      <span class="text-xs uppercase tracking-wide text-muted">Session analysée</span>
      <USelectMenu
        :model-value="selectedStartedAt"
        value-key="value"
        label-key="label"
        :items="sessionItems"
        placeholder="Dernière session"
        :loading="pending"
        @update:model-value="pickSession"
      />
    </div>

    <UiStateCard v-if="pending" state="loading" message="Chargement de ta session…" />
    <UiStateCard
      v-else-if="error"
      state="error"
      message="Impossible de charger le récap de session."
    />
    <UiStateCard
      v-else-if="!session"
      state="empty"
      message="Aucune session enregistrée pour l'instant."
    />

    <template v-else-if="stats">
      <UiPanel title="Bilan de la session" :count="stats.gamesPlayed" :scrollable="false">
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <UiStatTile label="Record" :value="record" :tone="winrateTone(stats.winrate)" />
          <UiStatTile
            label="Winrate"
            :value="formatPercent(stats.winrate)"
            :tone="winrateTone(stats.winrate)"
          />
          <UiStatTile label="KDA" :value="stats.kda === null ? '—' : stats.kda.toFixed(2)" />
          <UiStatTile label="Morts / 10 min" :value="stats.deathsPer10Min.toFixed(1)" />
        </div>
        <p class="mt-3 text-sm text-muted">
          Du {{ formatDate(session.startedAt) }} au {{ formatDate(session.endedAt) }}.
        </p>
      </UiPanel>

      <UiPanel title="Écart à ta moyenne" :scrollable="false">
        <div v-if="delta" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <UiStatTile
            label="Winrate"
            :value="formatSignedPercent(delta.winrate)"
            :tone="deltaTone(delta.winrate, 'higher')"
          />
          <UiStatTile
            label="KDA"
            :value="delta.kda === null ? '—' : formatSignedKda(delta.kda)"
            :tone="delta.kda === null ? 'default' : deltaTone(delta.kda, 'higher')"
          />
          <UiStatTile
            label="Morts / 10 min"
            :value="formatSignedNumber(delta.deathsPer10Min)"
            :tone="deltaTone(delta.deathsPer10Min, 'lower')"
          />
          <UiStatTile
            label="XP / min"
            :value="formatSignedNumber(delta.xpPerMinute)"
            :tone="deltaTone(delta.xpPerMinute, 'higher')"
          />
        </div>
        <UiStateCard v-else state="empty" size="sm" :message="insufficientMessage" />
        <p v-if="baseline" class="mt-3 text-xs text-muted">
          Moyenne de référence : {{ baseline.gamesPlayed }} partie(s) avant cette session.
        </p>
      </UiPanel>

      <UiPanel title="Parties de la session" :count="session.matches.length" :scrollable="false">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[36rem] text-left text-sm">
            <thead class="text-xs uppercase tracking-wide text-muted">
              <tr>
                <th class="px-3 py-2">Date</th>
                <th class="px-3 py-2">Carte</th>
                <th class="px-3 py-2">Héros</th>
                <th class="px-3 py-2 text-right">K / D / A</th>
                <th class="px-3 py-2 text-right">Durée</th>
                <th class="px-3 py-2">Résultat</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="game in session.matches"
                :key="game.matchId"
                class="border-t border-border"
              >
                <td class="px-3 py-2 text-muted">{{ formatDate(game.playedAt) }}</td>
                <td class="px-3 py-2">{{ game.mapName }}</td>
                <td class="px-3 py-2">{{ game.heroName }}</td>
                <td class="px-3 py-2 text-right font-mono">
                  {{ game.kills }} / {{ game.deaths }} / {{ game.assists }}
                </td>
                <td class="px-3 py-2 text-right font-mono">
                  {{ formatDuration(game.durationSeconds) }}
                </td>
                <td class="px-3 py-2">
                  <NuxtLink
                    :to="'/matches/' + game.matchId"
                    :class="game.winner ? TONE_TEXT_CLASS.success : TONE_TEXT_CLASS.danger"
                  >
                    {{ game.winner ? "Victoire" : "Défaite" }}
                  </NuxtLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiPanel>
    </template>
  </div>
</template>
