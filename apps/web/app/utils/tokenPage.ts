/** Ids of every token except `keepId` — what "Tout supprimer sauf celui-ci" deletes. */
export function otherTokenIds(tokens: readonly { id: string }[], keepId: string | null): string[] {
  return tokens.filter((t) => t.id !== keepId).map((t) => t.id);
}
