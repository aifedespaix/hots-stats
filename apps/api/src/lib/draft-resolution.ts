/**
 * Pure name resolution for the live-draft snapshot. The daemon OCRs the
 * draft screen, which renders hero names in the *game client's* language
 * ("LUISAILE" on a French client) and the battleground name with whatever
 * suffix the lobby adds ("GARDEN OF TERROR CLASSIC"), while the database only
 * holds canonical English names. These helpers turn a raw read into a stable
 * id when -- and only when -- the match is unambiguous.
 *
 * No DB import: `draft.service.ts` loads the maps/heroes rows and hands them
 * in, so this stays testable without `DATABASE_URL`, same split as
 * `pattern-aggregate.ts` / `trend-series.ts`.
 */

export interface NamedEntity {
  id: string;
  name: string;
}

/** Upper-cased, accent- and punctuation-free lookup key: "E.T.C." -> "etc",
 * "Lt. Morales" -> "ltmorales", "MÉPHISTO" -> "mephisto". Diacritics are
 * stripped (NFD + combining-mark removal) so "Méphisto" and "MEPHISTO" agree. */
export function normalizeNameKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Raw battleground read -> `maps.id`. An exact normalized match wins; failing
 * that, a **single** canonical name that the read *starts with* is accepted,
 * which absorbs the lobby's suffix ("GARDEN OF TERROR CLASSIC" -> Garden of
 * Terror). Two candidates is ambiguous and yields `null` rather than a guess
 * -- no seeded map name is a prefix of another, so this only fires for a real
 * suffix.
 */
export function resolveMapId(rawName: string | null | undefined, maps: NamedEntity[]): string | null {
  const key = rawName ? normalizeNameKey(rawName) : "";
  if (!key) return null;

  const exact = maps.find((map) => normalizeNameKey(map.name) === key);
  if (exact) return exact.id;

  const prefixed = maps.filter((map) => {
    const candidate = normalizeNameKey(map.name);
    return candidate.length > 0 && key.startsWith(candidate);
  });
  return prefixed.length === 1 ? prefixed[0]!.id : null;
}

/**
 * Raw hero read -> `heroes.id`, by normalized exact match only. Deliberately
 * no fuzzy/alias fallback yet: a mis-attributed hero would silently corrupt
 * every composition verdict built on it, so a localized name this app has no
 * alias for stays `null` and the UI shows its raw text instead. Wire the
 * localized aliases (see the design doc's "Known gap") in here when they
 * exist.
 */
export function resolveHeroId(rawName: string | null | undefined, heroes: NamedEntity[]): string | null {
  const key = rawName ? normalizeNameKey(rawName) : "";
  if (!key) return null;
  return heroes.find((hero) => normalizeNameKey(hero.name) === key)?.id ?? null;
}
