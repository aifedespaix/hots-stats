<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    /** Shown as a small badge next to the title, typically a filtered row count. */
    count?: number;
    /** When set, renders a search box in the header bound via v-model:search. */
    search?: string;
    searchPlaceholder?: string;
    /**
     * When true (the default) the body is capped at 30rem from `lg` up and
     * scrolls on its own -- meant for dashboard-style panels sitting next to
     * other panels, where letting every row stretch the page would be worse.
     *
     * Set it to false for panels stacked in a single reading flow (e.g.
     * /progress): the page then keeps exactly one scrollbar instead of nesting
     * one per panel, which also stops a chart built inside the panel from
     * being clipped by its own scroll container.
     */
    scrollable?: boolean;
  }>(),
  {
    count: undefined,
    search: undefined,
    searchPlaceholder: "Rechercher...",
    scrollable: true,
  },
);

defineEmits<{ (e: "update:search", value: string): void }>();
</script>

<template>
  <section class="flex min-h-0 min-w-0 flex-col rounded-lg border border-border bg-surface">
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

    <!-- No max-height below lg: panels flow with the page on mobile. From lg up,
    and only while `scrollable` is on, the body scrolls internally (see the
    DataTable's stickyHeader) so a panel with a lot of rows doesn't stretch the
    whole page. `min-w-0` keeps a wide child (a table, a chart canvas) from
    widening the panel past its parent instead of shrinking inside it. -->
    <div
      class="min-h-0 min-w-0 flex-1 p-3"
      :class="scrollable ? 'overflow-y-auto lg:max-h-[30rem]' : ''"
    >
      <slot />
    </div>
  </section>
</template>
