/**
 * Reads a design token (e.g. "--color-primary") as an `oklch()` color string,
 * for chart.js colors that need to follow the active theme -- reused across
 * every chart in `components/charts/`, replacing what used to be a
 * copy-pasted helper in each modal.
 *
 * Returns a plain function rather than a computed color so callers can read
 * several tokens per chart without re-running `getComputedStyle` at the
 * composable level. Reading `colorMode.value` here (even though the value
 * itself is unused) registers the active Vue effect (typically a chart's
 * `computed`) as a dependent of the color mode, so switching theme while a
 * chart is mounted recomputes its colors instead of leaving them stale.
 */
export function useChartThemeColor(): (cssVar: string, alpha?: number) => string {
  const colorMode = useColorMode();

  return (cssVar: string, alpha = 1) => {
    void colorMode.value;
    if (import.meta.server) return "transparent";
    return `oklch(${getComputedStyle(document.documentElement).getPropertyValue(cssVar)} / ${alpha})`;
  };
}
