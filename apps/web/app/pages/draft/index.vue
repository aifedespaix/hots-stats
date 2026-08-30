<script setup lang="ts">
import type { DraftPlayerSlot } from "@hots-stats/shared-types";

definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Live Draft",
  description:
    "Suis en direct la draft de ta partie Heroes of the Storm : les deux équipes et les statistiques classées de chaque joueur, dès qu'une partie est détectée.",
  robots: "noindex, follow",
});

const { data: authData } = await useAuthUser();
const ownBattletag = computed(() => authData.value?.user?.battletag ?? null);

const { snapshot, connected } = useDraftStream();
const config = useRuntimeConfig();

// Client-side overrides for any pseudo the viewer has corrected -- ambiguous,
// unknown, or even one the server already resolved but got wrong -- applied
// on top of the server's `effectiveBattletag` so picking one updates the UI
// immediately instead of waiting for the next captured snapshot to reflect
// the preference just persisted via POST /draft/preference. An explicit
// correction always wins, regardless of what the server resolved.
const overrides = reactive(new Map<string, string>());

function applyOverrides(slots: DraftPlayerSlot[] | undefined): DraftPlayerSlot[] {
  if (!slots) return [];
  return slots.map((slot) => {
    if (!slot.rawName) return slot;
    const override = overrides.get(slot.rawName.trim().toLowerCase());
    if (override) return { ...slot, effectiveBattletag: override };
    return slot;
  });
}

const teamLeft = computed(() => applyOverrides(snapshot.value?.teamLeft));
const teamRight = computed(() => applyOverrides(snapshot.value?.teamRight));

const annotationsStore = usePlayerAnnotationsStore();
watch(
  [teamLeft, teamRight],
  ([left, right]) => {
    const battletags = [...left, ...right]
      .map((slot) => slot.effectiveBattletag)
      .filter((battletag): battletag is string => Boolean(battletag));
    if (battletags.length > 0) annotationsStore.fetchMany(battletags);
  },
  { immediate: true },
);

// The team that doesn't contain the viewer -- the one worth scouting for
// bans/threats. Empty (panel hidden) when the viewer's own slot isn't
// resolved yet, since "enemy team" is meaningless without it.
const enemyBattletags = computed<string[]>(() => {
  if (!ownBattletag.value) return [];
  const ownInLeft = teamLeft.value.some((slot) => slot.effectiveBattletag === ownBattletag.value);
  const enemyTeam = ownInLeft ? teamRight.value : teamLeft.value;
  return enemyTeam
    .map((slot) => slot.effectiveBattletag)
    .filter((battletag): battletag is string => Boolean(battletag));
});

const selectedBattletag = ref<string | null>(null);

function select(slot: DraftPlayerSlot) {
  if (slot.effectiveBattletag) selectedBattletag.value = slot.effectiveBattletag;
}

async function disambiguate(slot: DraftPlayerSlot, battletag: string) {
  if (!slot.rawName || !battletag) return;
  overrides.set(slot.rawName.trim().toLowerCase(), battletag);
  selectedBattletag.value = battletag;
  try {
    await $fetch("/draft/preference", {
      method: "POST",
      baseURL: config.public.apiBase,
      credentials: "include",
      body: { pseudo: slot.rawName, battletag },
    });
  } catch {
    // Best-effort: the choice still applies to this session even if persisting it failed.
  }
}

// Keeps a still-valid selection across repeated captures of the *same*
// draft (re-pressing the hotkey mid-pick); clears it for a genuinely new
// draft, auto-selecting the viewer's own player when they're in it -- their
// own numbers are almost certainly what they want to see first.
watch(snapshot, (next) => {
  if (!next) {
    selectedBattletag.value = null;
    return;
  }

  const allSlots = [...teamLeft.value, ...teamRight.value];
  const stillValid = selectedBattletag.value && allSlots.some((slot) => slot.effectiveBattletag === selectedBattletag.value);
  if (stillValid) return;

  const own = ownBattletag.value && allSlots.find((slot) => slot.effectiveBattletag === ownBattletag.value);
  selectedBattletag.value = own ? own.effectiveBattletag : null;
});

