/**
 * Turns a pseudo into a URL-friendly handle: lowercase, accents stripped,
 * anything outside [a-z0-9-] collapsed to a single hyphen, 3-32 chars.
 */
export function slugify(input: string): string {
  const base = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  if (base.length >= 3) return base;
  return `${base}${base ? "-" : "joueur-"}${Math.floor(100 + Math.random() * 900)}`;
}
