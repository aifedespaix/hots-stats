<script setup lang="ts">
export interface DataTableColumn {
  key: string;
  label: string;
  numeric?: boolean;
  sortable?: boolean;
}

const props = withDefaults(
  defineProps<{
    columns: DataTableColumn[];
    rows: unknown[];
    rowKey?: string;
    clickable?: boolean;
    sortKey?: string;
    sortDir?: "asc" | "desc";
    rowClass?: (row: Record<string, unknown>) => string;
    /** Column shown as the card title on mobile. Defaults to the first column. */
    mobilePrimaryKey?: string;
    /** Column shown under the title on mobile (e.g. a subtitle/role/date). */
    mobileSecondaryKey?: string;
    /** Column shown as a prominent badge in the top-right of the mobile card. */
    mobileBadgeKey?: string;
    /** Pins the header row to the top of the table's nearest scrolling ancestor, so a caller wrapping the table in a fixed-height scroll container (e.g. a dashboard panel) keeps the header visible while the body scrolls. No effect when the table isn't inside such a container. */
    stickyHeader?: boolean;
  }>(),
  {
    rowKey: "id",
    clickable: false,
    sortKey: undefined,
    sortDir: "desc",
    rowClass: undefined,
    mobilePrimaryKey: undefined,
    mobileSecondaryKey: undefined,
    mobileBadgeKey: undefined,
    stickyHeader: false,
  },
);

const rows = computed(() => props.rows as Record<string, unknown>[]);

const emit = defineEmits<{
  (e: "row-click", row: Record<string, unknown>): void;
  (e: "sort", key: string): void;
}>();

const primaryKey = computed(() => props.mobilePrimaryKey ?? props.columns[0]?.key);

const cardColumns = computed(() =>
  props.columns.filter(
    (col) => col.key !== primaryKey.value && col.key !== props.mobileSecondaryKey && col.key !== props.mobileBadgeKey,
  ),
);

const sortableColumns = computed(() => props.columns.filter((col) => col.sortable));

function toggleSortDir() {
  if (props.sortKey) emit("sort", props.sortKey);
}
</script>

<template>
  <div>
    <!-- Mobile sort control: table headers aren't visible in card mode, so sorting needs its own control. -->
    <div v-if="sortableColumns.length > 0" class="mb-3 flex items-center gap-2 md:hidden">
      <USelectMenu
        :model-value="sortKey"
        value-key="value"
        :items="sortableColumns.map((col) => ({ value: col.key, label: col.label }))"
        placeholder="Trier par"
        class="flex-1"
        @update:model-value="(key: string | number | boolean | Record<string, unknown> | null) => key && emit('sort', String(key))"
      />
      <button
        type="button"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-muted transition-colors hover:text-foreground"
        :aria-label="sortDir === 'asc' ? 'Tri croissant' : 'Tri décroissant'"
        @click="toggleSortDir"
      >
        <UIcon :name="sortDir === 'asc' ? 'i-heroicons-bars-arrow-up' : 'i-heroicons-bars-arrow-down'" class="h-4 w-4" />
      </button>
    </div>

    <!-- Desktop/tablet: standard table -->
    <div class="hidden overflow-x-auto rounded-lg border border-border md:block">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-border bg-surface">
            <th
              v-for="col in props.columns"
              :key="col.key"
              class="bg-surface px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted"
              :class="[
                col.numeric ? 'text-right' : 'text-left',
                col.sortable ? 'cursor-pointer select-none hover:text-foreground' : '',
                stickyHeader ? 'sticky top-0 z-10' : '',
              ]"
              @click="col.sortable && emit('sort', col.key)"
            >
              <span class="inline-flex items-center gap-1" :class="col.numeric ? 'flex-row-reverse' : ''">
                {{ col.label }}
                <UIcon
                  v-if="col.sortable && sortKey === col.key"
                  :name="sortDir === 'asc' ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
                  class="h-3 w-3"
                />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="String(row[props.rowKey])"
            class="border-b border-border last:border-0"
            :class="[
              clickable
                ? 'cursor-pointer outline-none transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand'
                : '',
              rowClass ? rowClass(row) : '',
            ]"
            :tabindex="clickable ? 0 : undefined"
            :role="clickable ? 'button' : undefined"
            @click="clickable && emit('row-click', row)"
            @keydown.enter="clickable && emit('row-click', row)"
          >
            <td
              v-for="col in props.columns"
              :key="col.key"
              class="px-4 py-3"
              :class="col.numeric ? 'text-right font-mono' : ''"
            >
              <slot :name="`cell-${col.key}`" :row="row">{{ row[col.key] }}</slot>
            </td>
          </tr>
          <tr v-if="props.rows.length === 0">
            <td :colspan="props.columns.length" class="px-4 py-8 text-center text-muted">Aucune donnée.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mobile: stacked cards -->
    <div class="space-y-3 md:hidden">
      <div
        v-for="row in rows"
        :key="String(row[props.rowKey])"
        class="rounded-lg border border-border bg-surface p-4"
        :class="[
          clickable
            ? 'cursor-pointer outline-none transition-colors hover:border-brand/40 active:bg-background focus-visible:border-brand/40 focus-visible:ring-1 focus-visible:ring-brand'
            : '',
          rowClass ? rowClass(row) : '',
        ]"
        :tabindex="clickable ? 0 : undefined"
        :role="clickable ? 'button' : undefined"
        @click="clickable && emit('row-click', row)"
        @keydown.enter="clickable && emit('row-click', row)"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate font-medium">
              <slot v-if="primaryKey" :name="`cell-${primaryKey}`" :row="row">{{ row[primaryKey] }}</slot>
            </p>
            <p v-if="mobileSecondaryKey" class="mt-0.5 truncate text-xs text-muted">
              <slot :name="`cell-${mobileSecondaryKey}`" :row="row">{{ row[mobileSecondaryKey] }}</slot>
            </p>
          </div>
          <div v-if="mobileBadgeKey" class="shrink-0 font-mono text-sm">
            <slot :name="`cell-${mobileBadgeKey}`" :row="row">{{ row[mobileBadgeKey] }}</slot>
          </div>
        </div>

        <dl v-if="cardColumns.length > 0" class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3">
          <div v-for="col in cardColumns" :key="col.key" class="min-w-0">
            <dt class="text-[11px] uppercase tracking-wide text-muted">{{ col.label }}</dt>
            <dd class="truncate text-sm" :class="col.numeric ? 'font-mono' : ''">
              <slot :name="`cell-${col.key}`" :row="row">{{ row[col.key] }}</slot>
            </dd>
          </div>
        </dl>
      </div>

      <div v-if="props.rows.length === 0" class="rounded-lg border border-border bg-surface px-4 py-8 text-center text-muted">
        Aucune donnée.
      </div>
    </div>
  </div>
</template>
