export function sortByKey<T, K extends keyof T>(items: readonly T[], key: K, dir: "asc" | "desc"): T[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * factor;
    return ((av as number) - (bv as number)) * factor;
  });
}
