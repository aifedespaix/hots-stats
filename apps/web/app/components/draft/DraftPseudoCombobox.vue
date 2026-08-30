<script setup lang="ts">
import type { BattletagSearchResponse } from "~/types/draft";

const props = defineProps<{
  /** Candidates already known for this pseudo (from OCR name-part matching)
   * -- shown instantly, before any server round trip. */
  seedCandidates: string[];
  placeholder: string;
}>();

const emit = defineEmits<{
  (e: "pick", battletag: string): void;
}>();

const config = useRuntimeConfig();

const model = ref<string | undefined>(undefined);
const searchTerm = ref("");
const searchResults = ref<string[]>([]);
const searching = ref(false);
let searchTimeout: ReturnType<typeof setTimeout> | undefined;

const items = computed(() => {
  const merged = [...props.seedCandidates];
  for (const result of searchResults.value) {
    if (!merged.includes(result)) merged.push(result);
  }
  return merged;
});

watch(searchTerm, (value) => {
  if (searchTimeout) clearTimeout(searchTimeout);
  const term = value.trim();
  if (term.length < 2) {
    searchResults.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  searchTimeout = setTimeout(async () => {
    try {
      const res = await $fetch<BattletagSearchResponse>("/draft/battletags/search", {
        baseURL: config.public.apiBase,
        credentials: "include",
        query: { q: term },
      });
      searchResults.value = res.battletags;
    } finally {
      searching.value = false;
    }
  }, 300);
});

watch(model, (value) => {
  if (value) emit("pick", value);
});
</script>

<template>
  <UInputMenu
    v-model="model"
    v-model:search-term="searchTerm"
    :items="items"
    ignore-filter
    :loading="searching"
    :placeholder="placeholder"
    size="xs"
    class="min-w-0 flex-1"
    @click.stop
  >
    <template #empty>
      {{ searchTerm.trim().length < 2 ? "Tape au moins 2 caractères" : "Aucun battletag trouvé" }}
    </template>
  </UInputMenu>
</template>
