import { GAME_MODE_TAG_KEYS, type GameModeTagKey } from "~/utils/gameModeTags";

function parseTagsParam(raw: string | null): GameModeTagKey[] {
  if (!raw) return [];
  const seen = new Set<GameModeTagKey>();
  for (const key of raw.split(",")) {
    if ((GAME_MODE_TAG_KEYS as string[]).includes(key)) seen.add(key as GameModeTagKey);
  }
  return [...seen];
}

// Client-only, and numbered to run after 01.pinia-persistedstate: the store
// must already be hydrated from localStorage before we decide whether the
// URL should override it. Priority: `?modes=` in the URL (shareable links)
// wins on first load, otherwise whatever localStorage restored stands; from
// then on every store change is mirrored back into the URL.
export default defineNuxtPlugin(() => {
  const route = useRoute();
  const router = useRouter();
  const gameModeStore = useGameModeStore();

  const tagsFromUrl = parseTagsParam(route.query.modes as string | null);
  if (tagsFromUrl.length > 0) {
    gameModeStore.setTags(tagsFromUrl);
  }

  watch(
    () => gameModeStore.activeTags,
    (tags) => {
      router.replace({ query: { ...route.query, modes: tags.join(",") } });
    },
    { deep: true },
  );
});
