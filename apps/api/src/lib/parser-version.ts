/**
 * Shared numeric-segment version comparison for the daemon's
 * `PARSER_VERSION` (e.g. "1.10" > "1.9", unlike a plain string compare).
 * Used both by `replay-upsert.service.ts` (deciding whether an incoming
 * payload should overwrite a stored match) and anywhere that needs to know
 * whether an already-stored match predates a given parser fix.
 */
function versionTuple(version: string): number[] {
  return version.split(".").map((n) => Number.parseInt(n, 10) || 0);
}

/** -1 / 0 / 1, like `Array.prototype.sort`'s comparator. */
function compareVersions(a: string, b: string): number {
  const x = versionTuple(a);
  const y = versionTuple(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const xi = x[i] ?? 0;
    const yi = y[i] ?? 0;
    if (xi !== yi) return xi > yi ? 1 : -1;
  }
  return 0;
}

/** True if `version` is strictly newer than `stored`. */
export function isVersionGreater(version: string, stored: string): boolean {
  return compareVersions(version, stored) > 0;
}

/** True if `version` is `min` or newer. */
export function isVersionAtLeast(version: string, min: string): boolean {
  return compareVersions(version, min) >= 0;
}
