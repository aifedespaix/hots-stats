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
  }>(),
  { rowKey: "id", clickable: false, sortKey: undefined, sortDir: "desc", rowClass: undefined },
);

const rows = computed(() => props.rows as Record<string, unknown>[]);

const emit = defineEmits<{
  (e: "row-click", row: Record<string, unknown>): void;
  (e: "sort", key: string): void;
}>();
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-border">
    <table class="w-full border-collapse text-sm">
      <thead>
        <tr class="border-b border-border bg-surface">
          <th
            v-for="col in props.columns"
            :key="col.key"
            class="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted"
            :class="[col.numeric ? 'text-right' : 'text-left', col.sortable ? 'cursor-pointer select-none hover:text-foreground' : '']"
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
          :class="[clickable ? 'cursor-pointer hover:bg-surface' : '', rowClass ? rowClass(row) : '']"
          @click="clickable && emit('row-click', row)"
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
          <td :colspan="props.columns.length" class="px-4 py-8 text-center text-muted">
            Aucune donnée.
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
