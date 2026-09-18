import { defineStore } from "pinia";

/**
 * Which linked accounts the current view is computed from (multi-account
 * support). A client-only preference persisted to localStorage, exactly like
 * the game-mode filter -- see useGameModeStore. `null` means "not chosen
 * yet", which resolves to the primary account, matching the API's own
 * default when no `?accounts=` parameter is sent.
 */
export const useAccountsStore = defineStore("accounts", {
  state: (): { selected: string[] | null } => ({ selected: null }),
  actions: {
    /**
     * The tags actually sent to the API: the saved selection intersected with
     * what is still linked (a BattleTag unlinked in Settings must not keep
     * filtering requests), or [primary] when that intersection is empty.
     */
    effectiveAccounts(available: string[], primary: string | null): string[] {
      const linked = new Set(available);
      const kept = (this.selected ?? []).filter((tag) => linked.has(tag));
      if (kept.length > 0) return kept;
      return primary && linked.has(primary) ? [primary] : available.slice(0, 1);
    },

    accountsQueryParam(available: string[], primary: string | null): string | undefined {
      const tags = this.effectiveAccounts(available, primary);
      if (tags.length === 0) return undefined;
      // Raw tags, comma-joined. Nuxt's useFetch serializes this query object
      // with ofetch/ufo, which percent-encodes each value exactly once; Hono
      // then decodes it exactly once on the way in. Pre-encoding here would
      // therefore double-encode: "aife#21170" would go out as
      // "aife%252321170" and arrive server-side as the literal "aife%2321170",
      // which never matches a linked BattleTag -- resolveScope then 400s
      // ("Compte non lié") and every personal page reads as empty. The "#"
      // needs no manual escaping: the query object is never rendered into a
      // URL by hand, so a raw "#" cannot truncate the query string.
      return tags.join(",");
    },

    setSelection(tags: string[]) {
      this.selected = [...tags];
    },

    selectOnly(tag: string) {
      this.selected = [tag];
    },

    toggle(tag: string, available: string[], primary: string | null) {
      const current = this.effectiveAccounts(available, primary);
      if (current.includes(tag)) {
        // At least one account must stay selected -- the app always needs a
        // scope to compute personal stats from.
        if (current.length === 1) return;
        this.selected = current.filter((t) => t !== tag);
      } else {
        this.selected = [...current, tag];
      }
    },

    reset() {
      this.selected = null;
    },
  },
  persist: { key: "hots-stats:accounts", pick: ["selected"] },
});
