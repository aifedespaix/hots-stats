<script setup lang="ts">
export interface DataTableColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

const props = withDefaults(
  defineProps<{
    columns: DataTableColumn[];
    rows: unknown[];
    rowKey?: string;
    clickable?: boolean;
  }>(),
  { rowKey: "id", clickable: false },
);

const rows = computed(() => props.rows as Record<string, unknown>[]);

const emit = defineEmits<{ (e: "row-click", row: Record<string, unknown>): void }>();
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
            :class="col.numeric ? 'text-right' : 'text-left'"
          >
            {{ col.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="String(row[props.rowKey])"
          class="border-b border-border last:border-0"
          :class="clickable ? 'cursor-pointer hover:bg-surface' : ''"
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