const capturedAgoLabel = ref("");
let tickTimer: ReturnType<typeof setInterval> | undefined;

function updateCapturedAgoLabel() {
  if (!snapshot.value) {
    capturedAgoLabel.value = "";
    return;
  }
  const seconds = Math.max(0, Math.round((Date.now() - new Date(snapshot.value.capturedAt).getTime()) / 1000));
  if (seconds < 60) capturedAgoLabel.value = `Capturée il y a ${seconds}s`;
  else if (seconds < 3600) capturedAgoLabel.value = `Capturée il y a ${Math.round(seconds / 60)} min`;
  else capturedAgoLabel.value = `Capturée il y a ${Math.round(seconds / 3600)} h`;
}

onMounted(() => {
  updateCapturedAgoLabel();
  tickTimer = setInterval(updateCapturedAgoLabel, 1000);
});
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
});
watch(snapshot, updateCapturedAgoLabel);
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h1 class="font-heading text-2xl font-semibold">Live Draft</h1>
        <p class="text-sm text-muted">Les deux équipes de ta partie, dès qu'une draft est détectée.</p>
      </div>
      <div class="flex shrink-0 items-center gap-1.5 text-xs text-muted">
        <span class="h-2 w-2 rounded-full" :class="connected ? 'bg-success' : 'bg-danger'" />
        {{ connected ? "En direct" : "Hors ligne" }}
      </div>
    </div>

    <div
      v-if="!snapshot"
      class="flex h-[60vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border text-center text-muted"
    >
      <UIcon name="i-heroicons-clock" class="h-10 w-10" />
      <p class="text-lg font-medium text-foreground">En attente de partie…</p>
      <p class="max-w-sm px-4 text-sm">
        Lance Heroes of the Storm et, une fois en draft, appuie sur ton raccourci de capture (par défaut
        <span class="font-mono">Ctrl+Maj+D</span>) pour l'afficher ici.
      </p>
    </div>

    <template v-else>
      <p v-if="capturedAgoLabel" class="text-xs text-muted">{{ capturedAgoLabel }}</p>

      <!-- Mobile: draft (both teams side by side) on top, stats below -- roughly 50/50 -->
      <div class="flex flex-col gap-3 md:hidden" style="height: calc(100dvh - 19rem)">
        <DraftTeamThreats
          class="shrink-0"
          :battletags="enemyBattletags"
          @select="selectedBattletag = $event"
        />
        <div class="grid min-h-0 flex-1 grid-cols-2 gap-2">
          <DraftTeamColumn
            title="Équipe gauche"
            :slots="teamLeft"
            :selected-battletag="selectedBattletag"
            :own-battletag="ownBattletag"
            @select="select"
            @disambiguate="disambiguate"
          />
          <DraftTeamColumn
            title="Équipe droite"
            :slots="teamRight"
            :selected-battletag="selectedBattletag"
            :own-battletag="ownBattletag"
            @select="select"
            @disambiguate="disambiguate"
          />
        </div>
        <div class="min-h-0 flex-1">
          <DraftPlayerStats :battletag="selectedBattletag" />
        </div>
      </div>

      <!-- Tablet/desktop: draft fills the height, stats centered between the two teams -->
      <div class="hidden flex-col gap-3 md:flex" style="height: calc(100dvh - 13rem)">
        <DraftTeamThreats
          class="shrink-0"
          :battletags="enemyBattletags"
          @select="selectedBattletag = $event"
        />
        <div class="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(200px,1fr)_minmax(340px,1.5fr)_minmax(200px,1fr)]">
          <DraftTeamColumn
            title="Équipe gauche"
            :slots="teamLeft"
            :selected-battletag="selectedBattletag"
            :own-battletag="ownBattletag"
            @select="select"
            @disambiguate="disambiguate"
          />
          <DraftPlayerStats :battletag="selectedBattletag" />
          <DraftTeamColumn
            title="Équipe droite"
            :slots="teamRight"
            :selected-battletag="selectedBattletag"
            :own-battletag="ownBattletag"
            @select="select"
            @disambiguate="disambiguate"
          />
        </div>
      </div>
    </template>
  </div>
</template>
