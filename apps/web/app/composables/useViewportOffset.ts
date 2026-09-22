/**
 * Measures how far an element sits from the top of the viewport, so a tab
 * panel can be pinned to `calc(100dvh - offset)` instead of guessing a fixed
 * number -- a layout's sticky header, a page title and a tab list can all
 * sit above it, and their heights aren't the caller's to assume.
 */
export function useViewportOffset(shell: Ref<HTMLElement | null>) {
  const offset = ref<number | null>(null);

  function measure() {
    const element = shell.value;
    // `offsetParent` is null for a display:none element -- e.g. an inactive
    // tab body -- whose rect would read as a 0 top and collapse the panel.
    if (!element || element.offsetParent === null) return;
    offset.value = Math.round(element.getBoundingClientRect().top + 24);
  }

  onMounted(() => window.addEventListener("resize", measure));
  onBeforeUnmount(() => window.removeEventListener("resize", measure));

  return { offset, measure };
}
