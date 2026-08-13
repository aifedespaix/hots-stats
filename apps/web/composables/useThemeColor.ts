/** Reads a design token (e.g. "--color-primary") as an `oklch()` color string. */
export function useThemeColor() {
  function themeColor(cssVar: string, alpha = 1): string {
    if (import.meta.server) return "transparent";
    return `oklch(${getComputedStyle(document.documentElement).getPropertyValue(cssVar)} / ${alpha})`;
  }

  return { themeColor };
}
