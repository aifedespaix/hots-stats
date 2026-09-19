/**
 * F3 -- Chart.js draws to a canvas, so the CSS `prefers-reduced-motion`
 * block in `globals.css` cannot reach it. The base chart wrappers merge this
 * into their options instead; every other Chart.js option is preserved.
 */
export function withReducedMotion<T extends object>(options: T, reduced: boolean): T {
  return reduced ? ({ ...options, animation: false } as T) : options;
}
