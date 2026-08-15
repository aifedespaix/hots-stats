<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    /** Shown as a small badge next to the title, typically a filtered row count. */
    count?: number;
    /** When set, renders a search box in the header bound via v-model:search. */
    search?: string;
    searchPlaceholder?: string;
  }>(),
  {
    count: undefined,
    search: undefined,
    searchPlaceholder: "Rechercher...",
  },
);

defineEmits<{ (e: "update:search", value: string): void }>();
</script>

<template>
  <section class="flex min-h-0 flex-col rounded-lg border border-border bg-surface">
    <header class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
      <div class="flex min-w-0 items-center gap-2">
        <h2 class="truncate font-heading text-sm font-medium">{{ title }}</h2>
        <span
          v-if="count !== undefined"
          class="shrink-0 rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-muted"
        >
          {{ count }}
        </span>
      </div>
      <UInput
        v-if="search !== undefined"
        :model-value="search"
        :placeholder="searchPlaceholder"
        icon="i-lucide-search"
        size="sm"
        class="w-36 sm:w-48"
        @update:model-value="$emit('update:search', $event as string)"
      />
    </header>

    <!-- No max-height below lg: panels flow with the page on mobile. From lg up, the
    body scrolls internally (see the DataTable's stickyHeader) so a panel with a lot
    of rows doesn't stretch the whole page. -->
    <div class="min-h-0 flex-1 overflow-y-auto p-3 lg:max-h-[30rem]">
      <slot />
    </div>
  </section>
</template>
