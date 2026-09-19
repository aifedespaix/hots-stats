import type { MaybeRefOrGetter } from "vue";
import { toValue } from "vue";
import type { HeroListResponse } from "~/types/analytics";
import type { FriendsListResponse } from "~/types/friends";
import type { MapHubResponse } from "~/types/maps";
import {
  friendCommandEntries,
  heroCommandEntries,
  mapCommandEntries,
  type CommandPaletteEntry,
} from "~/utils/commandPalette";

/**
 * The palette is a browser affordance: its state lives at module scope (one
 * instance for the whole app) and is only ever touched on the client. On the
 * server `isOpen` stays false and nothing is registered, so no request can
 * leak entries into another one.
 */
const isPaletteOpen = ref(false);

interface RegisteredCommandSource {
  get: () => CommandPaletteEntry[];
}

const registeredSources = ref<RegisteredCommandSource[]>([]);
const remoteEntries = ref<CommandPaletteEntry[]>([]);
const remoteLoading = ref(false);
const remoteErrored = ref(false);
const remoteLoaded = ref(false);

export function useCommandPalette() {
  function open() {
    isPaletteOpen.value = true;
  }
  function close() {
    isPaletteOpen.value = false;
  }
  function toggle() {
    isPaletteOpen.value = !isPaletteOpen.value;
  }
  return { isOpen: isPaletteOpen, open, close, toggle };
}

/**
 * Registers the current page's rows. Called from a page/component setup; the
 * entries are removed when that scope unmounts. Deliberately client-only
 * (onMounted): registering during SSR would append to a shared module array
 * on every request.
 */
export function useCommandPaletteEntries(source: MaybeRefOrGetter<CommandPaletteEntry[]>) {
  const holder: RegisteredCommandSource = { get: () => toValue(source) };
  onMounted(() => {
    if (!registeredSources.value.includes(holder)) {
      registeredSources.value = [...registeredSources.value, holder];
    }
  });
  onBeforeUnmount(() => {
    registeredSources.value = registeredSources.value.filter((item) => item !== holder);
  });
}

/**
 * Lazy remote sources (heroes, maps, friends) plus the entries registered by
 * the current page. `ensureLoaded` is idempotent and retries on the next open
 * if a previous attempt failed, so the static Pages group never depends on it.
 */
export function useCommandPaletteSources() {
  const heroesFetch = useApiFetch<HeroListResponse>("/heroes", { lazy: true, immediate: false });
  const mapsFetch = useApiFetch<MapHubResponse>("/maps", { lazy: true, immediate: false });
  const friendsFetch = useApiFetch<FriendsListResponse>("/friends", {
    lazy: true,
    immediate: false,
    withGameMode: false,
  });

  const entries = computed<CommandPaletteEntry[]>(() => [
    ...remoteEntries.value,
    ...registeredSources.value.flatMap((source) => source.get()),
  ]);

  async function ensureLoaded() {
    if (remoteLoaded.value || remoteLoading.value) return;
    remoteLoading.value = true;
    remoteErrored.value = false;
    try {
      await Promise.all([heroesFetch.execute(), mapsFetch.execute(), friendsFetch.execute()]);
      if (heroesFetch.error.value || mapsFetch.error.value || friendsFetch.error.value) {
        remoteErrored.value = true;
      } else {
        remoteEntries.value = [
          ...heroCommandEntries(heroesFetch.data.value?.heroes ?? []),
          ...mapCommandEntries(mapsFetch.data.value?.maps ?? []),
          ...friendCommandEntries(friendsFetch.data.value?.friends ?? []),
        ];
        remoteLoaded.value = true;
      }
    } catch {
      remoteErrored.value = true;
    } finally {
      remoteLoading.value = false;
    }
  }

  return { entries, loading: remoteLoading, errored: remoteErrored, ensureLoaded };
}
