<script setup lang="ts">
import {
  flattenCommandGroups,
  groupCommandEntries,
  moveCommandSelection,
  pageCommandEntries,
  type CommandPageSource,
  type CommandPaletteEntry,
} from "~/utils/commandPalette";

/**
 * Single instance, mounted by the default layout. It only orchestrates: the
 * matching/grouping rules live in utils/commandPalette.ts and the state in
 * composables/useCommandPalette.ts.
 */
const props = defineProps<{ pages: CommandPageSource[] }>();

const { isOpen, close, open } = useCommandPalette();
const { entries, loading, errored, ensureLoaded } = useCommandPaletteSources();

const query = ref("");
const activeIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

const allEntries = computed<CommandPaletteEntry[]>(() => [
  ...pageCommandEntries(props.pages),
  ...entries.value,
]);
const groups = computed(() => groupCommandEntries(allEntries.value, query.value));
const flatEntries = computed(() => flattenCommandGroups(groups.value));
const activeEntry = computed(() => flatEntries.value[activeIndex.value] ?? null);

watch(query, () => {
  activeIndex.value = 0;
});
watch(flatEntries, () => {
  if (activeIndex.value >= flatEntries.value.length) {
    activeIndex.value = Math.max(0, flatEntries.value.length - 1);
  }
});
// `flush: "post"` waits for the modal body to be mounted, otherwise the input
// ref is still null when the palette opens and the focus call is a no-op.
watch(
  isOpen,
  async (value) => {
    if (!value) return;
    query.value = "";
    activeIndex.value = 0;
    void ensureLoaded();
    await nextTick();
    inputRef.value?.focus();
  },
  { flush: "post" },
);

function entryDomId(entry: CommandPaletteEntry) {
  return `command-palette-${entry.id}`;
}

function move(delta: number) {
  activeIndex.value = moveCommandSelection(activeIndex.value, delta, flatEntries.value.length);
  void nextTick(() => {
    const active = activeEntry.value;
    if (!active) return;
    listRef.value
      ?.querySelector<HTMLElement>(`#${CSS.escape(entryDomId(active))}`)
      ?.scrollIntoView({ block: "nearest" });
  });
}

function select(entry: CommandPaletteEntry | null = activeEntry.value) {
  if (!entry?.to) return;
  close();
  void navigateTo(entry.to);
}

// Global shortcut: Ctrl+K / Cmd+K opens the palette, and closes it when open.
function onWindowKeydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
  event.preventDefault();
  isOpen.value ? close() : open();
}

onMounted(() => window.addEventListener("keydown", onWindowKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onWindowKeydown));
</script>

<template>
  <UModal
    :open="isOpen"
    title="Palette de commandes"
    description="Recherche une page, un héros, une carte ou un ami."
    :ui="{ content: 'sm:max-w-xl', body: 'p-4' }"
    @update:open="(value: boolean) => (value ? open() : close())"
  >
    <template #body>
      <div class="space-y-3">
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          role="combobox"
          aria-label="Rechercher"
          aria-controls="command-palette-listbox"
          aria-expanded="true"
          :aria-activedescendant="activeEntry ? entryDomId(activeEntry) : undefined"
          placeholder="Rechercher…"
          autocomplete="off"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-brand"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="select()"
        >

        <div
          id="command-palette-listbox"
          ref="listRef"
          role="listbox"
          aria-label="Résultats"
          class="max-h-80 overflow-y-auto"
        >
          <template v-if="flatEntries.length > 0">
            <div
              v-for="group in groups"
              :key="group.id"
              role="group"
              :aria-label="group.label"
            >
              <p class="px-1 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted">
                {{ group.label }}
              </p>
              <ul>
                <li
                  v-for="entry in group.entries"
                  :id="entryDomId(entry)"
                  :key="entry.id"
                  role="option"
                  :aria-selected="entry.id === activeEntry?.id"
                  class="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors"
                  :class="entry.id === activeEntry?.id ? 'bg-brand/15 text-brand' : 'text-foreground hover:bg-background'"
                  @mouseenter="activeIndex = flatEntries.findIndex((item) => item.id === entry.id)"
                  @click="select(entry)"
                >
                  <UIcon :name="entry.icon ?? 'i-heroicons-arrow-right'" class="h-4 w-4 shrink-0" />
                  <span class="min-w-0 flex-1 truncate">{{ entry.label }}</span>
                  <span v-if="entry.description" class="shrink-0 truncate text-xs text-muted">
                    {{ entry.description }}
                  </span>
                </li>
              </ul>
            </div>
          </template>

          <div v-else-if="loading" class="py-6">
            <UiStateCard state="loading" size="sm" />
          </div>
          <div v-else class="py-6">
            <UiStateCard state="empty" size="sm" :message="`Aucun résultat pour « ${query} ».`" />
          </div>
        </div>

        <p v-if="errored" class="text-xs text-danger">
          Certaines suggestions n'ont pas pu être chargées.
        </p>

        <p class="flex gap-3 border-t border-border pt-2 text-xs text-muted">
          <span><kbd>↑</kbd> <kbd>↓</kbd> naviguer</span>
          <span><kbd>Entrée</kbd> ouvrir</span>
          <span><kbd>Échap</kbd> fermer</span>
        </p>
      </div>
    </template>
  </UModal>
</template>
