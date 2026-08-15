export interface TokenSummary {
  id: string;
  lastUsedAt: string | null;
  createdAt: string;
}

interface RawTokenResponse {
  token: string;
  id: string;
  createdAt: string;
}

/**
 * Frictionless Personal Access Token management for `/upload`'s right
 * column: create/renew/delete, no naming form. The raw secret is only ever
 * returned by the API once, right after a create or renew call -- kept here
 * in `revealed` (this session only, lost on reload) so "Copier" has
 * something to copy without the server ever storing it in reversible form.
 */
export function useTokens() {
  const config = useRuntimeConfig();
  const { data, refresh, pending } = useApiFetch<{ tokens: TokenSummary[] }>("/tokens");

  const revealed = ref<Record<string, string>>({});
  const creating = ref(false);
  const renewingId = ref<string | null>(null);
  const deletingId = ref<string | null>(null);

  async function createToken() {
    creating.value = true;
    try {
      const res = await $fetch<RawTokenResponse>("/tokens", {
        method: "POST",
        baseURL: config.public.apiBase,
        credentials: "include",
      });
      revealed.value[res.id] = res.token;
      await refresh();
      return res.id;
    } finally {
      creating.value = false;
    }
  }

  async function renewToken(id: string) {
    renewingId.value = id;
    try {
      const res = await $fetch<RawTokenResponse>(`/tokens/${id}/renew`, {
        method: "POST",
        baseURL: config.public.apiBase,
        credentials: "include",
      });
      revealed.value[res.id] = res.token;
    } finally {
      renewingId.value = null;
    }
  }

  async function deleteToken(id: string) {
    deletingId.value = id;
    try {
      await $fetch(`/tokens/${id}`, {
        method: "DELETE",
        baseURL: config.public.apiBase,
        credentials: "include",
      });
      delete revealed.value[id];
      await refresh();
    } finally {
      deletingId.value = null;
    }
  }

  return {
    tokens: computed(() => data.value?.tokens ?? []),
    pending,
    revealed,
    creating,
    renewingId,
    deletingId,
    createToken,
    renewToken,
    deleteToken,
  };
}
