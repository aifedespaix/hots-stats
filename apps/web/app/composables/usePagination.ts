/**
 * Client-side pagination over an already-filtered/sorted list. Filtering
 * (e.g. a search box) must happen upstream, on the full list, before it
 * reaches this composable - pagination only slices what it's given, so
 * search always covers every match regardless of the current page.
 */
export function usePagination<T>(items: ComputedRef<T[]>, pageSize = 20) {
  const page = ref(1);

  const total = computed(() => items.value.length);
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

  // Filtering/sorting can shrink the list out from under the current page
  // (e.g. a search narrows results) - snap back to a valid page instead of
  // showing an empty page.
  watch(pageCount, (count) => {
    if (page.value > count) page.value = count;
  });

  const paginated = computed(() => {
    const start = (page.value - 1) * pageSize;
    return items.value.slice(start, start + pageSize);
  });

  return { page, pageSize, total, pageCount, paginated };
}
