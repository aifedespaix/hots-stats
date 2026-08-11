/**
 * Shared sortKey/sortDir toggle: click the same column to flip direction,
 * click a different one to sort by it (descending first). Reused by every
 * page that has a sortable `UiDataTable` (heroes, players, matches) so the
 * click behavior stays consistent app-wide.
 */
export function useSortState<K extends string>(initialKey: K, initialDir: "asc" | "desc" = "desc") {
  const sortKey = ref(initialKey) as Ref<K>;
  const sortDir = ref<"asc" | "desc">(initialDir);

  function onSort(key: string) {
    if (sortKey.value === key) {
      sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
    } else {
      sortKey.value = key as K;
      sortDir.value = "desc";
    }
  }

  return { sortKey, sortDir, onSort };
}
