import type { AuthorizeParams } from "~/utils/daemonAuthorization";

interface AuthorizeResponse {
  code: string;
  expiresAt: string;
  redirectUrl: string;
}

/**
 * Creates a daemon authorization code for the browser handshake and returns
 * the loopback URL the browser must navigate to next. Session-cookie auth
 * (same as useTokens); the API revalidates the PKCE challenge and the
 * redirect target before storing anything.
 */
export function useDaemonAuthorization() {
  const config = useRuntimeConfig();
  const authorizing = ref(false);

  async function authorize(input: AuthorizeParams): Promise<string> {
    authorizing.value = true;
    try {
      const res = await $fetch<AuthorizeResponse>("/auth/daemon/authorize", {
        method: "POST",
        baseURL: config.public.apiBase,
        credentials: "include",
        body: input,
      });
      return res.redirectUrl;
    } finally {
      authorizing.value = false;
    }
  }

  return { authorizing, authorize };
}
