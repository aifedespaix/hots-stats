/**
 * Builds an absolute download URL for GET /matches/export.csv from the same
 * query the page sends to GET /matches, so the exported file respects the
 * exact scope and filters of the on-screen list (spec F4 AC3). Empty, null and
 * undefined values are omitted, matching the page's own "absent filter" logic;
 * values are encoded exactly once by URLSearchParams (see useAccountsStore's
 * comment on the double-encoding trap).
 */
export function buildExportUrl(apiBase: string, path: string, query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  const base = apiBase.replace(/\/+$/, "");
  return `${base}${path}${search ? `?${search}` : ""}`;
}
