/** First letter of up to two words, uppercase -- fallback avatar for heroes without an icon asset yet (`heroes.iconUrl` isn't seeded). */
export function initials(name: string): string {
  const letters = name
    .split(/[\s.'-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return letters || "?";
}
